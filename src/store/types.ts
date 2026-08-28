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
  /** Denormalized at proposal time so `npm run send` can dispatch without re-running assess. */
  recipient: { firstName: string; lastName: string; email: string | null; phone: string | null };
  headline: string;
  message: string;
  /** Email fallback if this touch (always text, when set) gets no reply — checked by `npm run check-replies`. */
  followUp?: {
    channel: 'email';
    headline: string;
    message: string;
    afterDays: number;
    /** Set once the follow-up itself has been proposed, so it's never proposed twice for the same original touch. */
    proposedTouchId?: string;
  };
}

export interface Store {
  processedClassSessions: Record<string, { processedAt: string }>;
  touchLog: TouchLogEntry[];
  /** "Where the pipeline left off" per cursor key — drives `npm run gather`'s catch-up window. */
  cursors: Record<string, string>;
}

export const EMPTY_STORE: Store = {
  processedClassSessions: {},
  touchLog: [],
  cursors: {},
};
