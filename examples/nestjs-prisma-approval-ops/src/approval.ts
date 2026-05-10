import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApprovalContext, AgentExecutionContext } from '@agent-action-runner/core';
import { createStableHash } from '@agent-action-runner/core';
import type { PrismaClient } from '@prisma/client';
import type { DisableUserInput } from 'agent-action-runner-shared-admin-ops-example';

const APPROVAL_SECRET = 'agent-action-runner-prisma-example-secret';
const TOKEN_TTL_MS = 5 * 60 * 1000;

export async function createDisableUserApproval(input: {
  readonly prisma: PrismaClient;
  readonly operatorUserId: string;
  readonly targetUserId: string;
  readonly reason: string;
  readonly dryRunHash: string;
  readonly now?: Date;
}): Promise<{
  readonly approvalId: string;
  readonly approvalToken: string;
  readonly mutateInput: DisableUserInput;
}> {
  const now = input.now ?? new Date();
  const approvalToken = randomBytes(32).toString('base64url');
  const mutateInput = {
    userId: input.targetUserId,
    reason: input.reason,
    dryRunHash: input.dryRunHash,
  };
  const approval = await input.prisma.agentApproval.create({
    data: {
      id: cryptoRandomId(),
      tokenHash: hashApprovalToken(approvalToken),
      userId: input.operatorUserId,
      actionName: 'admin.disableUser',
      inputHash: createStableHash(mutateInput),
      resourceIdsJson: JSON.stringify([input.targetUserId]),
      dryRunHash: input.dryRunHash,
      expiresAt: new Date(now.getTime() + TOKEN_TTL_MS),
      createdAt: now,
    },
  });

  return {
    approvalId: approval.id,
    approvalToken,
    mutateInput,
  };
}

export async function verifyApprovalToken(input: {
  readonly prisma: PrismaClient;
  readonly approvalToken?: string;
  readonly approvalContext: ApprovalContext;
  readonly executionContext: AgentExecutionContext;
  readonly now?: Date;
}): Promise<{ readonly approved: true; readonly approvalId: string } | { readonly approved: false }> {
  if (!input.approvalToken) {
    return { approved: false };
  }

  const tokenHash = hashApprovalToken(input.approvalToken);
  const approval = await input.prisma.agentApproval.findUnique({
    where: { tokenHash },
  });
  if (!approval) {
    return { approved: false };
  }

  const now = input.now ?? new Date();
  if (approval.expiresAt.getTime() <= now.getTime()) {
    return { approved: false };
  }

  if (!matchesApprovalContext(approval, input.approvalContext)) {
    return { approved: false };
  }

  if (approval.consumedAt) {
    if (!input.executionContext.idempotencyKey) {
      return { approved: false };
    }
    const idempotency = await input.prisma.agentIdempotencyKey.findUnique({
      where: { key: input.executionContext.idempotencyKey },
    });
    return idempotency?.status === 'succeeded'
      ? { approved: true, approvalId: approval.id }
      : { approved: false };
  }

  return {
    approved: true,
    approvalId: approval.id,
  };
}

export async function consumeApprovalOnce(input: {
  readonly tx: PrismaTransaction;
  readonly approvalToken: string;
  readonly approvalContext: ApprovalContext;
  readonly executionId: string;
}): Promise<void> {
  const tokenHash = hashApprovalToken(input.approvalToken);
  const approval = await input.tx.agentApproval.findUnique({
    where: { tokenHash },
  });
  if (!approval) {
    throw new Error('Approval not found.');
  }
  if (approval.consumedAt) {
    throw new Error('Approval was already consumed.');
  }
  if (approval.expiresAt.getTime() <= Date.now()) {
    throw new Error('Approval expired.');
  }
  if (!matchesApprovalContext(approval, input.approvalContext)) {
    throw new Error('Approval context mismatch.');
  }

  await input.tx.agentApproval.update({
    where: { tokenHash },
    data: {
      consumedAt: new Date(),
      consumedByExecId: input.executionId,
    },
  });
}

export function hashApprovalToken(token: string): string {
  return createHmac('sha256', APPROVAL_SECRET)
    .update(token)
    .digest('hex');
}

function matchesApprovalContext(
  approval: {
    readonly userId: string;
    readonly actionName: string;
    readonly inputHash: string;
    readonly resourceIdsJson: string | null;
    readonly dryRunHash: string | null;
  },
  context: ApprovalContext,
): boolean {
  return approval.userId === context.userId
    && approval.actionName === context.actionName
    && context.mode === 'mutate'
    && approval.inputHash === context.inputHash
    && approval.dryRunHash === (context.dryRunHash ?? null)
    && safeEqual(approval.resourceIdsJson ?? '[]', JSON.stringify(context.resourceIds ?? []));
}

function safeEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function cryptoRandomId(): string {
  return randomBytes(16).toString('hex');
}

type PrismaTransaction = Parameters<Parameters<PrismaClient['$transaction']>[0]>[0];
