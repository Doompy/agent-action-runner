import {
  createRunner,
  type ActionDefinition,
  type ActionExecutionEvent,
  type ActionExecutionInput,
  type ActionExecutionResult,
  type AgentActionRunner,
  type AgentRunnerOptions,
  type ApprovalCheck,
  type PolicyCheck,
  type WorkflowExecutionInput,
  type WorkflowExecutionResult,
} from '@agent-action-runner/core';

export type RunnerHarnessOptions = {
  readonly actions?: readonly ActionDefinition[];
  readonly runnerOptions?: AgentRunnerOptions;
};

export type RunnerHarness = {
  readonly runner: AgentActionRunner;
  executeAction<Output = unknown>(input: ActionExecutionInput): Promise<ActionExecutionResult<Output>>;
  executeWorkflow(input: WorkflowExecutionInput): Promise<WorkflowExecutionResult>;
  getAuditEvents(): readonly ActionExecutionEvent[];
  clearAuditEvents(): void;
};

export type AuditEventFilter = {
  readonly actionName?: string;
  readonly status?: ActionExecutionEvent['status'];
  readonly workflowId?: string;
  readonly stepId?: string;
};

export function createRunnerHarness(options: RunnerHarnessOptions = {}): RunnerHarness {
  const events: ActionExecutionEvent[] = [];
  const runner = createRunner({
    ...options.runnerOptions,
    audit: async (event) => {
      events.push(event);
      await options.runnerOptions?.audit?.(event);
    },
  });

  for (const action of options.actions ?? []) {
    runner.registerAction(action);
  }

  return {
    runner,
    executeAction: (input) => runner.executeAction(input),
    executeWorkflow: (input) => runner.executeWorkflow(input),
    getAuditEvents: () => [...events],
    clearAuditEvents: () => {
      events.length = 0;
    },
  };
}

export function approveAll(approvalId = 'approval_test'): ApprovalCheck {
  return () => ({
    approved: true,
    approvalId,
  });
}

export function rejectApproval(reason = 'Rejected by test approval helper.'): ApprovalCheck {
  return () => ({
    approved: false,
    reason,
  });
}

export function allowAll(): PolicyCheck {
  return () => ({ allowed: true });
}

export function rejectPolicy(reason = 'Rejected by test policy helper.'): PolicyCheck {
  return () => ({
    allowed: false,
    reason,
  });
}

export function findAuditEvents(
  events: readonly ActionExecutionEvent[],
  filter: AuditEventFilter,
): readonly ActionExecutionEvent[] {
  return events.filter((event) => (
    (filter.actionName === undefined || event.actionName === filter.actionName)
    && (filter.status === undefined || event.status === filter.status)
    && (filter.workflowId === undefined || event.workflowId === filter.workflowId)
    && (filter.stepId === undefined || event.stepId === filter.stepId)
  ));
}

export function auditEventsContainText(
  events: readonly ActionExecutionEvent[],
  text: string,
): boolean {
  return safeStringify(events).includes(text);
}

function safeStringify(value: unknown): string {
  const seen = new WeakSet<object>();

  const serialized = JSON.stringify(value, (_key, item: unknown) => {
    if (item instanceof Error) {
      return {
        name: item.name,
        message: item.message,
      };
    }

    if (item !== null && typeof item === 'object') {
      if (seen.has(item)) {
        return '[Circular]';
      }
      seen.add(item);
    }

    return item;
  });

  return serialized ?? '';
}
