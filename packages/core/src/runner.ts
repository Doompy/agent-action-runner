import { randomUUID } from 'node:crypto';
import {
  ActionAlreadyRegisteredError,
  ActionNotFoundError,
  ActionTimeoutError,
  ApprovalRequiredError,
  ModeNotAllowedError,
  PolicyRejectedError,
  SchemaValidationError,
  WorkflowExecutionError,
} from './errors.js';
import { createStableHash } from './hash.js';
import { fromStep, resolveWorkflowInput } from './references.js';
import type {
  ActionDefinition,
  ActionExecutionEvent,
  ActionExecutionInput,
  ActionExecutionResult,
  ActionMode,
  AgentExecutionContext,
  AgentRunnerOptions,
  ApprovalContext,
  ExecutableActionDefinition,
  WorkflowExecutionInput,
  WorkflowExecutionResult,
  WorkflowStepError,
  WorkflowStepResult,
  WorkflowStepRetry,
} from './types.js';

const DEFAULT_ALLOWED_MODES: readonly ActionMode[] = ['read', 'draft', 'dryRun'];

export { fromStep };

export function createRunner(options: AgentRunnerOptions = {}): AgentActionRunner {
  return new AgentActionRunner(options);
}

export class AgentActionRunner {
  private readonly actions = new Map<string, ExecutableActionDefinition>();

  constructor(private readonly options: AgentRunnerOptions = {}) {}

  registerAction<Input, Output>(definition: ActionDefinition<Input, Output>): void {
    if (this.actions.has(definition.name)) {
      throw new ActionAlreadyRegisteredError(definition.name);
    }

    this.actions.set(definition.name, definition as ExecutableActionDefinition);
  }

  getAction(name: string): ExecutableActionDefinition | undefined {
    return this.actions.get(name);
  }

  listActions(): readonly ExecutableActionDefinition[] {
    return [...this.actions.values()];
  }

  async executeAction<Output = unknown>(
    request: ActionExecutionInput,
  ): Promise<ActionExecutionResult<Output>> {
    const action = this.actions.get(request.action);
    if (!action) {
      throw new ActionNotFoundError(request.action);
    }

    const allowedModes = request.allowedModes ?? this.options.defaultAllowedModes ?? DEFAULT_ALLOWED_MODES;
    if (!allowedModes.includes(action.mode)) {
      throw new ModeNotAllowedError(action.name, action.mode);
    }

    const executionId = request.executionId ?? this.options.createExecutionId?.() ?? randomUUID();
    const input = parseWithSchema(action, 'input', request.input);
    const approvalContext = createApprovalContext({
      action,
      input,
      request,
    });
    let approved = false;
    const context: AgentExecutionContext = {
      executionId,
      workflowId: request.workflowId,
      stepId: request.stepId,
      userId: request.userId,
      actionName: action.name,
      mode: action.mode,
      approvalToken: request.approvalToken,
      approvalContext,
      metadata: request.metadata ?? {},
      requireApproval: () => {
        if (!approved) {
          throw new ApprovalRequiredError(action.name);
        }
      },
    };

    await this.options.audit?.(createAuditEvent({
      action,
      attempt: request.attempt,
      context,
      input,
      maxAttempts: request.maxAttempts,
      status: 'started',
    }));

    let approvalId: string | undefined;

    try {
      const policyResult = await this.options.policy?.({ action, input, context });
      if (policyResult && !policyResult.allowed) {
        throw new PolicyRejectedError(action.name, policyResult.reason);
      }

      if (action.approvalRequired || action.mode === 'mutate') {
        const approvalResult = await this.options.approval?.({
          action,
          input,
          context,
          approvalToken: request.approvalToken,
          approvalContext,
        });
        if (!approvalResult?.approved) {
          throw new ApprovalRequiredError(action.name);
        }
        approved = true;
        approvalId = approvalResult.approvalId;
      }

      const rawOutput = await withTimeout(
        Promise.resolve(action.handler(input, context)),
        request.timeoutMs,
        action.name,
      );
      const output = parseWithSchema(action, 'output', rawOutput);

      await this.options.audit?.(createAuditEvent({
        action,
        approvalId,
        attempt: request.attempt,
        context,
        input,
        maxAttempts: request.maxAttempts,
        output,
        outputSummary: this.options.summarizeOutput?.(output),
        status: 'succeeded',
      }));

      return {
        executionId,
        actionName: action.name,
        mode: action.mode,
        output: output as Output,
        approvalId,
      };
    } catch (error) {
      await this.options.audit?.(createAuditEvent({
        action,
        approvalId,
        attempt: request.attempt,
        context,
        error,
        input,
        maxAttempts: request.maxAttempts,
        status: 'failed',
      }));
      throw error;
    }
  }

  async executeWorkflow(request: WorkflowExecutionInput): Promise<WorkflowExecutionResult> {
    const workflowId = request.workflowId ?? this.options.createExecutionId?.() ?? randomUUID();
    const outputByStep: Record<string, unknown> = {};
    const stepResults: WorkflowStepResult[] = [];

    for (const step of request.workflow.steps) {
      const input = resolveWorkflowInput(step.input, outputByStep);
      const allowedModes = step.allowedModes ?? request.allowedModes;
      const retry = normalizeRetry(step.retry);
      let completed = false;
      let lastError: unknown;
      let lastExecutionId = '';

      for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
        const executionId = this.options.createExecutionId?.() ?? randomUUID();
        lastExecutionId = executionId;

        try {
          const result = await this.executeAction({
            userId: request.userId,
            workflowId,
            stepId: step.id,
            action: step.action,
            input,
            executionId,
            attempt,
            maxAttempts: retry.maxAttempts,
            timeoutMs: step.timeoutMs,
            allowedModes,
            approvalToken: step.approvalToken,
            approvalContext: step.approvalContext,
            metadata: request.metadata,
          });

          outputByStep[step.id] = result.output;
          stepResults.push({
            id: step.id,
            actionName: result.actionName,
            mode: result.mode,
            executionId: result.executionId,
            status: 'succeeded',
            attempts: attempt,
            output: result.output,
          });
          completed = true;
          break;
        } catch (error) {
          lastError = error;
          if (attempt < retry.maxAttempts) {
            await delay(retry.delayMs);
          }
        }
      }

      if (completed) {
        continue;
      }

      if (step.continueOnError) {
        const error = createWorkflowStepError(lastError);
        const output = {
          ok: false,
          error,
        };
        outputByStep[step.id] = output;
        stepResults.push({
          id: step.id,
          actionName: step.action,
          mode: this.actions.get(step.action)?.mode,
          executionId: lastExecutionId || this.options.createExecutionId?.() || randomUUID(),
          status: 'failed',
          attempts: retry.maxAttempts,
          error,
          continued: true,
          output,
        });
        continue;
      }

      throw new WorkflowExecutionError(step.id, step.action, lastError);
    }

    return {
      workflowId,
      workflowName: request.workflow.workflowName,
      steps: stepResults,
      outputByStep,
    };
  }
}

async function withTimeout<Output>(
  promise: Promise<Output>,
  timeoutMs: number | undefined,
  actionName: string,
): Promise<Output> {
  if (timeoutMs === undefined) {
    return promise;
  }

  return new Promise<Output>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new ActionTimeoutError(actionName, timeoutMs));
    }, timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

function normalizeRetry(retry: WorkflowStepRetry | undefined): Required<WorkflowStepRetry> {
  return {
    maxAttempts: retry?.maxAttempts ?? 1,
    delayMs: retry?.delayMs ?? 0,
  };
}

async function delay(delayMs: number): Promise<void> {
  if (delayMs <= 0) {
    return;
  }

  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function createWorkflowStepError(error: unknown): WorkflowStepError {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: error.message,
    };
  }

  return {
    name: 'Error',
    message: String(error),
  };
}

function parseWithSchema(
  action: ExecutableActionDefinition,
  target: 'input' | 'output',
  value: unknown,
): unknown {
  const schema = target === 'input' ? action.inputSchema : action.outputSchema;
  if (!schema) {
    return value;
  }

  const result = schema.safeParse(value);
  if (!result.success) {
    throw new SchemaValidationError(action.name, target, result.error);
  }

  return result.data;
}

function createApprovalContext(input: {
  action: ExecutableActionDefinition;
  input: unknown;
  request: ActionExecutionInput;
}): ApprovalContext {
  return {
    userId: input.request.userId,
    actionName: input.action.name,
    mode: input.action.mode,
    inputHash: createStableHash(input.input),
    resourceIds: input.request.approvalContext?.resourceIds,
    dryRunHash: input.request.approvalContext?.dryRunHash,
    expiresAt: input.request.approvalContext?.expiresAt,
    workflowId: input.request.workflowId,
    stepId: input.request.stepId,
  };
}

function createAuditEvent(input: {
  action: ExecutableActionDefinition;
  approvalId?: string;
  attempt?: number;
  context: AgentExecutionContext;
  error?: unknown;
  input: unknown;
  maxAttempts?: number;
  output?: unknown;
  outputSummary?: string;
  status: ActionExecutionEvent['status'];
}): ActionExecutionEvent {
  return {
    executionId: input.context.executionId,
    workflowId: input.context.workflowId,
    stepId: input.context.stepId,
    userId: input.context.userId,
    actionName: input.action.name,
    mode: input.action.mode,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    input: input.input,
    output: input.output,
    outputSummary: input.outputSummary,
    approvalToken: input.context.approvalToken,
    approvalId: input.approvalId,
    status: input.status,
    error: input.error,
    createdAt: new Date(),
  };
}
