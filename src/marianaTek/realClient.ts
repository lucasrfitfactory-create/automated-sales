import type {
  MarianaTekClient,
  MtClassSession,
  MtClient,
  MtMembershipStatus,
  MtRosterEntry,
} from './types.js';

// Real Mariana Tek Admin API client. Endpoint paths below use the resource
// names Mariana Tek's Integrations team confirmed by email (2026-08-25):
// /api/class_sessions, /api/memberships, /api/contracts. Roster/attendance
// and client/contact endpoint names weren't given explicitly, so those two
// are still best guesses. The full schema is behind docs.marianatek.com,
// which is itself gated on having the API key (loads a blank "Loading..."
// spinner without one) — so none of this has been exercised against a real
// spec or a live tenant yet.
//
// TODO once the API key/docs land:
//   - confirm exact resource paths + pagination shape against
//     https://docs.marianatek.com/ (needs the API key to even load)
//   - confirm the roster/attendance and client/contact endpoint names
//   - confirm how "membership status" is derived: /api/memberships and
//     /api/contracts are separate resources, not a single unified status —
//     getMembershipStatus() below will need to fetch a client's active
//     memberships/contracts/packages and reduce them into MtMembershipStatus.
//   - confirm how a ClassPass-sourced booking shows up on the roster
//     (MtRosterEntry.bookingSource) — likely on the reservation, not the
//     roster row itself.

export function createRealMarianaTekClient(opts: { apiUrl: string; apiKey: string }): MarianaTekClient {
  const { apiUrl, apiKey } = opts;

  async function api<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(path, apiUrl);
    if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`Mariana Tek API ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  return {
    async getClassSessions({ locationId, since, before }) {
      const data = await api<{ results: MtClassSession[] }>('/api/class_sessions/', {
        location: locationId,
        start_time__gte: since,
        start_time__lt: before,
      });
      return data.results;
    },
    async getRoster(classSessionId) {
      // TODO: unconfirmed path — Mariana Tek's reply named class_sessions/memberships/contracts
      // but not the roster/attendance resource specifically.
      const data = await api<{ results: MtRosterEntry[] }>(`/api/class_sessions/${classSessionId}/roster/`);
      return data.results;
    },
    async getClient(clientId) {
      // TODO: unconfirmed path — client/contact resource name wasn't given explicitly.
      return api<MtClient>(`/api/clients/${clientId}/`);
    },
    async getMembershipStatus(_clientId): Promise<MtMembershipStatus> {
      throw new Error(
        'getMembershipStatus not yet implemented for the real client — needs to fetch /api/memberships and /api/contracts for this client and reduce them into MtMembershipStatus.'
      );
    },
  };
}
