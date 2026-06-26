/**
 * Few-shot examples embedded directly for the system prompt.
 * These cover diverse case types with both consistent and inconsistent verdicts,
 * standardizing tone and expected output format for the LLM.
 */

export interface SampleCase {
  input: {
    ticket_id: string;
    complaint: string;
    transaction_history: {
      transaction_id: string;
      timestamp: string;
      type: string;
      amount: number;
      counterparty: string;
      status: string;
    }[];
  };
  output: {
    ticket_id: string;
    relevant_transaction_id: string | null;
    evidence_verdict: string;
    case_type: string;
    severity: string;
    department: string;
    agent_summary: string;
    recommended_next_action: string;
    customer_reply: string;
    human_review_required: boolean;
    confidence: number;
    reason_codes: string[];
  };
}

export const SAMPLE_CASES: SampleCase[] = [
  {
    input: {
      ticket_id: 'TKT-SAMPLE-001',
      complaint:
        'I sent 5000 BDT to 01712345678 but the money went to wrong number 01787654321. Please help me get my money back.',
      transaction_history: [
        {
          transaction_id: 'TXN900001',
          timestamp: '2026-06-20T14:30:00.000Z',
          type: 'transfer',
          amount: 5000,
          counterparty: '01787654321',
          status: 'completed',
        },
      ],
    },
    output: {
      ticket_id: 'TKT-SAMPLE-001',
      relevant_transaction_id: 'TXN900001',
      evidence_verdict: 'consistent',
      case_type: 'wrong_transfer',
      severity: 'high',
      department: 'dispute_resolution',
      agent_summary:
        'Customer claims they intended to send 5000 BDT to 01712345678 but the transfer went to 01787654321. Transaction log confirms a completed transfer of 5000 BDT to 01787654321 (TXN900001). The evidence is consistent with the customer claim of a wrong-number transfer.',
      recommended_next_action:
        'Initiate a wrong-transfer reversal request for TXN900001. Contact the unintended recipient 01787654321 for fund recovery per standard dispute resolution process.',
      customer_reply:
        'Dear customer, we have reviewed your complaint regarding the transfer of 5000 BDT. Our records confirm the amount was sent to 01787654321. We are initiating the dispute resolution process to recover your funds. You will be updated on the progress shortly.',
      human_review_required: true,
      confidence: 0.92,
      reason_codes: ['WRONG_RECIPIENT', 'TRANSFER_COMPLETED'],
    },
  },
  {
    input: {
      ticket_id: 'TKT-SAMPLE-002',
      complaint:
        'I paid 1500 taka to FoodPanda but transaction failed. However money was deducted from my account. Please refund immediately.',
      transaction_history: [
        {
          transaction_id: 'TXN900002',
          timestamp: '2026-06-21T19:45:00.000Z',
          type: 'payment',
          amount: 1500,
          counterparty: 'FoodPanda',
          status: 'failed',
        },
      ],
    },
    output: {
      ticket_id: 'TKT-SAMPLE-002',
      relevant_transaction_id: 'TXN900002',
      evidence_verdict: 'consistent',
      case_type: 'payment_failed',
      severity: 'medium',
      department: 'payments_ops',
      agent_summary:
        'Customer reports a failed payment of 1500 BDT to FoodPanda with funds still deducted. System records show TXN900002 as a failed payment of 1500 BDT to FoodPanda. The claim is consistent with a debit-on-fail scenario where the payment gateway timed out but the debit was processed.',
      recommended_next_action:
        'Verify the settlement status with the FoodPanda payment gateway. If no settlement occurred, initiate an auto-reversal for TXN900002.',
      customer_reply:
        'Dear customer, we can see that your payment of 1500 BDT to FoodPanda (TXN900002) was recorded as failed. We are investigating the discrepancy and working to resolve this. Any eligible amount will be returned through official channels.',
      human_review_required: false,
      confidence: 0.95,
      reason_codes: ['PAYMENT_FAILED', 'FUNDS_DEDUCTED_ON_FAIL'],
    },
  },
  {
    input: {
      ticket_id: 'TKT-SAMPLE-003',
      complaint:
        'Someone called me saying they are from customer support and asked for my PIN. I gave them my PIN and now 10000 taka is missing from my account.',
      transaction_history: [
        {
          transaction_id: 'TXN900003',
          timestamp: '2026-06-22T08:15:00.000Z',
          type: 'transfer',
          amount: 10000,
          counterparty: '01699999999',
          status: 'completed',
        },
        {
          transaction_id: 'TXN900004',
          timestamp: '2026-06-22T08:17:00.000Z',
          type: 'cash_out',
          amount: 10000,
          counterparty: 'Agent-XYZ',
          status: 'completed',
        },
      ],
    },
    output: {
      ticket_id: 'TKT-SAMPLE-003',
      relevant_transaction_id: 'TXN900003',
      evidence_verdict: 'consistent',
      case_type: 'phishing_or_social_engineering',
      severity: 'critical',
      department: 'fraud_risk',
      agent_summary:
        'Customer reports being socially engineered into revealing their PIN by a caller impersonating support. Transaction records show two rapid transactions: a 10000 BDT transfer to 01699999999 (TXN900003) followed by a 10000 BDT cash-out at Agent-XYZ (TXN900004) two minutes later. This pattern is consistent with a phishing-driven account takeover and rapid fund extraction.',
      recommended_next_action:
        'Immediately flag the account for security review. Lock the recipient account 01699999999 and Agent-XYZ pending fraud investigation. File a fraud report per compliance protocol.',
      customer_reply:
        'Dear customer, we take this matter very seriously. Our records show unauthorized activity on your account. We have escalated this to our fraud investigation team, and your account security is being reviewed. Please never share your PIN or any credentials with anyone. A specialist will contact you shortly.',
      human_review_required: true,
      confidence: 0.88,
      reason_codes: [
        'SOCIAL_ENGINEERING',
        'RAPID_FUND_EXTRACTION',
        'ACCOUNT_TAKEOVER',
      ],
    },
  },
];
