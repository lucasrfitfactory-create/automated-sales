import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { EMPTY_STORE, type Store } from './types.js';

// Plain JSON-file store. Good enough for a single-location, manually
// triggered tool — swap for Postgres/Supabase if this grows into a
// multi-location or always-on service.

export function loadStore(path: string): Store {
  if (!existsSync(path)) return structuredClone(EMPTY_STORE);
  const raw = readFileSync(path, 'utf-8');
  return { ...structuredClone(EMPTY_STORE), ...JSON.parse(raw) };
}

export function saveStore(path: string, store: Store): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(store, null, 2));
}
