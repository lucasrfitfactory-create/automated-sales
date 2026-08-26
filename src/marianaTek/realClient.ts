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
//     "⚡️ 4 Month Unlimited Membership" in live data).
//
// STILL TODO / UNCONFIRMED:
//   - Class packs: no class-pack/credit-based resource found yet in this
//     pass (only membership_instances, which covers trials + real
//     memberships). getMembershipStatus() below never returns 'class_pack'
//     as a result — clients on a pack currently fall through to
//     'no_active_status' until this is found.
//   - membership_paused: relationships.membership_freeze existing (vs null)
//     is assumed to mean paused, and resumesAt is left null — never
//     observed a real frozen membership to confirm the shape.
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
      const instances = d.data;
      if (instances.length === 0) return { kind: 'no_active_status' };

      const active = instances.find((i) => i.attributes.status === 'active');
      if (active) {
        const a = active.attributes;
        if (a.is_intro_offer) {
          return {
            kind: 'trial_offer',
            offerName: a.membership_name,
            startDate: a.start_date,
            endDate: a.scheduled_end_datetime ?? a.next_charge_date ?? a.start_date,
            // Not derivable from membership_instances — unused by the current
            // playbook rules (they key off dates, not class counts), so this
            // is a harmless placeholder rather than a real figure.
            classesUsed: 0,
            classesIncluded: 999,
          };
        }
        if (active.relationships?.membership_freeze?.data) {
          // TODO: never observed a real frozen membership — resumesAt unconfirmed.
          return { kind: 'membership_paused', planName: a.membership_name, resumesAt: null };
        }
        return { kind: 'membership_active', planName: a.membership_name, memberSince: a.start_date };
      }

      const mostRecentEnded = [...instances]
        .filter((i) => i.attributes.status !== 'active')
        .sort((x, y) => {
          const xEnd = x.attributes.cancellation_datetime ?? x.attributes.scheduled_end_datetime ?? '';
          const yEnd = y.attributes.cancellation_datetime ?? y.attributes.scheduled_end_datetime ?? '';
          return yEnd.localeCompare(xEnd);
        })[0];
      if (mostRecentEnded) {
        const a = mostRecentEnded.attributes;
        return {
          kind: 'membership_lapsed',
          planName: a.membership_name,
          endedAt: a.cancellation_datetime ?? a.scheduled_end_datetime ?? a.start_date,
        };
      }
      return { kind: 'no_active_status' };
    },
  };
}
