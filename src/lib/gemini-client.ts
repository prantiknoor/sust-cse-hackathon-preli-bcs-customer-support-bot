import { GoogleGenAI } from '@google/genai';
import { env } from '../config/env.js';

let geminiInstance: GoogleGenAI | null = null;

/**
 * Lazily constructs and returns the Google Gen AI client.
 */
export function getGeminiClient(): GoogleGenAI {
  if (!geminiInstance) {
    geminiInstance = new GoogleGenAI({
      apiKey: env.GEMINI_API_KEY,
    });
  }
  return geminiInstance;
}
