import type { ActionExecutionEvent } from '@agent-action-runner/core';

export type DeliveryOpsAuditEntry = {
  readonly executionId: string;
  readonly workflowId?: string;
  readonly stepId?: string;
  readonly userId: string;
  readonly actionName: string;
  readonly mode: string;
  readonly status: string;
  readonly approvalId?: string;
  readonly createdAt: string;
};

export function createAuditTrail(): DeliveryOpsAuditEntry[] {
  return [];
}

export function toAuditEntry(event: ActionExecutionEvent): DeliveryOpsAuditEntry {
  return {
    executionId: event.executionId,
    workflowId: event.workflowId,
    stepId: event.stepId,
    userId: event.userId,
    actionName: event.actionName,
    mode: event.mode,
    status: event.status,
    approvalId: event.approvalId,
    createdAt: event.createdAt.toISOString(),
  };
}
