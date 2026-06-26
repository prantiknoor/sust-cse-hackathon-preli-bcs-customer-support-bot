# QueueStorm Investigator

An AI copilot API designed to classify and route digital-finance support tickets using LLMs. Built with Hono and deployed as a Cloudflare Worker.

## Prerequisites

- Node.js (LTS, v22+)
- pnpm

## Setup

1. **Install Dependencies:**
   ```bash
   pnpm install
   ```

2. **Configure Environment:**
   ```bash
   cp .dev.vars.example .dev.vars
   ```
   *Make sure to configure the `GEMINI_API_KEY` inside `.dev.vars`.*
   *Supports key rotation: You can provide multiple comma-separated keys (e.g. `key1,key2,key3`).*

   Optional variables:
   - `GEMINI_MODEL`: The LLM to use. Defaults to `gemma-4-31b-it`. You can set this to `gemini-2.5-flash` for ~3x faster response speeds if using pay-as-you-go keys.

3. **Run Development Server:**
   ```bash
   pnpm dev
   ```

4. **Run Tests:**
   ```bash
   pnpm test
   ```
   Runs the test suite against the local wrangler server.

## Features & Implementation

### 1. Model Orchestration (Gemma 4 / Gemini 2.5)
- Orchestrates model reasoning using the `@google/genai` SDK.
- Configured to use `gemma-4-31b-it` by default due to its generous rate limit profiles, with dynamic support for switching to `gemini-2.5-flash` via the `GEMINI_MODEL` environment variable.

### 2. Client-Side Global Rate Limiter & Key Rotation
- Tracks request histories of all configured keys.
- Implements round-robin key cycling over comma-separated keys.
- Automatically pauses/throttles incoming requests if all keys are at capacity (15 requests/minute per key) until a slot opens, avoiding resource exhaustion.

### 3. Self-Healing Backend Retries
- Automatically detects transient upstream API errors (429, 503, 504, 500, `Retryable HTTP Error`) and retries up to 3 times internally with exponential backoff.
- The external caller receives a reliable response without raw API failures.

### 4. Strict Taxonomy Mappings & Guardrails
- Enforces strict deterministic mappings for ticket routing and severity levels.
- **Specialized Routing:**
  - `customer_support`: Routes simple/low-severity `refund_request` cases, `other` cases, and vague/insufficient data cases.
  - `dispute_resolution`: Routes `wrong_transfer` cases and contested `refund_request` cases.
  - `merchant_operations`: Routes `merchant_settlement_delay` cases and general merchant-side complaints.
  - `agent_operations`: Routes `agent_cash_in_issue` cases and general agent-side complaints.
- Deterministic guardrail layers sanitize text and filter sensitive data (PIN, OTP, CVV, or unauthorized refund statements).

### 5. Verbose Error Logging
- Server errors, unhandled exceptions, and transient errors print full stack traces (`stack`), nested error chains (`cause`), and verbose properties to the console.
- In case of failures, request payloads are logged alongside the trace for simple local debugging.

### 6. Parallelized Test Harness
- Runs all 10 test cases concurrently in parallel, reducing testing runtimes from **120+ seconds down to under 13 seconds**.

## Project Structure

```
├── src/
├── index.ts                       # Cloudflare Workers default export entrypoint
├── app.ts                         # OpenAPIHono application, routes, and verbose error handling
├── routes/
│   ├── health.route.ts            # GET /health endpoint definition
│   └── analyze-ticket.route.ts    # POST /analyze-ticket endpoint definition
├── schemas/
│   ├── common.schema.ts           # Shared enums (severity, department, etc.)
│   ├── ticket-request.schema.ts   # Request body validation schemas
│   └── ticket-response.schema.ts  # Response body validation schemas
├── services/
│   └── ticket-analyzer.service.ts # Core model reasoning and deterministic mapping logic
├── lib/
│   └── gemini-client.ts           # Global rate-limiting client with key rotation
└── config/
    ├── env.ts                     # Environment validator (supports GEMINI_MODEL)
    └── sample-cases.ts            # Few-shot sample cases
├── tests/
│   ├── harness.mjs                # Concurrent test harness
│   └── SUST_Preli_Sample_Cases.json # Test cases payload
├── .dev.vars.example
├── .gitignore
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── README.md
```
