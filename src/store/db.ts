import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EMPTY_STORE } from './types.js';
import type { Store } from './types.js';

// Local JSON file store. Everything that runs against it happens in a chat
// session on Lucas's own machine (not an ephemeral cloud runner), so the
// repo directory persisting on disk between sessions is all the durability
// this needs — no external database required.

export function loadStore(path: string): Store {
  if (!existsSync(path)) return structuredClone(EMPTY_STORE);
  const raw = JSON.parse(readFileSync(path, 'utf-8'));
  return { ...structuredClone(EMPTY_STORE), ...raw };
}

export function saveStore(path: string, store: Store): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}
