import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import {
  createStableHash,
  type ApprovalContext,
  type ApprovalCheckResult,
} from '@agent-action-runner/core';

const APPROVAL_SECRET = 'agent-action-runner-delivery-example-secret';
const TOKEN_TTL_MS = 5 * 60 * 1000;

export type RetryJobsApprovalPayload = {
  readonly approvalId: string;
  readonly userId: string;
  readonly actionName: 'delivery.executeRetry';
  readonly mode: 'mutate';
  readonly inputHash: string;
  readonly resourceIds: readonly string[];
  readonly dryRunHash: string;
  readonly expiresAt: string;
};

export type StoredRetryJobsApproval = RetryJobsApprovalPayload & {
  readonly createdAt: string;
};

export function createApprovalStore(): Map<string, StoredRetryJobsApproval> {
  return new Map();
}

export function createRetryJobsApproval(input: {
  readonly operatorUserId: string;
  readonly jobIds: readonly string[];
  readonly reason: string;
  readonly dryRunHash: string;
  readonly approvals: Map<string, StoredRetryJobsApproval>;
  readonly now?: Date;
}): {
  readonly approvalId: string;
  readonly approvalToken: string;
  readonly approval: StoredRetryJobsApproval;
  readonly mutateInput: {
    readonly jobIds: readonly string[];
    readonly reason: string;
    readonly dryRunHash: string;
  };
} {
  const now = input.now ?? new Date();
  const mutateInput = {
    jobIds: input.jobIds,
    reason: input.reason,
    dryRunHash: input.dryRunHash,
  };
  const payload: RetryJobsApprovalPayload = {
    approvalId: randomUUID(),
    userId: input.operatorUserId,
    actionName: 'delivery.executeRetry',
    mode: 'mutate',
    inputHash: createStableHash(mutateInput),
    resourceIds: input.jobIds,
    dryRunHash: input.dryRunHash,
    expiresAt: new Date(now.getTime() + TOKEN_TTL_MS).toISOString(),
  };
  const approval = {
    ...payload,
    createdAt: now.toISOString(),
  };

  input.approvals.set(payload.approvalId, approval);

  return {
    approvalId: payload.approvalId,
    approvalToken: signApprovalPayload(payload),
    approval,
    mutateInput,
  };
}

export function verifyApprovalToken(input: {
  readonly token?: string;
  readonly approvalContext: ApprovalContext;
  readonly approvals: ReadonlyMap<string, StoredRetryJobsApproval>;
  readonly now?: Date;
}): ApprovalCheckResult {
  if (!input.token) {
    return { approved: false };
  }

  const payload = parseApprovalToken(input.token);
  if (!payload) {
    return { approved: false };
  }

  const storedApproval = input.approvals.get(payload.approvalId);
  if (!storedApproval) {
    return { approved: false };
  }

  const now = input.now ?? new Date();
  if (Date.parse(payload.expiresAt) <= now.getTime()) {
    return { approved: false, reason: 'Approval token expired.' };
  }

  if (
    payload.userId !== input.approvalContext.userId
    || payload.actionName !== input.approvalContext.actionName
    || payload.mode !== input.approvalContext.mode
    || payload.inputHash !== input.approvalContext.inputHash
    || payload.dryRunHash !== input.approvalContext.dryRunHash
    || payload.resourceIds.join('\0') !== input.approvalContext.resourceIds?.join('\0')
  ) {
    return { approved: false, reason: 'Approval token does not match this retry request.' };
  }

  return {
    approved: true,
    approvalId: payload.approvalId,
  };
}

function signApprovalPayload(payload: RetryJobsApprovalPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createSignature(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseApprovalToken(token: string): RetryJobsApprovalPayload | undefined {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return undefined;
  }

  const expectedSignature = createSignature(encodedPayload);
  if (!safeEqual(signature, expectedSignature)) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as RetryJobsApprovalPayload;
  } catch {
    return undefined;
  }
}

function createSignature(encodedPayload: string): string {
  return createHmac('sha256', APPROVAL_SECRET)
    .update(encodedPayload)
    .digest('base64url');
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
