import { z } from 'zod';

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
  GEMINI_MODEL: z.string().default('gemma-4-31b-it'),
});

let validatedEnv: z.infer<typeof envSchema> | null = null;
let parsedApiKeys: string[] | null = null;

/**
 * Validates and returns the environment variables.
 * Designed to lazy-load to prevent crashing during Wrangler build/typegen phases.
 */
export function getEnv(overrideEnv?: any) {
  if (!validatedEnv) {
    const source = { ...process.env, ...overrideEnv };
    const parsed = envSchema.safeParse(source);
    if (!parsed.success) {
      console.error('❌ Environment validation failed:', parsed.error.format());
      throw new Error('Missing or invalid environment variables. Ensure GEMINI_API_KEY is defined in .env or environment.');
    }
    validatedEnv = parsed.data;
  }
  return validatedEnv;
}

/**
 * Parses GEMINI_API_KEY as a comma-separated list and returns all valid keys.
 * Supports key rotation: "key1,key2,key3"
 */
export function getApiKeys(overrideEnv?: any): string[] {
  if (!parsedApiKeys) {
    const raw = getEnv(overrideEnv).GEMINI_API_KEY;
    parsedApiKeys = raw
      .split(',')
      .map((k) => k.trim())
      .filter((k) => k.length > 0);

    if (parsedApiKeys.length === 0) {
      throw new Error('No valid API keys found in GEMINI_API_KEY');
    }
    console.log(`🔑 Loaded ${parsedApiKeys.length} Gemini API key(s)`);
  }
  return parsedApiKeys;
}

export const env = {
  get GEMINI_API_KEY() {
    return getEnv().GEMINI_API_KEY;
  }
};
export type Env = z.infer<typeof envSchema>;
