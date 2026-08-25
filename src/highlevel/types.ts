export interface HlContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  /** Whether this upsert created a brand-new HighLevel contact vs. matched an existing one. */
  isNew: boolean;
}

export interface HlMessage {
  id: string;
  type: string; // e.g. TYPE_SMS, TYPE_EMAIL, TYPE_CALL
  direction: 'inbound' | 'outbound' | 'unknown';
  body: string | null;
  dateAdded: string | null;
}

export interface HighLevelClient {
  /** Find-or-create by email/phone (HighLevel's own dedup rules apply) — no separate search/create needed. */
  upsertContact(input: { firstName: string; lastName: string; email: string | null; phone: string | null }): Promise<HlContact>;
  /** All messages across this contact's conversations, most recent first. Empty array if no conversations yet. */
  getConversationHistory(contactId: string): Promise<HlMessage[]>;
  sendEmail(contactId: string, params: { subject: string; body: string }): Promise<{ messageId: string }>;
  sendSms(contactId: string, params: { body: string }): Promise<{ messageId: string }>;
}
