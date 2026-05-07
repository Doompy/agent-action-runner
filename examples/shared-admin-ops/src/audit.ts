import type { ActionExecutionEvent } from '@agent-action-runner/core';

export type AdminOpsAuditEntry = {
  readonly executionId: string;
  readonly workflowId?: string;
  readonly stepId?: string;
  readonly userId: string;
  readonly actionName: string;
  readonly mode: string;
  readonly status: string;
  readonly approvalTokenHash?: string;
  readonly approvalId?: string;
  readonly createdAt: string;
};

export function createAuditTrail(): AdminOpsAuditEntry[] {
  return [];
}

export function toAuditEntry(event: ActionExecutionEvent): AdminOpsAuditEntry {
  return {
    executionId: event.executionId,
    workflowId: event.workflowId,
    stepId: event.stepId,
    userId: event.userId,
    actionName: event.actionName,
    mode: event.mode,
    status: event.status,
    approvalTokenHash: event.approvalTokenHash,
    approvalId: event.approvalId,
    createdAt: event.createdAt.toISOString(),
  };
}
