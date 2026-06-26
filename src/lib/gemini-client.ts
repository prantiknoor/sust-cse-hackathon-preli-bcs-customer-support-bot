import { GoogleGenAI } from '@google/genai';
import { getApiKeys } from '../config/env.js';

interface KeyTracker {
  key: string;
  client: GoogleGenAI;
  history: number[];
}

let trackers: KeyTracker[] | null = null;
let currentIndex = 0;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Lazily constructs GoogleGenAI clients for each API key and initializes trackers.
 */
function initTrackers(overrideEnv?: any): KeyTracker[] {
  if (!trackers) {
    const keys = getApiKeys(overrideEnv);
    trackers = keys.map((apiKey) => ({
      key: apiKey,
      client: new GoogleGenAI({
        apiKey,
        httpOptions: {
          retryOptions: {
            attempts: 1
          },
          timeout: 28000
        }
      }),
      history: []
    }));
  }
  return trackers;
}

/**
 * Returns the next available Google Gen AI client using round-robin rotation
 * with rate limiting. If all keys are at capacity (15 requests/min),
 * it sleeps/hangs the connection until the rate limit window resets.
 */
export async function getGeminiClient(overrideEnv?: any): Promise<GoogleGenAI> {
  const pool = initTrackers(overrideEnv);

  while (true) {
    const now = Date.now();

    // Clean up request histories to keep only timestamps from the last 60 seconds
    for (const tracker of pool) {
      tracker.history = tracker.history.filter((t) => now - t < 60000);
    }

    // Try to find a client that has capacity (less than 15 requests in the last 60 seconds)
    for (let i = 0; i < pool.length; i++) {
      const idx = (currentIndex + i) % pool.length;
      const tracker = pool[idx];
      if (tracker.history.length < 15) {
        tracker.history.push(now);
        currentIndex = (idx + 1) % pool.length;
        return tracker.client;
      }
    }

    // If all keys are at capacity, calculate the minimum wait time until a slot frees up
    const waitTimes = pool.map((t) => {
      if (t.history.length === 0) return 0;
      return t.history[0] + 60000 - now;
    });
    const minWait = Math.min(...waitTimes);

    // Sleep for the calculated duration (or at least 1 second) and check again
    await sleep(minWait > 0 ? minWait : 1000);
  }
}
