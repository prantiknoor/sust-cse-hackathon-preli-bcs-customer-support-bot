import { z } from '@hono/zod-openapi';
import { TicketRequestSchema } from '../schemas/ticket-request.schema.js';
import { TicketResponseSchema } from '../schemas/ticket-response.schema.js';

type TicketRequest = z.infer<typeof TicketRequestSchema>;
type TicketResponse = z.infer<typeof TicketResponseSchema>;

/**
 * Mocks the ticket analysis process and returns a schema-valid TicketResponse.
 * Real LLM-based logic will be added here in the future.
 */
export function analyzeTicket(request: TicketRequest): TicketResponse {
  const primaryTx = request.transaction_history?.[0];

  return {
    ticket_id: request.ticket_id,
    relevant_transaction_id: primaryTx ? primaryTx.transaction_id : null,
    evidence_verdict: 'consistent',
    case_type: 'payment_failed',
    severity: 'medium',
    department: 'payments_ops',
    agent_summary: `Mocked AI classification for complaint: "${request.complaint}"`,
    recommended_next_action: 'Escalate to payment operations to check gateway status.',
    customer_reply: 'We noticed a delay in your transaction. Our team is investigating and will reverse it if deducted.',
    human_review_required: false,
    confidence: 0.9,
    reason_codes: ['MOCK_VALIDATION_PASSED']
  };
}
