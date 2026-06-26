import { createRoute, z } from '@hono/zod-openapi';
import { TicketRequestSchema } from '../schemas/ticket-request.schema.js';
import { TicketResponseSchema } from '../schemas/ticket-response.schema.js';

const ErrorResponseSchema = z.object({
  error: z.string().openapi({ example: 'Malformed input: Missing required fields' }),
  details: z.array(z.string()).optional().openapi({ example: ['complaint: Required'] }),
}).openapi('ErrorResponse');

export const analyzeTicketRoute = createRoute({
  method: 'post',
  path: '/analyze-ticket',
  request: {
    body: {
      content: {
        'application/json': {
          schema: TicketRequestSchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        'application/json': {
          schema: TicketResponseSchema,
        },
      },
      description: 'Result of the ticket analysis service',
    },
    400: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Malformed input (invalid JSON or missing required fields)',
    },
    422: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Semantically invalid input (e.g. empty complaint or empty ticket_id)',
    },
    500: {
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
      description: 'Internal Server Error (non-sensitive error message)',
    },
  },
});
