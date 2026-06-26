# bcs-sust-cse-carnival-hackathon-preli-support-bot

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
   Create a local environment variables file:
   ```bash
   cp .env.example .env
   ```
   *Make sure to configure the following variables inside `.env`:*
   - `GEMINI_API_KEY`: Your Gemini API key. Supports key rotation: You can provide multiple comma-separated keys (e.g. `key1,key2,key3`).
   - `GEMINI_MODEL`: (Optional) The LLM to use. Defaults to `gemma-4-31b-it`. You can set this to `gemini-2.5-flash` for ~3x faster response speeds if using pay-as-you-go keys.

---

## Running the Application

### Run Development Server
To start the local wrangler development server (usually listens on `http://localhost:8787`):
```bash
pnpm dev
```

### Run Tests
To run the automated concurrent test suite against the local wrangler server:
```bash
pnpm test
```

### API Documentation
Interactive API docs (served via Scalar) are available at:
`http://localhost:8787/docs`

---

## Sample Request

To analyze a ticket, send a `POST` request to `/analyze-ticket` with a JSON payload specifying the `ticket_id`, the customer's `complaint`, and their relevant `transaction_history` ledger.

### Example `curl` Command
```bash
curl -X POST http://localhost:8787/analyze-ticket \
  -H "Content-Type: application/json" \
  -d '{
    "ticket_id": "TKT-98765",
    "complaint": "I paid 1500 taka to FoodPanda but transaction failed. However money was deducted from my account. Please refund immediately.",
    "transaction_history": [
      {
        "transaction_id": "TXN123456789",
        "timestamp": "2026-06-26T20:13:11.000Z",
        "type": "payment",
        "amount": 1500,
        "counterparty": "FoodPanda",
        "status": "failed"
      }
    ]
  }'
```

---

## Sample Response

A successful analysis returns a `200 OK` response with a structured JSON object containing routing suggestions, severity metrics, and customized customer responses.

### Example Response Payload
```json
{
  "ticket_id": "TKT-98765",
  "relevant_transaction_id": "TXN123456789",
  "evidence_verdict": "consistent",
  "case_type": "payment_failed",
  "severity": "high",
  "department": "payments_ops",
  "agent_summary": "Customer reports a failed payment of 1500 BDT to FoodPanda with funds still deducted. System records show TXN123456789 as a failed payment of 1500 BDT to FoodPanda. The claim is consistent with a debit-on-fail scenario.",
  "recommended_next_action": "Verify the settlement status with the FoodPanda payment gateway. If no settlement occurred, initiate an auto-reversal for TXN123456789.",
  "customer_reply": "Dear customer, we can see that your payment of 1500 BDT to FoodPanda (TXN123456789) was recorded as failed. We are investigating the discrepancy and working to resolve this. Any eligible amount will be returned through official channels.",
  "human_review_required": false,
  "confidence": 0.95,
  "reason_codes": [
    "PAYMENT_FAILED",
    "FUNDS_DEDUCTED_ON_FAIL"
  ]
}
```

---

## AI/Model Usage

QueueStorm Investigator leverages the official Google `@google/genai` SDK to execute robust analysis tasks:

- **Model Selection:** Defaults to `gemma-4-31b-it` due to its generous rate limit profiles, with dynamic support for switching to `gemini-2.5-flash` via the `GEMINI_MODEL` environment variable.
- **Structured JSON Schema:** Uses Hono's Zod-OpenAPI integration to generate OpenAPI specs and enforces strict JSON responses by passing `responseJsonSchema` (derived via Zod schema translation) directly to `ai.models.generateContent`.
- **Low-Temperature Control:** Uses a `temperature: 0.2` setting to maintain consistency, reliability, and deter model hallucinations.
- **Few-Shot Learning:** Embedded few-shot scenarios (`SAMPLE_CASES`) are formatted into the system instructions to pre-program target behaviors, tone, and verdict logic before runtime processing.

---

## Safety Logic & Guardrails

The service implements multi-tier defensive guardrails that do not rely solely on the LLM's instruction-following:

1. **Deterministic Text Sanitization:**
   - **Credential Redaction:** Automatically scans and strips credentials, passwords, PINs, OTPs, CVVs, and secret keys, replacing them with `[REDACTED]` in all output fields.
   - **Refund Control:** Intercepts unauthorized refund promises (e.g., "we have refunded", "money sent back") and replaces them with a compliant policy text: `"Any eligible amount will be returned through official channels"`.
2. **Deterministic Route & Severity Overrides:**
   - Post-processes and overrides the department/severity if they deviate from strict mappings. For example:
     - Promotes all `phishing_or_social_engineering` cases to `critical` severity.
     - Routes all agent-side complaints (`user_type === 'agent'` or `channel === 'field_agent'`) directly to the `agent_operations` department.
     - Routes all merchant-side complaints directly to the `merchant_operations` department.
3. **Key Rotation & Rate Limiting:**
   - Evaluates API key health and implements client-side round-robin rotation over comma-separated keys.
   - Throttles requests automatically (at 15 RPM per key) to prevent key starvation and API rate-limiting errors.
4. **Resiliency & Timeout Rules:**
   - Retries transient upstream errors (e.g., HTTP `429`, `503`, `504`, `500`) up to 3 times internally using exponential backoff.
   - Enforces a safety promise race timeout of 29 seconds to prevent blocking client calls indefinitely.

---

## Limitations

- **API Rate Limits:** The system is fundamentally bounded by the configured Gemini API key quotas. Rotated key setups can alleviate this, but standard/free tiers are capped.
- **Context Limits:** Large transaction logs can hit prompt token limits and negatively impact worker latency and processing cost.
- **Input Structure Dependencies:** Analysis quality relies on structured transaction data. If `transaction_history` is empty or missing, the system will output an `insufficient_data` evidence verdict.
- **Language Scope:** While customer replies adapt to the incoming request language (supporting English and Bengali/Bangla), agent summaries, reason codes, and next actions are strictly generated in English.
- **Stateless Boundaries:** The API processes tickets in isolation. It does not track state across multiple interactions or query historical customer tickets unless provided in the request payload.
- **Ambiguous Matches:** Multiple matching transactions in history trigger an automatic `insufficient_data` verdict and require a human operator (`human_review_required: true`) to resolve the ambiguity.

---

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
├── config/
│   ├── env.ts                     # Environment validator (supports GEMINI_MODEL)
│   └── sample-cases.ts            # Few-shot sample cases
├── tests/
│   ├── harness.mjs                # Concurrent test harness
│   └── SUST_Preli_Sample_Cases.json # Test cases payload
├── .env
├── .env.example
├── .gitignore
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── README.md
```
