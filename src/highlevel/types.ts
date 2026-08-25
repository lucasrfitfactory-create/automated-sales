export interface HlContact {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  /** Whether this upsert created a brand-new HighLevel contact vs. matched an existing one. */
  isNew: boolean;
}

export interface HighLevelClient {
  /** Find-or-create by email/phone (HighLevel's own dedup rules apply) — no separate search/create needed. */
  upsertContact(input: { firstName: string; lastName: string; email: string | null; phone: string | null }): Promise<HlContact>;
  sendEmail(contactId: string, params: { subject: string; body: string }): Promise<{ messageId: string }>;
  sendSms(contactId: string, params: { body: string }): Promise<{ messageId: string }>;
}
