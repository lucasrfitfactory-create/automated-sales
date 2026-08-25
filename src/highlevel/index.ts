import { createMockHighLevelClient } from './mockClient.js';
import { createRealHighLevelClient } from './realClient.js';
import type { HighLevelClient } from './types.js';

export * from './types.js';

export function createHighLevelClient(env: NodeJS.ProcessEnv): HighLevelClient {
  const mode = env.HIGHLEVEL_MODE ?? 'mock';
  if (mode === 'mock') return createMockHighLevelClient();
  if (mode === 'real') {
    const token = env.HIGHLEVEL_PRIVATE_TOKEN;
    const locationId = env.HIGHLEVEL_LOCATION_ID;
    if (!token || !locationId) {
      throw new Error('HIGHLEVEL_MODE=real requires HIGHLEVEL_PRIVATE_TOKEN and HIGHLEVEL_LOCATION_ID to be set.');
    }
    return createRealHighLevelClient({ token, locationId });
  }
  throw new Error(`Unknown HIGHLEVEL_MODE: ${mode}`);
}
