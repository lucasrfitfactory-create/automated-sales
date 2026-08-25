import type { HighLevelClient, HlContact } from './types.js';

// Real HighLevel API v2 client. Verified against the public docs
// (marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact/ and
// .../conversations/send-a-new-message/, 2026-08-25) — unlike Mariana Tek,
// this API is openly documented, so these shapes are real, not guesses.
// Still untested against a live account (no token yet).

const BASE_URL = 'https://services.leadconnectorhq.com';
const API_VERSION = 'v3';

export function createRealHighLevelClient(opts: { token: string; locationId: string }): HighLevelClient {
  const { token, locationId } = opts;

  async function api<T>(path: string, body: object): Promise<T> {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${token}`,
        Version: API_VERSION,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`HighLevel API ${path} failed: ${res.status} ${await res.text()}`);
    }
    return res.json() as Promise<T>;
  }

  async function sendMessage(
    contactId: string,
    type: 'SMS' | 'Email',
    extra: { message?: string; subject?: string; html?: string }
  ): Promise<{ messageId: string }> {
    const data = await api<{ messageId: string }>('/conversations/messages', {
      type,
      contactId,
      ...extra,
    });
    return { messageId: data.messageId };
  }

  return {
    async upsertContact(input) {
      const data = await api<{ new: boolean; contact: { id: string } }>('/contacts/upsert', {
        locationId,
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        phone: input.phone,
      });
      const contact: HlContact = { id: data.contact.id, ...input, isNew: data.new };
      return contact;
    },
    async sendEmail(contactId, { subject, body }) {
      return sendMessage(contactId, 'Email', { subject, html: `<p>${body}</p>`, message: body });
    },
    async sendSms(contactId, { body }) {
      return sendMessage(contactId, 'SMS', { message: body });
    },
  };
}
