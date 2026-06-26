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
          issue.code === 'invalid_type' ||
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

// Custom request logger middleware to dump request method, URL, and payload for debugging
app.use('*', async (c, next) => {
  const method = c.req.method;
  const url = c.req.url;

  let bodyText = '';
  if (method === 'POST' || method === 'PUT') {
    try {
      const cloned = c.req.raw.clone();
      bodyText = await cloned.text();
    } catch (_) { }
  }

  console.log(`📥 [Incoming Request] ${method} ${url}`);
  if (bodyText) {
    console.log(`Request Payload:\n${bodyText}`);
  }

  await next();
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

  // Log the complete error stack trace, cause details, and properties to the console
  console.error(`❌ [Unhandled Server Error] ${c.req.method} ${c.req.url}:`, err);
  if (err instanceof Error) {
    console.error('Stack Trace:\n', err.stack);
    if (err.cause) {
      console.error('Error Cause:\n', err.cause);
    }
  }

  // Print all properties of the error object for verbose debugging
  const properties: Record<string, any> = {};
  try {
    for (const key of Object.getOwnPropertyNames(err)) {
      if (key !== 'stack' && key !== 'message') {
        properties[key] = (err as any)[key];
      }
    }
  } catch (_) { }
  if (Object.keys(properties).length > 0) {
    console.error('Verbose Error Properties:\n', JSON.stringify(properties, null, 2));
  }

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

app.openapi(analyzeTicketRoute, async (c) => {
  const body = c.req.valid('json');
  try {
    const result = await analyzeTicket(body, c.env);
    return c.json(result, 200);
  } catch (e) {
    const errorInstance = e as Error;
    console.error(`❌ [Server Error] /analyze-ticket failed for request:\n`, JSON.stringify(body, null, 2));
    console.error('Error Message:', errorInstance.message);
    console.error('Stack Trace:\n', errorInstance.stack);
    if (errorInstance.cause) {
      console.error('Error Cause:\n', errorInstance.cause);
    }

    // Print all properties of the error object for verbose debugging
    const endpointProperties: Record<string, any> = {};
    try {
      for (const key of Object.getOwnPropertyNames(errorInstance)) {
        if (key !== 'stack' && key !== 'message') {
          endpointProperties[key] = (errorInstance as any)[key];
        }
      }
    } catch (_) { }
    if (Object.keys(endpointProperties).length > 0) {
      console.error('Verbose Error Properties:\n', JSON.stringify(endpointProperties, null, 2));
    }

    return c.json({
      error: errorInstance.message || 'Internal Server Error',
      details: {
        message: errorInstance.message,
        stack: errorInstance.stack,
        cause: errorInstance.cause,
        raw: String(errorInstance)
      }
    }, 500);
  }
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
