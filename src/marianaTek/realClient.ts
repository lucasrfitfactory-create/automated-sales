import type {
  MarianaTekClient,
  MtClassSession,
  MtClient,
  MtMembershipStatus,
  MtRosterEntry,
} from './types.js';

// Real Mariana Tek Admin API client — endpoint paths below are best-guess
// placeholders based on the public Developer Guides overview
// (https://guides.marianatek.com/admin) and need to be verified/fixed once
// we have the actual Admin API reference (delivered with the API key).
// Nothing here has been exercised against a live tenant yet.
//
// TODO once the API key/docs land:
//   - confirm exact resource paths + pagination shape
//   - confirm how "membership status" is derived: Mariana Tek's Admin API
//     exposes purchases/packages/memberships as separate resources, not a
//     single unified status — getMembershipStatus() below will need to
//     fetch a client's active purchases and reduce them into MtMembershipStatus.

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
      const data = await api<{ results: MtClassSession[] }>('/api/classes/sessions/', {
        location: locationId,
        start_time__gte: since,
        start_time__lt: before,
      });
      return data.results;
    },
    async getRoster(classSessionId) {
      const data = await api<{ results: MtRosterEntry[] }>(`/api/classes/sessions/${classSessionId}/roster/`);
      return data.results;
    },
    async getClient(clientId) {
      return api<MtClient>(`/api/customers/clients/${clientId}/`);
    },
    async getMembershipStatus(_clientId): Promise<MtMembershipStatus> {
      throw new Error(
        'getMembershipStatus not yet implemented for the real client — needs the Admin API purchases/packages/memberships reference to map to MtMembershipStatus.'
      );
    },
  };
}
