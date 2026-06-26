import { z } from 'zod';

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(1, 'GEMINI_API_KEY is required'),
});

let validatedEnv: z.infer<typeof envSchema> | null = null;

/**
 * Validates and returns the environment variables.
 * Designed to lazy-load to prevent crashing during Wrangler build/typegen phases.
 */
export function getEnv() {
  if (!validatedEnv) {
    const parsed = envSchema.safeParse(process.env);
    if (!parsed.success) {
      console.error('❌ Environment validation failed:', parsed.error.format());
      throw new Error('Missing or invalid environment variables. Ensure GEMINI_API_KEY is defined in .dev.vars or environment.');
    }
    validatedEnv = parsed.data;
  }
  return validatedEnv;
}

export const env = {
  get GEMINI_API_KEY() {
    return getEnv().GEMINI_API_KEY;
  }
};
export type Env = z.infer<typeof envSchema>;
