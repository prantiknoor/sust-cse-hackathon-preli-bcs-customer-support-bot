import { z } from '@hono/zod-openapi';

export const CaseTypeSchema = z.enum([
  'wrong_transfer',
  'payment_failed',
  'refund_request',
  'duplicate_payment',
  'merchant_settlement_delay',
  'agent_cash_in_issue',
  'phishing_or_social_engineering',
  'other'
]).openapi('CaseType', {
  description: 'The classified case type of the ticket',
});

export const DepartmentSchema = z.enum([
  'customer_support',
  'dispute_resolution',
  'payments_ops',
  'merchant_operations',
  'agent_operations',
  'fraud_risk'
]).openapi('Department', {
  description: 'The internal department the ticket should be routed to',
});

export const EvidenceVerdictSchema = z.enum([
  'consistent',
  'inconsistent',
  'insufficient_data'
]).openapi('EvidenceVerdict', {
  description: 'Verdict indicating if client evidence aligns with system records',
});

export const SeveritySchema = z.enum([
  'low',
  'medium',
  'high',
  'critical'
]).openapi('Severity', {
  description: 'The urgency and impact level of the support ticket',
});

export const LanguageSchema = z.enum([
  'en',
  'bn',
  'mixed'
]).openapi('Language', {
  description: 'The language detected in the ticket complaint',
});

export const ChannelSchema = z.enum([
  'in_app_chat',
  'call_center',
  'email',
  'merchant_portal',
  'field_agent'
]).openapi('Channel', {
  description: 'The support channel through which the ticket was submitted',
});

export const UserTypeSchema = z.enum([
  'customer',
  'merchant',
  'agent',
  'unknown'
]).openapi('UserType', {
  description: 'The category of user submitting the ticket',
});

export const TransactionTypeSchema = z.enum([
  'transfer',
  'payment',
  'cash_in',
  'cash_out',
  'settlement',
  'refund'
]).openapi('TransactionType', {
  description: 'The type of digital finance transaction',
});

export const TransactionStatusSchema = z.enum([
  'completed',
  'failed',
  'pending',
  'reversed'
]).openapi('TransactionStatus', {
  description: 'The status of the transaction in the system',
});
