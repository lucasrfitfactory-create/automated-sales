import { loadStore, saveStore } from './db.js';
import type { Store, TouchLogEntry } from './types.js';

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

  save(): void {
    saveStore(this.path, this.store);
  }
}
