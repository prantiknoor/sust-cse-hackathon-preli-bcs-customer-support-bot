import { OpenAPIHono } from '@hono/zod-openapi';
import { apiReference } from '@scalar/hono-api-reference';
import { healthRoute } from './routes/health.route.js';
import { analyzeTicketRoute } from './routes/analyze-ticket.route.js';
import { analyzeTicket } from './services/ticket-analyzer.service.js';

// Initialize OpenAPIHono with a custom validation error hook (defaultHook)
const app = new OpenAPIHono({
  defaultHook: (result, c) => {
    if (!result.success) {
      const issues = result.error.issues;

      // Classify as 400 (Malformed input / missing fields) or 422 (Semantically invalid)
      const isMissingRequiredOrWrongType = issues.some(
        (issue) =>
          (issue.code === 'invalid_type' && (issue as any).received === 'undefined') ||
          issue.code === 'invalid_union' ||
          issue.code === 'unrecognized_keys'
      );

      const errorMessage = isMissingRequiredOrWrongType
        ? 'Malformed input: Missing required fields or incorrect data types'
        : 'Semantic validation failed: Input parameters are invalid';

      const statusCode = isMissingRequiredOrWrongType ? 400 : 422;

      return c.json(
        {
          error: errorMessage,
          details: issues.map((i) => `${i.path.join('.')}: ${i.message}`),
        },
        statusCode
      );
    }
  },
});

app.onError((err, c) => {
  // Catch JSON parsing syntax errors and bad request HTTPExceptions
  const isMalformedInput =
    err instanceof SyntaxError ||
    (err && typeof err === 'object' && 'status' in err && (err as any).status === 400) ||
    err.message?.toLowerCase().includes('json') ||
    err.message?.toLowerCase().includes('syntax');

  if (isMalformedInput) {
    return c.json(
      {
        error: 'Malformed input: Invalid JSON structure',
      },
      400
    );
  }

  // Securely log the error internally (do not expose to client)
  console.error('Unhandled System Error:', err);

  // Return a clean non-sensitive 500 response
  return c.json(
    {
      error: 'Internal Server Error',
    },
    500
  );
});

// Bind routes to handler logic
app.openapi(healthRoute, (c) => {
  return c.json({ status: 'ok' }, 200);
});

app.openapi(analyzeTicketRoute, (c) => {
  const body = c.req.valid('json');
  const result = analyzeTicket(body);
  return c.json(result, 200);
});

// Expose raw OpenAPI JSON spec
app.doc('/openapi.json', {
  openapi: '3.1.0',
  info: {
    title: 'QueueStorm Investigator API',
    version: '0.1.0',
  },
});

// Serve interactive API documentation
app.get(
  '/docs',
  apiReference({
    spec: {
      url: '/openapi.json',
    },
  })
);

export { app };
