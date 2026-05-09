import { createHash, randomUUID } from 'node:crypto';
import {
  ActionAlreadyRegisteredError,
  ActionNotFoundError,
  ActionTimeoutError,
  ApprovalRequiredError,
  ModeNotAllowedError,
  PolicyRejectedError,
  SchemaValidationError,
  WorkflowAbortedError,
  WorkflowExecutionError,
  WorkflowValidationError,
} from './errors.js';
import { transformAuditPayload } from './audit-policy.js';
import { createStableHash } from './hash.js';
import { fromStep, resolveWorkflowInput } from './references.js';
import { validateWorkflowDefinition } from './validation.js';
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
    const abortHandle = createExecutionAbortController(request.signal);
    let approved = false;
    const context: AgentExecutionContext = {
      executionId,
      workflowId: request.workflowId,
      stepId: request.stepId,
      userId: request.userId,
      actionName: action.name,
      mode: action.mode,
      signal: abortHandle.controller.signal,
      idempotencyKey: request.idempotencyKey,
      approvalToken: request.approvalToken,
      approvalContext,
      metadata: request.metadata ?? {},
      requireApproval: () => {
        if (!approved) {
          throw new ApprovalRequiredError(action.name);
        }
      },
    };

    let approvalId: string | undefined;

    try {
      await this.options.audit?.(createAuditEvent({
        action,
        auditDefaults: this.options.auditDefaults,
        attempt: request.attempt,
        context,
        input,
        maxAttempts: request.maxAttempts,
        summarizeOutput: this.options.summarizeOutput,
        status: 'started',
      }));

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
        abortHandle.controller,
      );
      const output = parseWithSchema(action, 'output', rawOutput);

      await this.options.audit?.(createAuditEvent({
        action,
        approvalId,
        auditDefaults: this.options.auditDefaults,
        attempt: request.attempt,
        context,
        input,
        maxAttempts: request.maxAttempts,
        output,
        summarizeOutput: this.options.summarizeOutput,
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
        auditDefaults: this.options.auditDefaults,
        attempt: request.attempt,
        context,
        error,
        input,
        maxAttempts: request.maxAttempts,
        summarizeOutput: this.options.summarizeOutput,
        status: 'failed',
      }));
      throw error;
    } finally {
      abortHandle.cleanup();
    }
  }

  async executeWorkflow(request: WorkflowExecutionInput): Promise<WorkflowExecutionResult> {
    const validation = validateWorkflowDefinition(request.workflow, {
      actions: this.listActions().map((action) => ({
        name: action.name,
        mode: action.mode,
      })),
    });
    if (!validation.valid) {
      throw new WorkflowValidationError(validation.issues);
    }

    const workflowId = request.workflowId ?? this.options.createExecutionId?.() ?? randomUUID();
    const outputByStep: Record<string, unknown> = {};
    const stepResults: WorkflowStepResult[] = [];

    for (const step of request.workflow.steps) {
      throwIfWorkflowAborted(request.signal);
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
            signal: request.signal,
            idempotencyKey: step.idempotencyKey,
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
            await delay(retry.delayMs, request.signal);
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
  abortController: AbortController,
): Promise<Output> {
  if (timeoutMs === undefined) {
    return promise;
  }

  return new Promise<Output>((resolve, reject) => {
    const timeout = setTimeout(() => {
      const error = new ActionTimeoutError(actionName, timeoutMs);
      abortController.abort(error);
      reject(error);
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

function createExecutionAbortController(signal: AbortSignal | undefined): {
  readonly controller: AbortController;
  cleanup(): void;
} {
  const abortController = new AbortController();
  if (!signal) {
    return {
      controller: abortController,
      cleanup: () => {},
    };
  }

  if (signal.aborted) {
    abortController.abort(signal.reason);
    return {
      controller: abortController,
      cleanup: () => {},
    };
  }

  const onAbort = () => {
    abortController.abort(signal.reason);
  };
  signal.addEventListener('abort', onAbort, { once: true });

  return {
    controller: abortController,
    cleanup: () => {
      signal.removeEventListener('abort', onAbort);
    },
  };
}

function normalizeRetry(retry: WorkflowStepRetry | undefined): Required<WorkflowStepRetry> {
  return {
    maxAttempts: retry?.maxAttempts ?? 1,
    delayMs: retry?.delayMs ?? 0,
  };
}

async function delay(delayMs: number, signal: AbortSignal | undefined): Promise<void> {
  if (delayMs <= 0) {
    throwIfWorkflowAborted(signal);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      clearTimeout(timeout);
      cleanup();
      reject(new WorkflowAbortedError(signal?.reason));
    };
    const cleanup = () => {
      signal?.removeEventListener('abort', onAbort);
    };

    if (signal?.aborted) {
      clearTimeout(timeout);
      reject(new WorkflowAbortedError(signal.reason));
      return;
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function throwIfWorkflowAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new WorkflowAbortedError(signal.reason);
  }
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
  auditDefaults?: AgentRunnerOptions['auditDefaults'];
  attempt?: number;
  context: AgentExecutionContext;
  error?: unknown;
  input: unknown;
  maxAttempts?: number;
  output?: unknown;
  summarizeOutput?: AgentRunnerOptions['summarizeOutput'];
  status: ActionExecutionEvent['status'];
}): ActionExecutionEvent {
  const approvalTokenHash = createApprovalTokenHash(input.context.approvalToken);
  const idempotencyKeyHash = createIdempotencyKeyHash(input.context.idempotencyKey);
  const transformedPayload = transformAuditPayload({
    action: input.action,
    auditDefaults: input.auditDefaults,
    ...(Object.prototype.hasOwnProperty.call(input, 'error') ? { error: input.error } : {}),
    input: input.input,
    ...(Object.prototype.hasOwnProperty.call(input, 'output') ? { output: input.output } : {}),
    summarizeOutput: input.summarizeOutput,
  });

  return {
    executionId: input.context.executionId,
    workflowId: input.context.workflowId,
    stepId: input.context.stepId,
    userId: input.context.userId,
    actionName: input.action.name,
    mode: input.action.mode,
    attempt: input.attempt,
    maxAttempts: input.maxAttempts,
    input: transformedPayload.input,
    ...(transformedPayload.output === undefined ? {} : { output: transformedPayload.output }),
    ...(transformedPayload.outputSummary === undefined
      ? {}
      : { outputSummary: transformedPayload.outputSummary }),
    ...(idempotencyKeyHash === undefined ? {} : { idempotencyKeyHash }),
    ...(approvalTokenHash === undefined ? {} : { approvalTokenHash }),
    approvalId: input.approvalId,
    status: input.status,
    ...(transformedPayload.error === undefined ? {} : { error: transformedPayload.error }),
    createdAt: new Date(),
  };
}

function createIdempotencyKeyHash(idempotencyKey: string | undefined): string | undefined {
  if (!idempotencyKey) {
    return undefined;
  }

  return createHash('sha256').update(idempotencyKey, 'utf8').digest('hex');
}

function createApprovalTokenHash(approvalToken: string | undefined): string | undefined {
  if (!approvalToken) {
    return undefined;
  }

  return createHash('sha256').update(approvalToken, 'utf8').digest('hex');
}
