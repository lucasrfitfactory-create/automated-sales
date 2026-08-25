import { createMockMarianaTekClient } from './mockClient.js';
import { createRealMarianaTekClient } from './realClient.js';
import type { MarianaTekClient } from './types.js';

export * from './types.js';

export function createMarianaTekClient(env: NodeJS.ProcessEnv): MarianaTekClient {
  const mode = env.MARIANA_TEK_MODE ?? 'mock';
  if (mode === 'mock') return createMockMarianaTekClient();
  if (mode === 'real') {
    const apiUrl = env.MARIANA_TEK_API_URL;
    const apiKey = env.MARIANA_TEK_API_KEY;
    if (!apiUrl || !apiKey) {
      throw new Error('MARIANA_TEK_MODE=real requires MARIANA_TEK_API_URL and MARIANA_TEK_API_KEY to be set.');
    }
    return createRealMarianaTekClient({ apiUrl, apiKey });
  }
  throw new Error(`Unknown MARIANA_TEK_MODE: ${mode}`);
}
