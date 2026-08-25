export interface TouchLogEntry {
  id: string;
  contactId: string; // Mariana Tek client id
  segmentKey: string; // e.g. "intro_offer_expiring"
  channel: 'email' | 'text';
  classSessionId: string;
  proposedAt: string; // ISO — when the recap proposed this action
  status: 'proposed' | 'approved' | 'sent' | 'rejected';
}

export interface Store {
  processedClassSessions: Record<string, { processedAt: string }>;
  touchLog: TouchLogEntry[];
}

export const EMPTY_STORE: Store = {
  processedClassSessions: {},
  touchLog: [],
};
