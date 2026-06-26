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

3. **Run Development Server:**
   ```bash
   pnpm dev
   ```

## API Documentation

Interactive API Reference (Scalar) is available at:
`http://localhost:8787/docs` (when running locally)

The raw OpenAPI 3.1 schema JSON is exposed at:
`http://localhost:8787/openapi.json`

## Current Status

> [!NOTE]
> **Scaffold only** — The `/analyze-ticket` endpoint currently returns a mocked, schema-valid response. The real AI-based evidence reasoning logic will be implemented as the next milestone.

## Project Structure

```
├── src/
│   ├── index.ts                       # Cloudflare Workers default export entrypoint
│   ├── app.ts                         # OpenAPIHono application and routes registration
│   ├── routes/
│   │   ├── health.route.ts            # GET /health endpoint definition
│   │   └── analyze-ticket.route.ts    # POST /analyze-ticket endpoint definition
│   ├── schemas/
│   │   ├── common.schema.ts           # Shared enums (severity, department, etc.)
│   │   ├── ticket-request.schema.ts   # Request body validation schemas
│   │   └── ticket-response.schema.ts  # Response body validation schemas
│   ├── services/
│   │   └── ticket-analyzer.service.ts # Placeholder ticket analysis logic
│   ├── lib/
│   │   └── gemini-client.ts           # Lazily-initialized Google Gen AI client wrapper
│   └── config/
│       └── env.ts                     # Type-safe environment loader and validator (runtime safe)
├── .dev.vars.example
├── .gitignore
├── package.json
├── tsconfig.json
├── wrangler.jsonc
└── README.md
```
