import type { HighLevelClient, HlContact, HlMessage } from './types.js';

// Real HighLevel API v2 client. Verified against the public docs
// (marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact/,
// .../conversations/send-a-new-message/, .../conversations/search-conversation/,
// .../conversations/get-messages/, 2026-08-25) — unlike Mariana Tek, this API
// is openly documented, so these shapes are real, not guesses. The two read
// endpoints' exact response bodies weren't fully expanded in the docs UI, so
// getConversationHistory() parses defensively and needs a real run to
// confirm the shape.

const BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = 'v3';

export function createRealHighLevelClient(opts: { token: string; locationId: string }): HighLevelClient {
  const { token, locationId } = opts;

  const headers = {
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    Version: API_VERSION,
  };

  async function get<T>(path: string, params: Record<string, string>): Promise<T> {
    const url = new URL(path, BASE_URL);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`HighLevel API GET ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async function post<T>(path: string, body: object): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HighLevel API POST ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async function sendMessage(
    contactId: string,
    type: 'SMS' | 'Email',
    extra: { message?: string; subject?: string; html?: string }
  ): Promise<{ messageId: string }> {
    const data = await post<{ messageId: string }>('/conversations/messages', {
      type,
      contactId,
      ...extra,
    });
    return { messageId: data.messageId };
  }

  return {
    async upsertContact(input) {
      const data = await post<{ new: boolean; contact: { id: string } }>('/contacts/upsert', {
        locationId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
      });
      const contact: HlContact = { id: data.contact.id, ...input, isNew: data.new };
      return contact;
    },
    async getConversationHistory(contactId) {
      const searchData = await get<any>('/conversations/search', { locationId, contactId });
      const conversations: any[] = searchData.conversations ?? searchData.conversation ?? [];
      if (conversations.length === 0) return [];

      const allMessages: HlMessage[] = [];
      for (const convo of conversations) {
        const convoId = convo.id ?? convo.conversationId;
        if (!convoId) continue;
        const msgData = await get<any>(`/conversations/${convoId}/messages`, { limit: '50' });
        const rawMessages: any[] = msgData.messages?.messages ?? msgData.messages ?? [];
        for (const m of rawMessages) {
          allMessages.push({
            id: m.id ?? m.messageId ?? 'unknown',
            type: m.type ?? m.messageType ?? 'unknown',
            direction: m.direction === 'inbound' || m.direction === 'outbound' ? m.direction : 'unknown',
            body: m.body ?? m.message ?? null,
            dateAdded: m.dateAdded ?? null,
          });
        }
      }
      return allMessages.sort((a, b) => (b.dateAdded ?? '').localeCompare(a.dateAdded ?? ''));
    },
    async sendEmail(contactId, { subject, body }) {
      return sendMessage(contactId, 'Email', { subject, html: `<p>${body}</p>`, message: body });
    },
    async sendSms(contactId, { body }) {
      return sendMessage(contactId, 'SMS', { message: body });
    },
  };
}
