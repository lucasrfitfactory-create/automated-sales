import type { HighLevelClient, HlContact } from './types.js';

// Mock HighLevel client — logs what would have been sent instead of actually
// sending, and fabricates contacts/message ids. Lets `npm run send` be
// exercised end to end before a real Private Integration Token is wired in.

const contactsByKey = new Map<string, HlContact>();
let nextId = 1;

export function createMockHighLevelClient(): HighLevelClient {
  return {
    async upsertContact(input) {
      const key = input.email ?? input.phone ?? `${input.firstName}:${input.lastName}`;
      const existing = contactsByKey.get(key);
      if (existing) return { ...existing, isNew: false };
      const contact: HlContact = { id: `mock-hl-${nextId++}`, ...input, isNew: true };
      contactsByKey.set(key, contact);
      return contact;
    },
    async sendEmail(contactId, { subject, body }) {
      console.log(`[mock HighLevel] EMAIL to ${contactId} — "${subject}"\n${body}`);
      return { messageId: `mock-msg-${nextId++}` };
    },
    async sendSms(contactId, { body }) {
      console.log(`[mock HighLevel] SMS to ${contactId} — ${body}`);
      return { messageId: `mock-msg-${nextId++}` };
    },
  };
}
