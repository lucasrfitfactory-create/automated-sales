import type {
  MarianaTekClient,
  MtClassSession,
  MtClient,
  MtMembershipStatus,
  MtRosterEntry,
} from './types.js';

// Real Mariana Tek Admin API client. Verified empirically against the live
// tenant (2026-08-26) — their docs (docs.marianatek.com) stay blank/gated
// even with the key, so this was built by probing the actual API directly.
//
// CONFIRMED:
//   - JSON:API format (data/attributes/relationships), requires
//     `Accept: application/vnd.api+json` (plain application/json -> 406).
//   - GET /api/class_sessions/?location=<id> — plain-name filtering works
//     for the `location` relationship. Default ordering is start_datetime
//     descending.
//   - Date-range filtering does NOT work — tried start_datetime__gte/lte,
//     filter{start_datetime.gte}, min/max_start_date, after/before — every
//     variant is silently ignored (no error, unfiltered count returned).
//     Confirmed via OPTIONS that filtering support is advertised
//     ("filter{}") but doesn't actually narrow this field in practice.
//     Worked around with binary search over pages (findBoundaryPage) since
//     ordering is reliable — not ideal (O(log n) + O(window size) requests
//     per call) but correct.
//   - GET /api/reservations/?class_session=<id> — roster/attendance.
//     attributes.status === 'check in' = attended (other values, e.g. for
//     no-shows/cancellations, not yet observed). relationships.tags.data
//     holds reservation_tags refs — tag id 459 = "ClassPass Reservation",
//     which is exactly the "Guest of ClassPass" signal. relationships.user
//     is the client (null for guest-only bookings with no account, which
//     are skipped).
//   - GET /api/users/<id>/ — client profile (first_name, last_name, email,
//     phone_number).
//   - GET /api/membership_instances/?user=<id> — a user's memberships
//     (active + historical). attributes.is_intro_offer distinguishes trial
//     offers from real memberships; attributes.status is 'active' or
//     'cancelled' (others not yet observed); membership_name is the real
//     display name (confirmed "🎯 COMEBACK SPECIAL- 3 MONTH UNLIMITED" and
//     "⚡️ 4 Month Unlimited Membership" in live data). Mariana Tek does NOT
//     flip a trial's status away from 'active' once its scheduled end date
//     passes — an expired-but-unconverted trial still shows status:'active'
//     with a past scheduled_end_datetime, so "expired" has to be computed
//     from dates, not from status (confirmed with Lucas 2026-08-26: this is
//     correct — we should still reach out to expired-but-unconverted trials,
//     see playbook.ts).
//   - attributes.classroom_display on class_sessions — 'Group Fitness' vs
//     'PSC - Personal Strength Coaching' vs 'REFINED Reformer'. Per Lucas
//     2026-08-26, only 'Group Fitness' classes are in scope (PSC and
//     Refined Reformer are different products/businesses and must never get
//     the Fit Factory group-fitness pitch). Confirmed this isn't enough on
//     its own, either — a client can attend a real Group Fitness class
//     while separately holding a Refined/PSC membership_instance, which
//     still needs excluding when computing their status (see the
//     isOtherBusinessProduct filter below).
//   - Frozen (paused) real memberships: status is literally 'frozen' (not
//     'active' with a membership_freeze relationship, as first assumed),
//     and freeze_reactivation_datetime sits right on the instance — no
//     separate membership_freezes fetch needed. Confirmed against a real
//     frozen membership (Dylan Trench, 2026-08-26).
//   - Class packs: GET /api/credit_transactions/?user=<id> — one "grant"
//     record per pack purchase, identified by remaining_credits_cache !==
//     null (usage/debit records have it null). transaction_amount = total
//     credits issued, remaining_credits_cache = live remaining balance,
//     expiration_datetime = pack expiry. Confirmed against a real example
//     (Dylan Trench: Mariana Tek's own UI showed "Credit: 5/14. Exp.
//     9/1/2026"; transaction 67371 had transaction_amount:14,
//     remaining_credits_cache:5, expiration_datetime:2026-09-01 — exact
//     match). credit_name is a generic bucket label (e.g. "Complimentary
//     Classes - Downtown"), not the specific purchased product's marketing
//     name — good enough to identify/message about, not to quote back
//     verbatim as "the pack you bought."
//
// STILL TODO / UNCONFIRMED:
//   - Reservation status values other than 'check in' (no-show, cancelled,
//     waitlisted, etc.) haven't been observed — anything other than
//     'check in' is currently treated as not-attended.

const API_VERSION_ACCEPT = 'application/vnd.api+json';

interface JsonApiResource<A = any, R = any> {
  type: string;
  id: string;
  attributes: A;
  relationships?: R;
}

interface JsonApiList<A = any, R = any> {
  meta: { pagination: { count: number; pages: number; page: number; per_page: number } } | null;
  data: JsonApiResource<A, R>[];
}

interface JsonApiSingle<A = any, R = any> {
  data: JsonApiResource<A, R>;
}

export function createRealMarianaTekClient(opts: { apiUrl: string; apiKey: string }): MarianaTekClient {
  const { apiUrl, apiKey } = opts;

  async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
    const url = new URL(path, apiUrl);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: API_VERSION_ACCEPT },
    });
    if (!res.ok) {
      throw new Error(`Mariana Tek API GET ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async function fetchClassSessionsPage(locationId: string, page: number, pageSize: number) {
    return get<JsonApiList>('/api/class_sessions/', {
      location: locationId,
      page: String(page),
      page_size: String(pageSize),
    });
  }

  /** Binary search for the first page whose last item's start_datetime <= `beforeIso` (pages are start_datetime-descending). */
  async function findBoundaryPage(locationId: string, beforeIso: string, pageSize: number): Promise<{ page: number; totalPages: number }> {
    const first = await fetchClassSessionsPage(locationId, 1, pageSize);
    const totalPages = first.meta?.pagination.pages ?? 1;
    if (totalPages <= 1) return { page: 1, totalPages };

    let lo = 1;
    let hi = totalPages;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      const d = await fetchClassSessionsPage(locationId, mid, pageSize);
      const lastItem = d.data[d.data.length - 1];
      const lastDt = lastItem?.attributes.start_datetime ?? '';
      if (lastDt <= beforeIso) hi = mid;
      else lo = mid + 1;
    }
    return { page: lo, totalPages };
  }

  function mapClassSession(item: JsonApiResource): MtClassSession {
    const a = item.attributes;
    return {
      id: item.id,
      className: a.class_type_display ?? a.public_note ?? 'Class',
      instructor: (a.instructor_names ?? [])[0] ?? 'Unknown',
      startTime: a.start_datetime,
      locationId: item.relationships?.location?.data?.id ?? '',
    };
  }

  return {
    async getClassSessions({ locationId, since, before }) {
      const pageSize = 100;
      const { page: boundaryPage, totalPages } = await findBoundaryPage(locationId, before, pageSize);

      const sessions: MtClassSession[] = [];
      let page = boundaryPage;
      while (page <= totalPages) {
        const d = await fetchClassSessionsPage(locationId, page, pageSize);
        if (d.data.length === 0) break;

        let hitOlderThanSince = false;
        for (const item of d.data) {
          const dt: string = item.attributes.start_datetime;
          if (dt >= before) continue;
          if (dt < since) {
            hitOlderThanSince = true;
            break;
          }
          if (item.attributes.classroom_display !== 'Group Fitness') continue; // excludes PSC and Refined Reformer
          sessions.push(mapClassSession(item));
        }
        if (hitOlderThanSince) break;
        page++;
      }
      return sessions;
    },

    async getRoster(classSessionId) {
      const roster: MtRosterEntry[] = [];
      let page = 1;
      while (true) {
        const d = await get<JsonApiList>('/api/reservations/', {
          class_session: classSessionId,
          page: String(page),
          page_size: '100',
        });
        if (d.data.length === 0) break;
        for (const r of d.data) {
          const userId = r.relationships?.user?.data?.id;
          if (!userId) continue; // guest booking with no account — nothing to message
          const tags: { id: string }[] = r.relationships?.tags?.data ?? [];
          roster.push({
            classSessionId,
            clientId: userId,
            attended: r.attributes.status === 'check in',
            bookingSource: tags.some((t) => t.id === '459') ? 'classpass' : 'direct',
          });
        }
        const pages = d.meta?.pagination.pages ?? 1;
        if (page >= pages) break;
        page++;
      }
      return roster;
    },

    async getClient(clientId) {
      const d = await get<JsonApiSingle>(`/api/users/${clientId}/`);
      const a = d.data.attributes;
      const client: MtClient = {
        id: d.data.id,
        firstName: a.first_name,
        lastName: a.last_name,
        email: a.email,
        phone: a.phone_number || null,
      };
      return client;
    },

    async getMembershipStatus(clientId): Promise<MtMembershipStatus> {
      const d = await get<JsonApiList>('/api/membership_instances/', { user: clientId, page_size: '50' });
      // Exclude Refined Reformer Pilates and PSC (Personal Strength
      // Coaching) products — different businesses/products from Fit
      // Factory group fitness. Without this, a client who attends a real
      // Group Fitness class but also separately has a Refined/PSC purchase
      // on file gets that unrelated product surfaced as their "status",
      // pitching Fit Factory Weekly Unlimited off the wrong product
      // (confirmed as a real bug against live data 2026-08-26).
      const isOtherBusinessProduct = (name: string) => /refined|reformer|\bpsc\b/i.test(name);
      // A genuine intro-offer/trial always has a real start_date. Some
      // ClassPass-linked clients have an intro-offer-flagged instance with
      // NO dates at all (start_date null) — a categorization marker
      // ("they're a ClassPass client"), not an actual timed trial. Treating
      // it as one computes garbage (new Date(null) = epoch 1970, so
      // "expired 20,693 days ago") and blocks the real ClassPass-guest
      // treatment. Confirmed 2026-08-27, Crystal Peng: pure ClassPass
      // booker (every reservation shows "ClassPass ClassPass"), no real
      // Fit Factory trial, but a dateless "CLASS PASS CLIENT OFFER"
      // instance was misread as an expired trial.
      const isDatelessTrialPlaceholder = (i: (typeof d.data)[number]) => i.attributes.is_intro_offer && !i.attributes.start_date;
      // NOTE: deliberately no early return when `instances` is empty — a
      // pack-only client (never bought a trial/membership product, so zero
      // membership_instances) still needs to reach Priority 4 below.
      // Confirmed 2026-08-27, Kelsey Butler: an early return here skipped
      // class-pack detection entirely and misread her as no_active_status
      // despite a real, unexpired pack with credits remaining. Priorities
      // 1-3 below use .find() on `instances`, which safely no-ops on an
      // empty array, so they still fall through correctly to Priority 4/5.
      const instances = d.data
        .filter((i) => !isOtherBusinessProduct(i.attributes.membership_name ?? ''))
        .filter((i) => !isDatelessTrialPlaceholder(i));

      const endedAtOf = (a: any): string =>
        a.cancellation_datetime ?? a.scheduled_end_datetime ?? a.end_date ?? a.calculated_start_datetime ?? a.purchase_date ?? a.start_date ?? 'unknown';

      // Real trial end date. Confirmed 2026-08-26 against a real example
      // (Sameer Saini, a currently-active trial ending 2026-09-07): both
      // scheduled_end_datetime and next_charge_date were null even though
      // the trial is genuinely still running — end_date (or
      // calculated_end_datetime/payment_interval_end_date as further
      // fallbacks) had the real date. The earlier version of this fallback
      // chain didn't include end_date at all and silently landed on
      // start_date, making an active trial with 12 days left read as
      // expired 19 days ago — caught before any message went out.
      const trialEndDateOf = (a: any): string =>
        a.end_date ?? a.scheduled_end_datetime ?? a.calculated_end_datetime ?? a.payment_interval_end_date ?? a.next_charge_date ?? a.start_date;

      // Priority 1: a real (non-intro) membership means they've converted —
      // "we're good" (per Lucas 2026-08-26), regardless of any trial or
      // past-lapsed instance also on file. Status isn't only 'active': a
      // brand-new signup sits in 'pending_customer_activation' until some
      // activation step completes, and a renewal/forward-dated signup sits
      // in 'pending_start_date' until its start date arrives — both are
      // real, already-purchased memberships (purchase_date/renewal_count
      // present, no cancellation), not still-open leads. Confirmed
      // 2026-08-28, Nicolas Nkiere: closed personally by Lucas after a
      // pricing negotiation the pipeline flagged as an active conversation;
      // Mariana Tek created the new $69/week instance same-day but left it
      // 'pending_customer_activation', so this fell through undetected to
      // Priority 3 (his old expired trial instance) — the conversion was
      // real but invisible to both the playbook and conversion tracking.
      // start_date is null on these pending statuses, so purchase_date is
      // the only real anchor for "when did this happen."
      const realActive = instances.find(
        (i) =>
          !i.attributes.is_intro_offer &&
          (i.attributes.status === 'active' ||
            i.attributes.status === 'pending_customer_activation' ||
            i.attributes.status === 'pending_start_date'),
      );
      if (realActive) {
        const a = realActive.attributes;
        return { kind: 'membership_active', planName: a.membership_name, memberSince: a.start_date ?? a.purchase_date };
      }

      // Priority 1.5: a real (non-intro) membership whose latest renewal
      // charge just failed — status literally 'payment_failure'. Still a
      // real member (renewal_count/billing_cycles keep going, no
      // cancellation_datetime), just hit a card decline — NOT lapsed, and
      // should never get a "come back, get your membership going again"
      // win-back pitch implying they left. Confirmed 2026-08-27, Natali
      // Pineros: an 8-renewal-deep membership hit `payment_failure` on
      // today's charge and fell through to the lapsed fallback below,
      // which then grabbed her membership's START date as if it were an
      // end date (no end_date/cancellation_datetime exists on this status
      // to anchor on) and pitched her a win-back for a membership she
      // still has. Treated as membership_active for now — there's no
      // dedicated "update your payment method" segment in the playbook
      // yet, so this just makes sure she isn't pitched at all until one
      // exists.
      const paymentFailure = instances.find((i) => i.attributes.status === 'payment_failure' && !i.attributes.is_intro_offer);
      if (paymentFailure) {
        const a = paymentFailure.attributes;
        return { kind: 'membership_active', planName: a.membership_name, memberSince: a.start_date };
      }

      // Priority 2: a real (non-intro) FROZEN membership — confirmed
      // 2026-08-26 that status is literally 'frozen' (not 'active' with a
      // membership_freeze relationship, as originally assumed), and
      // freeze_reactivation_datetime is right on the instance. Still counts
      // as "converted" — they're a real member, just paused.
      const realFrozen = instances.find((i) => i.attributes.status === 'frozen' && !i.attributes.is_intro_offer);
      if (realFrozen) {
        const a = realFrozen.attributes;
        return { kind: 'membership_paused', planName: a.membership_name, resumesAt: a.freeze_reactivation_datetime ?? null };
      }

      // Priority 3: an active trial/intro-offer instance — still trial_offer
      // even if its scheduled end date has already passed, since Mariana Tek
      // doesn't flip status away from 'active' on expiry. playbook.ts uses
      // the dates to decide "wraps up soon" vs "already expired" copy.
      const introActive = instances.find((i) => i.attributes.status === 'active' && i.attributes.is_intro_offer);
      if (introActive) {
        const a = introActive.attributes;
        return {
          kind: 'trial_offer',
          offerName: a.membership_name,
          startDate: a.start_date,
          endDate: trialEndDateOf(a),
          // Not derivable from membership_instances — unused by the current
          // playbook rules (they key off dates, not class counts), so this
          // is a harmless placeholder rather than a real figure.
          classesUsed: 0,
          classesIncluded: 999,
        };
      }

      // Priority 4: an active class pack. Confirmed 2026-08-26 against a
      // real example (Dylan Trench, "Credit: 5/14. Exp. 9/1/2026" in the
      // Mariana Tek UI): /api/credit_transactions/?user=<id> has one
      // "grant" record per pack purchase — remaining_credits_cache !== null
      // marks a grant (vs. a per-class usage debit, which has it null);
      // transaction_amount is the total credits issued, remaining_credits_cache
      // is the live remaining balance, expiration_datetime is the pack's
      // expiry. credit_name is a generic bucket label (e.g. "Complimentary
      // Classes - Downtown"), not the specific purchased product name — good
      // enough to identify it as a pack, not necessarily its marketing name.
      const creditData = await get<JsonApiList>('/api/credit_transactions/', { user: clientId, page_size: '100' });
      const now = new Date().toISOString();
      // Filter to actual usable credit (> 0) BEFORE picking the
      // soonest-to-expire one — a client can hold multiple grants at once
      // (e.g. an old pack that's used up sitting alongside a newer one with
      // real balance). Sorting by expiration first and taking [0] used to
      // pick whichever grant expires soonest even if it had zero credits
      // left, then bail out entirely instead of checking the next one.
      // Confirmed 2026-08-27, Kelsey Butler: a 0-remaining pack expiring
      // Oct 21 was selected over her real 3-remaining pack expiring Dec 31,
      // reading her as no_active_status despite genuinely having credit.
      const activePack = creditData.data
        .filter((t) => t.attributes.remaining_credits_cache !== null && t.attributes.remaining_credits_cache > 0)
        .filter((t) => (t.attributes.expiration_datetime ?? '9999') > now)
        .sort((x, y) => (x.attributes.expiration_datetime ?? '').localeCompare(y.attributes.expiration_datetime ?? ''))[0];
      if (activePack) {
        const a = activePack.attributes;
        return {
          kind: 'class_pack',
          packName: a.credit_name,
          classesRemaining: a.remaining_credits_cache,
          classesTotal: a.transaction_amount,
          expiresAt: a.expiration_datetime,
        };
      }

      // Priority 5: nothing active — most recent instance overall decides
      // the story. A trial that was explicitly cancelled (not just expired)
      // still reads as an unconverted trial, not a "lapsed membership".
      const mostRecent = [...instances].sort((x, y) => endedAtOf(y.attributes).localeCompare(endedAtOf(x.attributes)))[0];
      if (mostRecent) {
        const a = mostRecent.attributes;
        if (a.is_intro_offer) {
          return {
            kind: 'trial_offer',
            offerName: a.membership_name,
            startDate: a.start_date,
            endDate: trialEndDateOf(a),
            classesUsed: 0,
            classesIncluded: 999,
          };
        }
        return { kind: 'membership_lapsed', planName: a.membership_name, endedAt: endedAtOf(a) };
      }
      return { kind: 'no_active_status' };
    },

    async getRecentAttendanceCount(clientId, sinceIso) {
      // TODO: reservations aren't confirmed to come back in a reliable
      // chronological order (unlike class_sessions, which does), so this
      // takes the first page (most recent activity, going by observed data)
      // and counts check-ins within the window from there. Good enough for
      // a 30-day-ish window against a typical attendee; could undercount
      // someone with 100+ reservations of other statuses (cancellations
      // etc.) ahead of their actual check-ins in the same page.
      const d = await get<JsonApiList>('/api/reservations/', { user: clientId, page_size: '100' });
      return d.data.filter((r) => r.attributes.status === 'check in' && (r.attributes.check_in_date ?? '') >= sinceIso).length;
    },
  };
}
