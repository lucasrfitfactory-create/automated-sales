import { loadStore, saveStore } from './db.js';
import type { Store, TouchLogEntry, TouchOutcome } from './types.js';

const STORE_PATH = process.env.STORE_PATH ?? 'data/store.json';

// Async signatures kept even though the local JSON backing is synchronous —
// this used to be Postgres-backed (ephemeral GitHub Actions runners needed
// network-reachable state) and the pipeline moved back to chat-driven runs
// on Lucas's own machine, where a local file is simpler and sufficient. The
// async shape means callers don't need to change if that ever flips back.

export class Repository {
  private store: Store;

  constructor() {
    this.store = loadStore(STORE_PATH);
  }

  private persist(): void {
    saveStore(STORE_PATH, this.store);
  }

  async isClassProcessed(classSessionId: string): Promise<boolean> {
    return classSessionId in this.store.processedClassSessions;
  }

  async markClassProcessed(classSessionId: string): Promise<void> {
    this.store.processedClassSessions[classSessionId] = { processedAt: new Date().toISOString() };
    this.persist();
  }

  /** Most recent touch for this contact+segment, if any — used to enforce cooldowns. */
  async getLastTouch(contactId: string, segmentKey: string): Promise<TouchLogEntry | undefined> {
    return this.store.touchLog
      .filter((t) => t.contactId === contactId && t.segmentKey === segmentKey)
      .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt))[0];
  }

  async getTouch(id: string): Promise<TouchLogEntry | undefined> {
    return this.store.touchLog.find((t) => t.id === id);
  }

  async recordTouch(entry: TouchLogEntry): Promise<void> {
    this.store.touchLog.push(entry);
    this.persist();
  }

  /** Called once Lucas's decision on a proposed touch is known — this is the learning loop's input. */
  async recordOutcome(id: string, status: TouchOutcome, outcomeNote?: string): Promise<void> {
    const entry = this.store.touchLog.find((t) => t.id === id);
    if (!entry) throw new Error(`touch log entry not found: ${id}`);
    entry.status = status;
    entry.outcomeAt = new Date().toISOString();
    if (outcomeNote) entry.outcomeNote = outcomeNote;
    this.persist();
  }

  async allTouches(): Promise<TouchLogEntry[]> {
    return this.store.touchLog;
  }

  /** "Where the pipeline left off" — drives `npm run gather`'s catch-up window instead of a fixed lookback. */
  async getCursor(key: string): Promise<string | undefined> {
    return this.store.cursors[key];
  }

  async setCursor(key: string, value: string): Promise<void> {
    this.store.cursors[key] = value;
    this.persist();
  }

  /**
   * Any past touch for this contact that was rejected with a note — a
   * signal Lucas may have asked to exclude them from future outreach.
   * Surfaced so a new gather run can flag it rather than silently
   * re-proposing someone who was deliberately turned off.
   */
  async getRejectedTouches(contactId: string): Promise<TouchLogEntry[]> {
    return this.store.touchLog
      .filter((t) => t.contactId === contactId && t.status === 'rejected' && t.outcomeNote)
      .sort((a, b) => (b.outcomeAt ?? '').localeCompare(a.outcomeAt ?? ''));
  }

  /** Marks a touch's follow-up as already queued, so `npm run check-replies` never proposes the same follow-up twice. */
  async markFollowUpProposed(touchId: string, proposedTouchId: string): Promise<void> {
    const entry = this.store.touchLog.find((t) => t.id === touchId);
    if (!entry?.followUp) throw new Error(`touch has no follow-up to mark: ${touchId}`);
    entry.followUp.proposedTouchId = proposedTouchId;
    this.persist();
  }
}
