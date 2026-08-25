export type TouchOutcome = 'proposed' | 'approved' | 'edited' | 'rejected' | 'sent' | 'converted' | 'no_response';

export interface TouchLogEntry {
  id: string;
  contactId: string; // Mariana Tek client id
  segmentKey: string; // e.g. "trial_1week_convert" — the learning loop groups by this
  channel: 'email' | 'text';
  classSessionId: string;
  proposedAt: string; // ISO — when the recap proposed this action
  status: TouchOutcome;
  /** Set when status moves past 'proposed' — e.g. Lucas approves/rejects/edits a recap item. */
  outcomeAt?: string;
  /** Free-text context on the outcome, e.g. "edited: swapped to text" or "bought 10-class pack instead of membership". */
  outcomeNote?: string;
}

export interface Store {
  processedClassSessions: Record<string, { processedAt: string }>;
  touchLog: TouchLogEntry[];
}

export const EMPTY_STORE: Store = {
  processedClassSessions: {},
  touchLog: [],
};
