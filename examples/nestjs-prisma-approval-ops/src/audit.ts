import type { ActionExecutionEvent } from '@agent-action-runner/core';
import type { PrismaClient } from '@prisma/client';
import { createAuditId } from './prisma.js';

export async function appendAuditEvent(
  prisma: PrismaClient,
  event: ActionExecutionEvent,
): Promise<void> {
  await prisma.agentAuditEvent.create({
    data: {
      id: createAuditId(),
      executionId: event.executionId,
      workflowId: event.workflowId,
      stepId: event.stepId,
      userId: event.userId,
      actionName: event.actionName,
      mode: event.mode,
      status: event.status,
      attempt: event.attempt,
      maxAttempts: event.maxAttempts,
      inputJson: event.input === undefined ? undefined : safeJson(event.input),
      outputSummary: event.outputSummary,
      approvalId: event.approvalId,
      approvalTokenHash: event.approvalTokenHash,
      idempotencyKeyHash: event.idempotencyKeyHash,
      errorJson: event.error === undefined ? undefined : safeJson(event.error),
      createdAt: event.createdAt,
    },
  });
}

function safeJson(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
      };
    }
    return item;
  });
}
