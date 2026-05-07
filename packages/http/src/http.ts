import {
  ActionNotFoundError,
  ActionTimeoutError,
  ApprovalRequiredError,
  InvalidStepReferenceError,
  ModeNotAllowedError,
  PolicyRejectedError,
  SchemaValidationError,
  WorkflowExecutionError,
  WorkflowValidationError,
} from '@agent-action-runner/core';
import type {
  ActionMode,
  AgentActionRunner,
  ApprovalContextOverrides,
  WorkflowDefinition,
  WorkflowStep,
} from '@agent-action-runner/core';
import type {
  AgentHttpActionExecuteBody,
  AgentHttpActionListResponse,
  AgentHttpAdapterOptions,
  AgentHttpErrorResponse,
  AgentHttpMappedError,
  AgentHttpRequestContext,
  AgentHttpSuccessResponse,
  AgentHttpWorkflowLimits,
  AgentHttpWorkflowExecuteBody,
} from './types.js';

const DEFAULT_WORKFLOW_LIMITS: Required<AgentHttpWorkflowLimits> = {
  maxSteps: 50,
  maxStepTimeoutMs: 30_000,
  maxRetryAttempts: 3,
  maxRetryDelayMs: 5_000,
};

export async function resolveAgentHttpRequestContext<Request>(
  request: Request,
  options: AgentHttpAdapterOptions<Request>,
): Promise<AgentHttpRequestContext> {
  return {
    userId: await options.getUserId(request),
    allowedModes: await options.getAllowedModes?.(request),
    approvalToken: await options.getApprovalToken?.(request),
    approvalContext: await options.getApprovalContext?.(request),
    metadata: await options.getMetadata?.(request),
    allowClientExecutionOptions: options.allowClientExecutionOptions,
    workflowLimits: options.workflowLimits,
  };
}

export function createActionListResponse(runner: AgentActionRunner): AgentHttpActionListResponse {
  return {
    ok: true,
    actions: runner.listActions().map((action) => ({
      name: action.name,
      mode: action.mode,
      description: action.description,
      approvalRequired: Boolean(action.approvalRequired || action.mode === 'mutate'),
      ...(action.tags === undefined ? {} : { tags: action.tags }),
      ...(action.resourceType === undefined ? {} : { resourceType: action.resourceType }),
      ...(action.riskLevel === undefined ? {} : { riskLevel: action.riskLevel }),
      ...(action.deprecated === undefined ? {} : { deprecated: action.deprecated }),
      ...(action.examples === undefined ? {} : { examples: action.examples }),
    })),
  };
}

export async function executeHttpAction(
  runner: AgentActionRunner,
  actionName: string,
  body: unknown,
  context: AgentHttpRequestContext,
): Promise<AgentHttpSuccessResponse> {
  const normalizedBody = toActionBody(body);
  const executionOptions = resolveExecutionOptions(normalizedBody, context);

  const result = await runner.executeAction({
    userId: context.userId,
    action: actionName,
    input: normalizedBody.input,
    ...executionOptions,
  });

  return {
    ok: true,
    result,
  };
}

export async function executeHttpWorkflow(
  runner: AgentActionRunner,
  body: unknown,
  context: AgentHttpRequestContext,
): Promise<AgentHttpSuccessResponse> {
  const normalizedBody = toWorkflowBody(body);
  const executionOptions = resolveExecutionOptions(normalizedBody, context);
  const workflow = resolveWorkflowForExecution(
    normalizedBody.workflow,
    executionOptions,
    Boolean(context.allowClientExecutionOptions),
  );
  assertWorkflowWithinLimits(workflow, context.workflowLimits);

  const result = await runner.executeWorkflow({
    userId: context.userId,
    workflow,
    workflowId: normalizedBody.workflowId,
    allowedModes: executionOptions.allowedModes,
    metadata: executionOptions.metadata,
  });

  return {
    ok: true,
    result,
  };
}

export function mapAgentRunnerError(error: unknown): AgentHttpMappedError {
  if (error instanceof WorkflowExecutionError) {
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause) {
      const mappedCause = mapKnownError(cause);
      if (mappedCause) {
        return mappedCause;
      }
    }

    return createError(400, 'WORKFLOW_EXECUTION_FAILED', error.message);
  }

  return mapKnownError(error) ?? createError(500, 'INTERNAL_ERROR', 'Internal server error.');
}

function mapKnownError(error: unknown): AgentHttpMappedError | undefined {
  if (error instanceof AgentHttpInputError) {
    return createError(400, error.code, error.message);
  }

  if (error instanceof ActionNotFoundError) {
    return createError(404, 'ACTION_NOT_FOUND', error.message);
  }

  if (error instanceof SchemaValidationError) {
    return createError(400, 'SCHEMA_VALIDATION_FAILED', error.message);
  }

  if (error instanceof ActionTimeoutError) {
    return createError(408, 'ACTION_TIMEOUT', error.message);
  }

  if (error instanceof InvalidStepReferenceError) {
    return createError(400, 'INVALID_STEP_REFERENCE', error.message);
  }

  if (error instanceof WorkflowValidationError) {
    return createError(400, 'WORKFLOW_VALIDATION_FAILED', error.message, {
      issues: error.issues,
    });
  }

  if (error instanceof ModeNotAllowedError) {
    return createError(403, 'MODE_NOT_ALLOWED', error.message);
  }

  if (error instanceof ApprovalRequiredError) {
    return createError(403, 'APPROVAL_REQUIRED', error.message);
  }

  if (error instanceof PolicyRejectedError) {
    return createError(403, 'POLICY_REJECTED', error.message);
  }

  return undefined;
}

function createError(
  statusCode: number,
  code: string,
  message: string,
  details: Pick<AgentHttpErrorResponse['error'], 'issues'> = {},
): AgentHttpMappedError {
  return {
    statusCode,
    response: {
      ok: false,
      error: {
        code,
        message,
        ...details,
      },
    },
  };
}

function resolveExecutionOptions(
  body: AgentHttpActionExecuteBody | AgentHttpWorkflowExecuteBody,
  context: AgentHttpRequestContext,
): {
  readonly allowedModes?: readonly ActionMode[];
  readonly approvalToken?: string;
  readonly approvalContext?: ApprovalContextOverrides;
  readonly metadata?: Readonly<Record<string, unknown>>;
} {
  const allowClientOptions = Boolean(context.allowClientExecutionOptions);

  return {
    allowedModes: context.allowedModes ?? (allowClientOptions ? body.allowedModes : undefined),
    approvalToken: context.approvalToken ?? (allowClientOptions ? body.approvalToken : undefined),
    approvalContext: context.approvalContext ?? (allowClientOptions ? body.approvalContext : undefined),
    metadata: context.metadata ?? (allowClientOptions ? body.metadata : undefined),
  };
}

function toActionBody(body: unknown): AgentHttpActionExecuteBody {
  if (isRecord(body)) {
    return body;
  }

  return {};
}

function toWorkflowBody(body: unknown): Required<Pick<AgentHttpWorkflowExecuteBody, 'workflow'>> & AgentHttpWorkflowExecuteBody {
  if (!isRecord(body) || !isRecord(body.workflow)) {
    throw createHttpInputError('WORKFLOW_REQUIRED', 'Request body must include a workflow object.');
  }

  return body as Required<Pick<AgentHttpWorkflowExecuteBody, 'workflow'>> & AgentHttpWorkflowExecuteBody;
}

function resolveWorkflowForExecution(
  workflow: WorkflowDefinition,
  executionOptions: {
    readonly approvalToken?: string;
    readonly approvalContext?: ApprovalContextOverrides;
  },
  allowClientExecutionOptions: boolean,
): WorkflowDefinition {
  if (!Array.isArray((workflow as { readonly steps?: unknown }).steps)) {
    return workflow;
  }

  return {
    ...workflow,
    steps: workflow.steps.map((step) => resolveWorkflowStepForExecution(
      step,
      executionOptions,
      allowClientExecutionOptions,
    )),
  };
}

function assertWorkflowWithinLimits(
  workflow: WorkflowDefinition,
  limits: AgentHttpWorkflowLimits | false | undefined,
): void {
  if (limits === false) {
    return;
  }

  const resolvedLimits = resolveWorkflowLimits(limits);
  const steps = (workflow as { readonly steps?: unknown }).steps;
  if (!Array.isArray(steps)) {
    return;
  }

  if (steps.length > resolvedLimits.maxSteps) {
    throw createHttpInputError(
      'WORKFLOW_LIMIT_EXCEEDED',
      `Workflow has ${steps.length} steps, which exceeds the limit of ${resolvedLimits.maxSteps}.`,
    );
  }

  steps.forEach((step, index) => {
    if (!isRecord(step)) {
      return;
    }

    if (typeof step.timeoutMs === 'number' && step.timeoutMs > resolvedLimits.maxStepTimeoutMs) {
      throw createHttpInputError(
        'WORKFLOW_LIMIT_EXCEEDED',
        `Workflow step ${index} timeoutMs exceeds the limit of ${resolvedLimits.maxStepTimeoutMs}.`,
      );
    }

    if (!isRecord(step.retry)) {
      return;
    }

    if (
      typeof step.retry.maxAttempts === 'number'
      && step.retry.maxAttempts > resolvedLimits.maxRetryAttempts
    ) {
      throw createHttpInputError(
        'WORKFLOW_LIMIT_EXCEEDED',
        `Workflow step ${index} retry.maxAttempts exceeds the limit of ${resolvedLimits.maxRetryAttempts}.`,
      );
    }

    if (
      typeof step.retry.delayMs === 'number'
      && step.retry.delayMs > resolvedLimits.maxRetryDelayMs
    ) {
      throw createHttpInputError(
        'WORKFLOW_LIMIT_EXCEEDED',
        `Workflow step ${index} retry.delayMs exceeds the limit of ${resolvedLimits.maxRetryDelayMs}.`,
      );
    }
  });
}

function resolveWorkflowLimits(limits: AgentHttpWorkflowLimits | undefined): Required<AgentHttpWorkflowLimits> {
  return {
    maxSteps: limits?.maxSteps ?? DEFAULT_WORKFLOW_LIMITS.maxSteps,
    maxStepTimeoutMs: limits?.maxStepTimeoutMs ?? DEFAULT_WORKFLOW_LIMITS.maxStepTimeoutMs,
    maxRetryAttempts: limits?.maxRetryAttempts ?? DEFAULT_WORKFLOW_LIMITS.maxRetryAttempts,
    maxRetryDelayMs: limits?.maxRetryDelayMs ?? DEFAULT_WORKFLOW_LIMITS.maxRetryDelayMs,
  };
}

function resolveWorkflowStepForExecution(
  step: WorkflowStep,
  executionOptions: {
    readonly approvalToken?: string;
    readonly approvalContext?: ApprovalContextOverrides;
  },
  allowClientExecutionOptions: boolean,
): WorkflowStep {
  const resolvedStep: WorkflowStep = {
    id: step.id,
    action: step.action,
    input: step.input,
    ...(step.timeoutMs === undefined ? {} : { timeoutMs: step.timeoutMs }),
    ...(step.retry === undefined ? {} : { retry: step.retry }),
    ...(step.continueOnError === undefined ? {} : { continueOnError: step.continueOnError }),
  };

  if (allowClientExecutionOptions) {
    return {
      ...resolvedStep,
      ...(step.allowedModes === undefined ? {} : { allowedModes: step.allowedModes }),
      ...resolveOptionalExecutionOptions({
        approvalToken: executionOptions.approvalToken ?? step.approvalToken,
        approvalContext: executionOptions.approvalContext ?? step.approvalContext,
      }),
    };
  }

  return {
    ...resolvedStep,
    ...resolveOptionalExecutionOptions(executionOptions),
  };
}

function resolveOptionalExecutionOptions(
  executionOptions: {
    readonly approvalToken?: string;
    readonly approvalContext?: ApprovalContextOverrides;
  },
): Pick<WorkflowStep, 'approvalToken' | 'approvalContext'> {
  return {
    ...(executionOptions.approvalToken === undefined ? {} : { approvalToken: executionOptions.approvalToken }),
    ...(executionOptions.approvalContext === undefined ? {} : { approvalContext: executionOptions.approvalContext }),
  };
}

function createHttpInputError(code: string, message: string): AgentHttpInputError {
  return new AgentHttpInputError(code, message);
}

class AgentHttpInputError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgentHttpInputError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
