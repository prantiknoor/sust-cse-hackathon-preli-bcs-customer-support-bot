#!/usr/bin/env node

/**
 * Test harness for QueueStorm Investigator.
 *
 * Reads SUST_Preli_Sample_Cases.json, POSTs each case's input to the
 * running /analyze-ticket endpoint, and compares the response against
 * the expected output.
 *
 * Usage:
 *   node tests/harness.mjs                     # defaults to http://localhost:8787
 *   node tests/harness.mjs http://my-host:9000 # custom base URL
 *
 * Exit code 0 = all cases passed, 1 = at least one failure.
 */

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// ── Config ───────────────────────────────────────────────────────────────────

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = process.argv[2] || 'http://localhost:8787';
const ENDPOINT = `${BASE_URL}/analyze-ticket`;
const CASES_PATH = resolve(__dirname, 'SUST_Preli_Sample_Cases.json');
const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 3;

// Safety regex patterns (mirrors the guardrail layer)
const CREDENTIAL_PATTERN =
  /\b(pin|otp|password|credential|cvv|secret\s*code|security\s*code)\b/i;
const REFUND_ASSERTION_PATTERN =
  /\b(we have refunded|refund has been processed|money sent back|refund processed|amount has been returned|we('ve| have) (already )?(refunded|returned|sent back)|your (money|funds|amount) (has|have) been (refunded|returned|sent back))\b/i;

// Allowed enum values (from the schema)
const ENUMS = {
  evidence_verdict: ['consistent', 'inconsistent', 'insufficient_data'],
  case_type: [
    'wrong_transfer', 'payment_failed', 'refund_request', 'duplicate_payment',
    'merchant_settlement_delay', 'agent_cash_in_issue',
    'phishing_or_social_engineering', 'other',
  ],
  severity: ['low', 'medium', 'high', 'critical'],
  department: [
    'customer_support', 'dispute_resolution', 'payments_ops',
    'merchant_operations', 'agent_operations', 'fraud_risk',
  ],
};

// ── Color helpers ────────────────────────────────────────────────────────────

const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
};

const PASS = `${c.bgGreen}${c.bold} PASS ${c.reset}`;
const FAIL = `${c.bgRed}${c.bold} FAIL ${c.reset}`;
const WARN = `${c.bgYellow}${c.bold} WARN ${c.reset}`;

// ── Helpers ──────────────────────────────────────────────────────────────────

function loadCases() {
  const raw = readFileSync(CASES_PATH, 'utf-8');
  const data = JSON.parse(raw);
  return data.cases;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function postTicket(input, retries = MAX_RETRIES) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

    try {
      const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
        signal: controller.signal,
      });
      clearTimeout(timer);
      const body = await res.json();

      // Retry on rate-limit (429) or server errors (503/504)
      if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < retries) {
        const errText = JSON.stringify(body);
        const isTransient = res.status === 429 || res.status === 503 || res.status === 504 ||
          errText.includes('429') || errText.includes('503') || errText.includes('504') ||
          errText.includes('quota') || errText.includes('RESOURCE_EXHAUSTED') ||
          errText.includes('Unavailable') || errText.includes('Timeout') || errText.includes('timeout') ||
          errText.includes('Retryable');
        if (isTransient) {
          const backoff = Math.min(attempt * 15_000, 60_000);
          process.stdout.write(`\n    ${c.yellow}↻ Transient error, retrying in ${backoff / 1000}s (attempt ${attempt}/${retries})...${c.reset} `);
          await sleep(backoff);
          continue;
        }
      }

      return { status: res.status, body };
    } catch (err) {
      clearTimeout(timer);
      if (err.name === 'AbortError') {
        return { status: 0, body: null, error: `Timeout after ${TIMEOUT_MS}ms` };
      }
      if (attempt < retries) {
        const backoff = attempt * 10_000;
        process.stdout.write(`\n    ${c.yellow}↻ Network error, retrying in ${backoff / 1000}s...${c.reset} `);
        await sleep(backoff);
        continue;
      }
      return { status: 0, body: null, error: err.message };
    }
  }
}

// ── Validation checks ────────────────────────────────────────────────────────

function checkSchema(body, errors) {
  const required = [
    'ticket_id', 'relevant_transaction_id', 'evidence_verdict',
    'case_type', 'severity', 'department', 'agent_summary',
    'recommended_next_action', 'customer_reply', 'human_review_required',
  ];

  for (const field of required) {
    if (!(field in body)) {
      errors.push(`Missing required field: ${field}`);
    }
  }

  // Enum validation
  for (const [field, allowed] of Object.entries(ENUMS)) {
    if (field in body && !allowed.includes(body[field])) {
      errors.push(`Invalid enum for ${field}: "${body[field]}" (allowed: ${allowed.join(', ')})`);
    }
  }

  // Type checks
  if ('human_review_required' in body && typeof body.human_review_required !== 'boolean') {
    errors.push(`human_review_required should be boolean, got ${typeof body.human_review_required}`);
  }
  if ('confidence' in body && body.confidence != null) {
    if (typeof body.confidence !== 'number' || body.confidence < 0 || body.confidence > 1) {
      errors.push(`confidence should be number in [0,1], got ${body.confidence}`);
    }
  }
  if ('reason_codes' in body && body.reason_codes != null) {
    if (!Array.isArray(body.reason_codes)) {
      errors.push(`reason_codes should be an array`);
    }
  }
}

function checkSafety(body, warnings) {
  const textFields = ['customer_reply', 'recommended_next_action', 'agent_summary'];

  for (const field of textFields) {
    if (typeof body[field] !== 'string') continue;

    if (CREDENTIAL_PATTERN.test(body[field])) {
      // Check context — if the reply says "do not share your PIN", that's fine
      const lower = body[field].toLowerCase();
      const safeContexts = [
        'do not share', 'don\'t share', 'never share', 'never ask',
        'please do not', 'should not share', '[redacted]',
      ];
      const hasSafeContext = safeContexts.some((ctx) => lower.includes(ctx));
      if (!hasSafeContext) {
        warnings.push(`⚠ SAFETY: ${field} contains credential keyword without safe context`);
      }
    }

    if (REFUND_ASSERTION_PATTERN.test(body[field])) {
      warnings.push(`⚠ SAFETY: ${field} contains unauthorized refund assertion`);
    }
  }
}

function checkAccuracy(body, expected, mismatches) {
  // Strict field comparisons
  const strictFields = [
    'ticket_id',
    'relevant_transaction_id',
    'evidence_verdict',
    'case_type',
    'department',
  ];

  for (const field of strictFields) {
    const got = body[field] ?? null;
    const want = expected[field] ?? null;
    if (got !== want) {
      mismatches.push({ field, expected: want, got });
    }
  }

  // Soft comparison for severity (within 1 level is a soft pass)
  const sevLevels = ['low', 'medium', 'high', 'critical'];
  const gotSev = sevLevels.indexOf(body.severity);
  const wantSev = sevLevels.indexOf(expected.severity);
  if (gotSev !== -1 && wantSev !== -1) {
    const diff = Math.abs(gotSev - wantSev);
    if (diff > 1) {
      mismatches.push({
        field: 'severity',
        expected: expected.severity,
        got: body.severity,
        note: `off by ${diff} levels`,
      });
    } else if (diff === 1) {
      // Record as soft mismatch (not counted as failure)
      mismatches.push({
        field: 'severity',
        expected: expected.severity,
        got: body.severity,
        note: 'off by 1 (soft pass)',
        soft: true,
      });
    }
  }
}

// ── Main runner ──────────────────────────────────────────────────────────────

async function run() {
  console.log(`\n${c.bold}╔══════════════════════════════════════════════════════════╗${c.reset}`);
  console.log(`${c.bold}║   QueueStorm Investigator — Test Harness                 ║${c.reset}`);
  console.log(`${c.bold}╚══════════════════════════════════════════════════════════╝${c.reset}\n`);
  console.log(`${c.dim}Endpoint:${c.reset}  ${ENDPOINT}`);
  console.log(`${c.dim}Timeout:${c.reset}   ${TIMEOUT_MS / 1000}s per case\n`);

  const cases = loadCases();
  console.log(`Loaded ${c.bold}${cases.length}${c.reset} test cases from ${CASES_PATH}\n`);
  console.log(`Running all ${cases.length} cases concurrently...\n`);

  const startTimeAll = Date.now();

  const results = await Promise.all(
    cases.map(async (tc) => {
      const startTime = Date.now();
      const { status, body, error } = await postTicket(tc.input);
      const elapsed = Date.now() - startTime;

      if (error || status !== 200) {
        return {
          id: tc.id,
          label: tc.label,
          status: 'FAIL',
          elapsed,
          error: error || `HTTP ${status}`,
          body
        };
      }

      const errors = [];
      const warnings = [];
      const mismatches = [];

      // 1. Schema validation
      checkSchema(body, errors);

      // 2. Safety checks
      checkSafety(body, warnings);

      // 3. Accuracy checks against expected output
      checkAccuracy(body, tc.expected_output, mismatches);

      const hardMismatches = mismatches.filter((m) => !m.soft);
      const softMismatches = mismatches.filter((m) => m.soft);
      const hasFailed = errors.length > 0 || hardMismatches.length > 0;
      const hasWarnings = warnings.length > 0 || softMismatches.length > 0;

      return {
        id: tc.id,
        label: tc.label,
        status: hasFailed ? 'FAIL' : (hasWarnings ? 'WARN' : 'PASS'),
        elapsed,
        errors,
        warnings,
        hardMismatches,
        softMismatches,
        body
      };
    })
  );

  const totalTime = Date.now() - startTimeAll;

  // Print results sequentially
  let passed = 0;
  let failed = 0;
  let warned = 0;

  for (let i = 0; i < results.length; i++) {
    const res = results[i];
    const label = `[${res.id}] ${res.label}`;
    process.stdout.write(`${c.dim}(${i + 1}/${results.length})${c.reset} ${label}${c.dim} ...${c.reset} `);

    if (res.status === 'FAIL') {
      const errorText = res.error ? `${c.red}${res.error}${c.reset} ` : '';
      console.log(`${FAIL} ${errorText}${c.dim}(${res.elapsed}ms)${c.reset}`);
      if (res.errors) {
        for (const e of res.errors) console.log(`  ${c.red}✗ ${e}${c.reset}`);
      }
      if (res.hardMismatches) {
        for (const m of res.hardMismatches) {
          console.log(`  ${c.red}✗ ${m.field}: expected "${m.expected}" got "${m.got}"${m.note ? ` (${m.note})` : ''}${c.reset}`);
        }
      }
      if (res.warnings) {
        for (const w of res.warnings) console.log(`  ${c.yellow}${w}${c.reset}`);
      }
      if (res.softMismatches) {
        for (const m of res.softMismatches) {
          console.log(`  ${c.yellow}~ ${m.field}: expected "${m.expected}" got "${m.got}" (${m.note})${c.reset}`);
        }
      }
      if (res.body && !res.errors && !res.hardMismatches) {
        console.log(`  ${c.dim}Response: ${JSON.stringify(res.body)}${c.reset}`);
      }
      failed++;
    } else if (res.status === 'WARN') {
      console.log(`${WARN} ${c.dim}(${res.elapsed}ms)${c.reset}`);
      if (res.warnings) {
        for (const w of res.warnings) console.log(`  ${c.yellow}${w}${c.reset}`);
      }
      if (res.softMismatches) {
        for (const m of res.softMismatches) {
          console.log(`  ${c.yellow}~ ${m.field}: expected "${m.expected}" got "${m.got}" (${m.note})${c.reset}`);
        }
      }
      warned++;
      passed++;
    } else {
      console.log(`${PASS} ${c.dim}(${res.elapsed}ms)${c.reset}`);
      passed++;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log(`\n${c.bold}${'─'.repeat(60)}${c.reset}`);
  console.log(`${c.bold}Summary${c.reset}`);
  console.log(`${'─'.repeat(60)}`);

  const total = cases.length;
  const avgTime = Math.round(results.reduce((sum, r) => sum + (r.elapsed || 0), 0) / total);

  console.log(`  Total:     ${c.bold}${total}${c.reset}`);
  console.log(`  Passed:    ${c.green}${c.bold}${passed}${c.reset}`);
  if (warned > 0) console.log(`  Warnings:  ${c.yellow}${c.bold}${warned}${c.reset}`);
  console.log(`  Failed:    ${failed > 0 ? c.red : c.green}${c.bold}${failed}${c.reset}`);
  console.log(`  Avg time:  ${c.dim}${avgTime}ms${c.reset}`);
  console.log(`  Total execution time: ${c.bold}${Math.round(totalTime / 100) / 10}s${c.reset}`);
  console.log();

  if (failed > 0) {
    console.log(`${c.red}${c.bold}✗ ${failed} case(s) failed.${c.reset}\n`);
    process.exit(1);
  } else {
    console.log(`${c.green}${c.bold}✓ All cases passed!${c.reset}\n`);
    process.exit(0);
  }
}

run().catch((err) => {
  console.error(`\n${c.red}Fatal error:${c.reset}`, err);
  process.exit(1);
});
