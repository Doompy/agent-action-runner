import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import type { ApprovalContext } from '@agent-action-runner/core';
import { createStableHash } from './hash.js';

const APPROVAL_SECRET = 'agent-action-runner-example-secret';
const TOKEN_TTL_MS = 5 * 60 * 1000;

export type DisableUserApprovalPayload = {
  readonly approvalId: string;
  readonly userId: string;
  readonly actionName: 'admin.disableUser';
  readonly mode: 'mutate';
  readonly inputHash: string;
  readonly resourceIds: readonly string[];
  readonly dryRunHash: string;
  readonly expiresAt: string;
};

export type StoredApproval = DisableUserApprovalPayload & {
  readonly createdAt: string;
};

export function createApprovalStore(): Map<string, StoredApproval> {
  return new Map();
}

export function createDisableUserApproval(input: {
  readonly operatorUserId: string;
  readonly targetUserId: string;
  readonly reason: string;
  readonly dryRunHash: string;
  readonly approvals: Map<string, StoredApproval>;
  readonly now?: Date;
}): {
  readonly approvalId: string;
  readonly approvalToken: string;
  readonly approval: StoredApproval;
  readonly mutateInput: {
    readonly userId: string;
    readonly reason: string;
    readonly dryRunHash: string;
  };
} {
  const now = input.now ?? new Date();
  const mutateInput = {
    userId: input.targetUserId,
    reason: input.reason,
    dryRunHash: input.dryRunHash,
  };
  const payload: DisableUserApprovalPayload = {
    approvalId: randomUUID(),
    userId: input.operatorUserId,
    actionName: 'admin.disableUser',
    mode: 'mutate',
    inputHash: createStableHash(mutateInput),
    resourceIds: [input.targetUserId],
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
  readonly approvals: ReadonlyMap<string, StoredApproval>;
  readonly now?: Date;
}): { readonly approved: true; readonly approvalId: string } | { readonly approved: false } {
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
    return { approved: false };
  }

  if (
    payload.userId !== input.approvalContext.userId
    || payload.actionName !== input.approvalContext.actionName
    || payload.mode !== input.approvalContext.mode
    || payload.inputHash !== input.approvalContext.inputHash
    || payload.dryRunHash !== input.approvalContext.dryRunHash
    || payload.resourceIds.join(',') !== input.approvalContext.resourceIds?.join(',')
  ) {
    return { approved: false };
  }

  return {
    approved: true,
    approvalId: payload.approvalId,
  };
}

function signApprovalPayload(payload: DisableUserApprovalPayload): string {
  const encodedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createSignature(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

function parseApprovalToken(token: string): DisableUserApprovalPayload | undefined {
  const [encodedPayload, signature] = token.split('.');
  if (!encodedPayload || !signature) {
    return undefined;
  }

  const expectedSignature = createSignature(encodedPayload);
  if (!safeEqual(signature, expectedSignature)) {
    return undefined;
  }

  try {
    return JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8')) as DisableUserApprovalPayload;
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
