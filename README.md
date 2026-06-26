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

## AI/Model Usage & Orchestration

QueueStorm Investigator employs a dual-model orchestration strategy for optimal latency, compliance, and reliability:

- **Primary Model (Cloudflare Workers AI)**: By default, if deployed on Cloudflare Workers or running via Wrangler, the system utilizes `@cf/meta/llama-3.1-8b-instruct-fast` running on serverless GPUs.
  - **Structured JSON Mode**: Uses Cloudflare's native `json_schema` constraint validation to enforce JSON responses conforming exactly to the Zod contract schema.
  - **Truncation Prevention**: Enforces a `max_tokens: 1024` generation window to support full object serialization.
- **Fallback Model (Google Gemini)**: If the Workers AI binding is missing (such as inside a Docker container or standalone Node environment) or if GPU inference encounters a failure, the analyzer seamlessly catches the error and falls back to **Google Gemini** (`gemma-4-31b-it`).
  - **Structured JSON**: Enforces strict schemas using Hono's Zod-OpenAPI translation via `responseJsonSchema`.
- **Low-Temperature Control:** Both backends run at `temperature: 0.2` to maintain consistent, reliable, and deterministic outputs.
- **Few-Shot Learning:** Embedded scenarios (`SAMPLE_CASES`) are pre-programmed directly into the system prompts to teach tone, routing rules, and classification criteria before generation.

---

## Containerization & Deployment

The application is fully containerized and can run natively as a Node.js server using `@hono/node-server`.

### 1. Run via Docker Compose (Recommended)
This automatically builds the image and mounts the local `.env` variables:
```bash
docker-compose up --build
```
The server will start on port `8000` (e.g. `http://localhost:8000`).

### 2. Manual Docker Deployment
1. **Build Image**:
   ```bash
   docker build . -t support-bot
   ```
2. **Run Container**:
   Pass your local environment file via the `--env-file` argument:
   ```bash
   docker run --rm -d --name test-support-bot -p 8000:8000 --env-file .env support-bot
   ```

*Note: Since the standalone Node/Docker container runs outside of wrangler/miniflare, it will automatically route all requests to the **Gemini API fallback**.*

---

## Running Verification & Tests

### 1. Cloudflare Workers Unit Tests (Vitest)
Executes Hono request test suites against the simulated Workers runtime:
```bash
pnpm exec vitest run
```

### 2. Run Test Harness against Local Wrangler
Starts wrangler development server and runs the concurrent test suite:
```bash
pnpm dev
pnpm test
```

### 3. Run Test Harness against Docker Container
Verify the containerized deployment by pointing the test harness to port `8000`:
```bash
pnpm test http://localhost:8000
```

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
3. **Key Rotation & Rate Limiting (Gemini fallback):**
   - Evaluates API key health and implements client-side round-robin rotation over comma-separated keys.
   - Throttles requests automatically (at 15 RPM per key) to prevent key starvation and API rate-limiting errors.
4. **Resiliency & Timeout Rules:**
   - Retries transient upstream errors (e.g., HTTP `429`, `503`, `504`, `500`) up to 3 times internally using exponential backoff.
   - Enforces a safety promise race timeout of 29 seconds to prevent blocking client calls indefinitely.

---

## Limitations

- **API Rate Limits:** The fallback system is fundamentally bounded by the configured Gemini API key quotas. Rotated key setups can alleviate this, but standard/free tiers are capped.
- **Context Limits:** Large transaction logs can hit prompt token limits and negatively impact worker latency and processing cost.
- **Input Structure Dependencies:** Analysis quality relies on structured transaction data. If `transaction_history` is empty or missing, the system will output an `insufficient_data` evidence verdict.
- **Language Scope:** Customer replies adapt to the incoming request language (supporting English and Bengali/Bangla), but agent summaries, reason codes, and next actions are strictly generated in English.
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
