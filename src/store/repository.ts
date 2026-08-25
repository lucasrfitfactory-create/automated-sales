import { loadStore, saveStore } from './db.js';
import type { Store, TouchLogEntry, TouchOutcome } from './types.js';

export class Repository {
  private store: Store;

  constructor(private path: string) {
    this.store = loadStore(path);
  }

  isClassProcessed(classSessionId: string): boolean {
    return classSessionId in this.store.processedClassSessions;
  }

  markClassProcessed(classSessionId: string): void {
    this.store.processedClassSessions[classSessionId] = { processedAt: new Date().toISOString() };
  }

  /** Most recent touch for this contact+segment, if any — used to enforce cooldowns. */
  getLastTouch(contactId: string, segmentKey: string): TouchLogEntry | undefined {
    return this.store.touchLog
      .filter((t) => t.contactId === contactId && t.segmentKey === segmentKey)
      .sort((a, b) => b.proposedAt.localeCompare(a.proposedAt))[0];
  }

  recordTouch(entry: TouchLogEntry): void {
    this.store.touchLog.push(entry);
  }

  /** Called once Lucas's decision on a proposed touch is known — this is the learning loop's input. */
  recordOutcome(id: string, status: TouchOutcome, outcomeNote?: string): void {
    const entry = this.store.touchLog.find((t) => t.id === id);
    if (!entry) throw new Error(`touch log entry not found: ${id}`);
    entry.status = status;
    entry.outcomeAt = new Date().toISOString();
    if (outcomeNote) entry.outcomeNote = outcomeNote;
  }

  allTouches(): TouchLogEntry[] {
    return this.store.touchLog;
  }

  save(): void {
    saveStore(this.path, this.store);
  }
}
