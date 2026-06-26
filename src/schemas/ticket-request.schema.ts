import { z } from '@hono/zod-openapi';
import {
  TransactionTypeSchema,
  TransactionStatusSchema,
  LanguageSchema,
  ChannelSchema,
  UserTypeSchema
} from './common.schema.js';

export const TransactionEntrySchema = z.object({
  transaction_id: z.string().openapi({ example: 'TXN123456789' }),
  timestamp: z.string().datetime().openapi({ example: '2026-06-26T20:13:11.000Z' }),
  type: TransactionTypeSchema,
  amount: z.number().openapi({ example: 1500.00 }),
  counterparty: z.string().openapi({ example: 'Merchant Store' }),
  status: TransactionStatusSchema,
}).openapi('TransactionEntry', {
  description: 'An entry in the transaction history of the user/ticket',
});

export const TicketRequestSchema = z.object({
  ticket_id: z.string().trim().min(1, { message: 'ticket_id cannot be empty' }).openapi({ example: 'TKT-98765' }),
  complaint: z.string().trim().min(1, { message: 'complaint cannot be empty' }).openapi({ example: 'I made a payment of 1500 to Merchant Store, but it says failed, yet money was deducted.' }),
  language: LanguageSchema.optional(),
  channel: ChannelSchema.optional(),
  user_type: UserTypeSchema.optional(),
  campaign_context: z.string().optional().openapi({ example: 'EID_FESTIVAL_CASHBACK' }),
  transaction_history: z.array(TransactionEntrySchema).default([]).openapi({
    description: 'Transaction log related to the ticket/user',
    example: [
      {
        transaction_id: 'TXN123456789',
        timestamp: '2026-06-26T20:13:11.000Z',
        type: 'payment',
        amount: 1500.00,
        counterparty: 'Merchant Store',
        status: 'failed'
      }
    ]
  }),
  metadata: z.record(z.string(), z.unknown()).optional().openapi({
    description: 'Additional structured or unstructured metadata',
    example: { device_os: 'Android', app_version: '3.4.1' }
  }),
}).openapi('TicketRequest', {
  description: 'Payload structure for submitting a ticket for AI analysis',
});
