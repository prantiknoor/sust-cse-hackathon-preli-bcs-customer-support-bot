import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'

export const router = new OpenAPIHono()

const healthRoute = createRoute({
  method: 'get',
  path: '/health',
  summary: 'Health check endpoint',
  description: 'Returns the health status of the API service.',
  responses: {
    200: {
      content: {
        'application/json': {
          schema: z.object({
            status: z.string().openapi({
              description: 'The status of the service',
              example: 'ok',
            }),
            timestamp: z.string().openapi({
              description: 'The current ISO timestamp of the server',
              example: '2026-06-26T14:03:00.000Z',
            }),
          }),
        },
      },
      description: 'Returns a 200 OK status indicating the service is healthy.',
    },
  },
})

router.openapi(healthRoute, (c) => {
  return c.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  })
})
