import {
  ActionNotFoundError,
  ActionTimeoutError,
  ApprovalRequiredError,
  InvalidStepReferenceError,
  ModeNotAllowedError,
  PolicyRejectedError,
  SchemaValidationError,
  WorkflowExecutionError,
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
  AgentHttpWorkflowExecuteBody,
} from './types.js';

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

function createError(statusCode: number, code: string, message: string): AgentHttpMappedError {
  return {
    statusCode,
    response: {
      ok: false,
      error: {
        code,
        message,
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
  return {
    ...workflow,
    steps: workflow.steps.map((step) => resolveWorkflowStepForExecution(
      step,
      executionOptions,
      allowClientExecutionOptions,
    )),
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
    timeoutMs: step.timeoutMs,
    retry: step.retry,
    continueOnError: step.continueOnError,
  };

  if (allowClientExecutionOptions) {
    return {
      ...resolvedStep,
      allowedModes: step.allowedModes,
      approvalToken: executionOptions.approvalToken ?? step.approvalToken,
      approvalContext: executionOptions.approvalContext ?? step.approvalContext,
    };
  }

  return {
    ...resolvedStep,
    approvalToken: executionOptions.approvalToken,
    approvalContext: executionOptions.approvalContext,
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
