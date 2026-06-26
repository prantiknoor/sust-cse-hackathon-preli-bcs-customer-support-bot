import { z } from '@hono/zod-openapi';
import { TicketRequestSchema } from '../schemas/ticket-request.schema.js';
import { TicketResponseSchema } from '../schemas/ticket-response.schema.js';
import { getGeminiClient } from '../lib/gemini-client.js';
import { getEnv } from '../config/env.js';
import { SAMPLE_CASES } from '../config/sample-cases.js';

type TicketRequest = z.infer<typeof TicketRequestSchema>;
type TicketResponse = z.infer<typeof TicketResponseSchema>;

// ---------------------------------------------------------------------------
// 1. Response Schema for Structured LLM Output
// ---------------------------------------------------------------------------

/**
 * Internal Zod schema used exclusively for the Gemini responseJsonSchema.
 * We use plain `z` (not the openapi-extended version) so that
 * `z.toJSONSchema` works correctly without OpenAPI metadata.
 */
const LLMResponseSchema = z.object({
  ticket_id: z.string(),
  relevant_transaction_id: z.string().nullable(),
  evidence_verdict: z.enum(['consistent', 'inconsistent', 'insufficient_data']),
  case_type: z.enum([
    'wrong_transfer',
    'payment_failed',
    'refund_request',
    'duplicate_payment',
    'merchant_settlement_delay',
    'agent_cash_in_issue',
    'phishing_or_social_engineering',
    'other',
  ]),
  severity: z.enum(['low', 'medium', 'high', 'critical']),
  department: z.enum([
    'customer_support',
    'dispute_resolution',
    'payments_ops',
    'merchant_operations',
    'agent_operations',
    'fraud_risk',
  ]),
  agent_summary: z.string(),
  recommended_next_action: z.string(),
  customer_reply: z.string(),
  human_review_required: z.boolean(),
  confidence: z.number(),
  reason_codes: z.array(z.string()),
});

// ---------------------------------------------------------------------------
// 2. Orchestration & Prompt Engine
// ---------------------------------------------------------------------------

/**
 * Maps a transaction history array into a human-readable text block
 * for context injection into the LLM prompt.
 */
function formatTransactionHistory(
  transactions: TicketRequest['transaction_history']
): string {
  if (!transactions || transactions.length === 0) {
    return 'No transaction records available.';
  }

  return transactions
    .map(
      (tx, i) =>
        `  ${i + 1}. [${tx.transaction_id}] ${tx.type.toUpperCase()} | ` +
        `Amount: ${tx.amount} | To/From: ${tx.counterparty} | ` +
        `Status: ${tx.status} | Time: ${tx.timestamp}`
    )
    .join('\n');
}

/**
 * Builds the few-shot examples block from the embedded sample cases.
 */
function buildFewShotBlock(): string {
  return SAMPLE_CASES.map((sc, i) => {
    const txBlock = sc.input.transaction_history
      .map(
        (tx, j) =>
          `    ${j + 1}. [${tx.transaction_id}] ${tx.type.toUpperCase()} | ` +
          `Amount: ${tx.amount} | To/From: ${tx.counterparty} | ` +
          `Status: ${tx.status} | Time: ${tx.timestamp}`
      )
      .join('\n');

    return `--- Example ${i + 1} ---
Ticket ID: ${sc.input.ticket_id}
Complaint: "${sc.input.complaint}"
Transaction Ledger:
${txBlock}

Expected Output:
${JSON.stringify(sc.output, null, 2)}
--- End Example ${i + 1} ---`;
  }).join('\n\n');
}

/**
 * Assembles the full system prompt with role definition,
 * safety rules, few-shot examples, and output expectations.
 */
function buildSystemPrompt(): string {
  const fewShotBlock = buildFewShotBlock();

  return `You are QueueStorm Investigator, an expert AI agent for a digital finance platform's customer support system. Your job is to analyze support tickets by cross-referencing the customer's complaint against the transaction ledger data.

## Your Core Task
1. Read the customer's complaint carefully.
2. Compare it against the provided transaction ledger records.
3. Determine if the evidence is consistent, inconsistent, or insufficient.
4. Classify the case type, severity, and target department.
5. Write a factual agent_summary describing the discrepancy analysis.
6. Draft a professional, empathetic customer_reply.
7. Suggest a concrete recommended_next_action for the internal team.

## Evidence Verdict Rules (STRICT)
- "consistent": The transaction records directly support what the customer claims. There is a clear matching transaction and the details align.
- "inconsistent": The transaction records contradict the customer's claim. Examples:
  - Customer claims "wrong transfer" but the ledger shows they have a PATTERN of repeated transfers to the SAME recipient (suggesting an established relationship, not a mistake).
  - Customer says payment failed but ledger shows it completed.
  - Customer claims an amount but the ledger shows a different amount.
- "insufficient_data": Use this when:
  - The transaction_history array is EMPTY — there is no ledger data to verify any claim against, so evidence is always insufficient.
  - The complaint is too vague to match any specific transaction.
  - Multiple transactions could match and you cannot determine which one the customer is referring to without more information.
  - There is no transaction in the ledger that corresponds to the customer's claim.

IMPORTANT: If transaction_history is empty or has no relevant transactions, you MUST use "insufficient_data" — never "consistent" or "inconsistent" without ledger evidence.

## Ambiguous Matches / Multiple Plausible Transactions (CRITICAL)
- If there are multiple transactions in the history that match the amount and type specified in the complaint, it is AMBIGUOUS, and you MUST:
  1. Set relevant_transaction_id to null (do NOT guess).
  2. Set evidence_verdict to "insufficient_data".
  3. Draft customer_reply to ask the customer to clarify (e.g., ask for the recipient's number, transaction ID, or exact time) to identify the correct transaction.
- Example: If a customer says "I sent 1000 to my brother yesterday but he did not receive it" and there are multiple transactions of 1000 on that date (even if one is failed and others completed), this is AMBIGUOUS. Set relevant_transaction_id to null and verdict to "insufficient_data".
- However, if there is exactly ONE transaction in the history that matches the amount and type specified in the complaint, it is NOT ambiguous, even if there are other transactions of different amounts in the history. In that case, you MUST select that single matching transaction and set relevant_transaction_id to its ID.

## Case Type Classification
- "wrong_transfer": Customer claims money was sent to the wrong recipient, OR customer sent money but recipient didn't receive it. Use this even if the exact transaction is ambiguous — the customer's INTENT indicates a wrong/failed transfer.
- "payment_failed": A payment to a merchant/biller failed but the customer's balance was deducted.
- "refund_request": Customer wants money back for a completed transaction (e.g., change of mind, product not received).
- "duplicate_payment": Two or more identical (or near-identical) payments to the same counterparty within a very short time window.
- "merchant_settlement_delay": A merchant reports that their settlement funds have not arrived on schedule.
- "agent_cash_in_issue": A cash-in via an agent is not reflected in the customer's balance.
- "phishing_or_social_engineering": Customer reports being contacted by someone impersonating the company, or reports sharing credentials under pressure.
- "other": Only use if no other category fits after careful consideration.

## Severity Classification (STRICT MAPPING)
You MUST classify case severity strictly based on the Case Type, Evidence Verdict, and context:
- "critical": Always use for "phishing_or_social_engineering" cases.
- "high": Use for:
  - "payment_failed" cases.
  - "duplicate_payment" cases.
  - "agent_cash_in_issue" cases.
  - "wrong_transfer" cases where the evidence_verdict is "consistent".
- "medium": Use for:
  - "merchant_settlement_delay" cases.
  - "wrong_transfer" cases where the evidence_verdict is "inconsistent" or "insufficient_data".
  - Contested "refund_request" cases (e.g. if the merchant refuses or there is an active conflict).
- "low": Use for simple, uncontested "refund_request" cases and "other" cases.

## Department Routing (STRICT MAPPING)
You MUST route tickets to departments strictly based on the Case Type, Severity, and user context:
- "customer_support": Use for "other" cases, low severity "refund_request" cases, and vague or insufficient data cases.
- "dispute_resolution": Use for "wrong_transfer" cases and contested "refund_request" cases.
- "payments_ops": Use for "payment_failed" and "duplicate_payment" cases.
- "merchant_operations": Use for "merchant_settlement_delay" cases and merchant-side complaints (e.g. user_type is "merchant" or channel is "merchant_portal").
- "agent_operations": Use for "agent_cash_in_issue" cases and agent-side complaints (e.g. user_type is "agent" or channel is "field_agent").
- "fraud_risk": Use for "phishing_or_social_engineering" cases and suspicious activity patterns.

## Critical Safety Rules (MUST FOLLOW)
- NEVER ask the customer for PIN, OTP, password, CVV, or any credentials in your customer_reply or recommended_next_action.
- NEVER promise or confirm a refund has been processed. Do NOT use phrases like "we have refunded", "money sent back", "refund processed", or "amount has been returned". Instead, if a refund may be applicable, use: "Any eligible amount will be returned through official channels."
- Keep the customer_reply professional, empathetic, and concise.
- The agent_summary should be objective and reference specific transaction IDs when possible.

## Language Handling
- If the complaint is in Bengali (Bangla), respond in Bengali in the customer_reply.
- If the complaint is in English, respond in English in the customer_reply.
- If mixed, prefer English for the customer_reply.
- The agent_summary and recommended_next_action should always be in English.

## Few-Shot Examples
Below are reference examples showing the expected analysis quality and format:

${fewShotBlock}

## Output
Return a JSON object matching the provided schema exactly. Ensure all enum values are valid. Set confidence between 0 and 1 based on how certain you are of the analysis.`;
}

/**
 * Builds the user-facing prompt with the actual ticket data.
 */
function buildUserPrompt(request: TicketRequest): string {
  const txBlock = formatTransactionHistory(request.transaction_history);

  const parts = [
    `Analyze the following support ticket:`,
    ``,
    `Ticket ID: ${request.ticket_id}`,
    `Complaint: "${request.complaint}"`,
  ];

  if (request.language) parts.push(`Language: ${request.language}`);
  if (request.channel) parts.push(`Channel: ${request.channel}`);
  if (request.user_type) parts.push(`User Type: ${request.user_type}`);
  if (request.campaign_context)
    parts.push(`Campaign Context: ${request.campaign_context}`);

  parts.push('', 'Transaction Ledger:', txBlock);

  if (request.metadata && Object.keys(request.metadata).length > 0) {
    parts.push('', `Metadata: ${JSON.stringify(request.metadata)}`);
  }

  parts.push(
    '',
    'Provide your structured analysis as a JSON object matching the schema.'
  );

  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// 3. Deterministic Guardrail Layer (Post-Processor)
// ---------------------------------------------------------------------------

const SAFE_REFUND_TEXT =
  'Any eligible amount will be returned through official channels';

/**
 * Sanitizes text fields to remove credential references and
 * unauthorized refund assertions. Acts as a deterministic fail-safe
 * that does not rely on the LLM's instruction-following.
 */
function sanitizeText(text: string): string {
  // Run replacements directly — .replace() with /g is idempotent when no match
  let sanitized = text.replace(
    /\b(pin|otp|password|credential|cvv|secret\s*code|security\s*code)\b/gi,
    '[REDACTED]'
  );

  sanitized = sanitized.replace(
    /\b(we have refunded|refund has been processed|money sent back|refund processed|amount has been returned|we('ve| have) (already )?(refunded|returned|sent back)|your (money|funds|amount) (has|have) been (refunded|returned|sent back))\b/gi,
    SAFE_REFUND_TEXT
  );

  return sanitized;
}

/**
 * Applies all guardrails to the LLM response before returning.
 */
function applyGuardrails(response: TicketResponse, request: TicketRequest): TicketResponse {
  // Enforce department mapping
  let department = response.department;

  // 1. Merchant-side complaints go to merchant_operations
  if (request.user_type === 'merchant' || request.channel === 'merchant_portal') {
    department = 'merchant_operations';
  }
  // 2. Agent-side complaints go to agent_operations
  else if (request.user_type === 'agent' || request.channel === 'field_agent') {
    department = 'agent_operations';
  }
  // 3. Normal case-based routing
  else {
    switch (response.case_type) {
      case 'wrong_transfer':
        department = 'dispute_resolution';
        break;
      case 'payment_failed':
      case 'duplicate_payment':
        department = 'payments_ops';
        break;
      case 'phishing_or_social_engineering':
        department = 'fraud_risk';
        break;
      case 'merchant_settlement_delay':
        department = 'merchant_operations';
        break;
      case 'agent_cash_in_issue':
        department = 'agent_operations';
        break;
      case 'refund_request':
        // Low severity refund_request goes to customer_support, contested goes to dispute_resolution
        const complaintLower = request.complaint.toLowerCase();
        const isContested =
          complaintLower.includes('refuse') ||
          complaintLower.includes('won\'t') ||
          complaintLower.includes('wont') ||
          complaintLower.includes('decline') ||
          complaintLower.includes('dispute') ||
          complaintLower.includes('deny') ||
          complaintLower.includes('denied') ||
          response.severity === 'medium' ||
          response.severity === 'high' ||
          response.severity === 'critical';

        if (isContested) {
          department = 'dispute_resolution';
        } else {
          department = 'customer_support';
        }
        break;
      case 'other':
      default:
        department = 'customer_support';
        break;
    }
  }

  // Enforce severity mapping
  let severity = response.severity;
  switch (response.case_type) {
    case 'phishing_or_social_engineering':
      severity = 'critical';
      break;
    case 'payment_failed':
    case 'duplicate_payment':
    case 'agent_cash_in_issue':
      severity = 'high';
      break;
    case 'wrong_transfer':
      if (response.evidence_verdict === 'consistent') {
        severity = 'high';
      } else {
        severity = 'medium';
      }
      break;
    case 'merchant_settlement_delay':
      severity = 'medium';
      break;
    case 'refund_request':
      // Low severity for simple refund requests, medium if contested
      const complaintLower = request.complaint.toLowerCase();
      const isContested =
        complaintLower.includes('refuse') ||
        complaintLower.includes('won\'t') ||
        complaintLower.includes('wont') ||
        complaintLower.includes('decline') ||
        complaintLower.includes('dispute') ||
        complaintLower.includes('deny') ||
        complaintLower.includes('denied');
      if (isContested) {
        severity = 'medium';
      } else {
        severity = 'low';
      }
      break;
    case 'other':
      severity = 'low';
      break;
  }

  return {
    ...response,
    department,
    severity,
    customer_reply: sanitizeText(response.customer_reply),
    recommended_next_action: sanitizeText(response.recommended_next_action),
    // Also sanitize agent_summary for extra safety
    agent_summary: sanitizeText(response.agent_summary),
  };
}

// ---------------------------------------------------------------------------
// 4. Core Analysis Function
// ---------------------------------------------------------------------------

async function analyzeTicketInner(request: TicketRequest, overrideEnv?: any): Promise<TicketResponse> {
  const systemPrompt = buildSystemPrompt();
  const userPrompt = buildUserPrompt(request);

  // Convert the Zod schema to JSON Schema for the Gemini structured output
  const jsonSchema = z.toJSONSchema(LLMResponseSchema);

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    attempts++;
    const ai = await getGeminiClient(overrideEnv);
    const modelName = getEnv(overrideEnv).GEMINI_MODEL || 'gemma-4-31b-it';
    const startTime = Date.now();
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: userPrompt,
        config: {
          systemInstruction: systemPrompt,
          responseMimeType: 'application/json',
          responseJsonSchema: jsonSchema,
          temperature: 0.2,  // Low temperature for consistent, deterministic analysis
        },
      });

      const latencyMs = Date.now() - startTime;
      const inputTokens = response.usageMetadata?.promptTokenCount ?? 0;
      const outputTokens = response.usageMetadata?.candidatesTokenCount ?? 0;
      console.log(
        `📊 [LLM Call Success] Model: ${modelName} | Attempt: ${attempts} | Latency: ${latencyMs}ms | Input Tokens: ${inputTokens} | Output Tokens: ${outputTokens}`
      );

      const rawText = response.text;
      if (!rawText) {
        throw new Error('Empty response from LLM');
      }

      // Parse and validate against our Zod schema
      const parsed = JSON.parse(rawText);

      // Force the ticket_id to match the request (never trust LLM for this)
      parsed.ticket_id = request.ticket_id;

      // Clamp confidence to [0, 1] range
      if (typeof parsed.confidence === 'number') {
        parsed.confidence = Math.max(0, Math.min(1, parsed.confidence));
      }

      // Validate with the response schema
      const validated = TicketResponseSchema.parse(parsed);

      // Apply deterministic guardrails before returning
      return applyGuardrails(validated, request);
    } catch (e) {
      const latencyMs = Date.now() - startTime;
      const errorMsg = (e as Error).message || '';
      console.warn(
        `⚠️ [LLM Call Failed] Model: ${modelName} | Attempt: ${attempts} | Latency: ${latencyMs}ms | Error: ${errorMsg}`
      );

      const isTransient =
        errorMsg.includes('Retryable') ||
        errorMsg.includes('429') ||
        errorMsg.includes('503') ||
        errorMsg.includes('504') ||
        errorMsg.includes('Service Unavailable') ||
        errorMsg.includes('Gateway Timeout') ||
        errorMsg.includes('Internal Server Error') ||
        errorMsg.includes('Unavailable');

      if (isTransient && attempts < maxAttempts) {
        console.warn(`⚠️ Transient LLM error (attempt ${attempts}/${maxAttempts}): ${errorMsg}. Retrying in 2s...`);
        console.warn('Stack Trace:\n', (e as Error).stack);
        await new Promise((resolve) => setTimeout(resolve, 2000));
        continue;
      }
      throw e;
    }
  }
  throw new Error('LLM call failed after max attempts');
}

/**
 * Public entry point: runs the LLM analysis with a 25-second timeout.
 */
export async function analyzeTicket(request: TicketRequest, overrideEnv?: any): Promise<TicketResponse> {
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Timeout')), 29000);
  });

  // SAFETY: when Promise is resolved, the value is always TicketResponse
  return await Promise.race([analyzeTicketInner(request, overrideEnv), timeoutPromise]) as TicketResponse;
}
