import type {
  ActionExample,
  ActionMode,
  ActionRiskLevel,
  AgentActionRunner,
  ApprovalContextOverrides,
  WorkflowDefinition,
} from '@agent-action-runner/core';

export type MaybePromise<T> = T | Promise<T>;

export type AgentHttpAdapterOptions<Request = unknown> = {
  readonly getUserId: (request: Request) => MaybePromise<string>;
  readonly getAllowedModes?: (request: Request) => MaybePromise<readonly ActionMode[] | undefined>;
  readonly getApprovalToken?: (request: Request) => MaybePromise<string | undefined>;
  readonly getApprovalContext?: (request: Request) => MaybePromise<ApprovalContextOverrides | undefined>;
  readonly getMetadata?: (request: Request) => MaybePromise<Readonly<Record<string, unknown>> | undefined>;
  readonly allowClientExecutionOptions?: boolean;
};

export type AgentHttpRequestContext = {
  readonly userId: string;
  readonly allowedModes?: readonly ActionMode[];
  readonly approvalToken?: string;
  readonly approvalContext?: ApprovalContextOverrides;
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly allowClientExecutionOptions?: boolean;
};

export type AgentHttpActionSummary = {
  readonly name: string;
  readonly mode: ActionMode;
  readonly description?: string;
  readonly approvalRequired: boolean;
  readonly tags?: readonly string[];
  readonly resourceType?: string;
  readonly riskLevel?: ActionRiskLevel;
  readonly deprecated?: boolean | string;
  readonly examples?: readonly ActionExample[];
};

export type AgentHttpActionExecuteBody = {
  readonly input?: unknown;
  readonly allowedModes?: readonly ActionMode[];
  readonly approvalToken?: string;
  readonly approvalContext?: ApprovalContextOverrides;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type AgentHttpWorkflowExecuteBody = {
  readonly workflow?: WorkflowDefinition;
  readonly workflowId?: string;
  readonly allowedModes?: readonly ActionMode[];
  readonly approvalToken?: string;
  readonly approvalContext?: ApprovalContextOverrides;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type AgentHttpSuccessResponse<Result = unknown> = {
  readonly ok: true;
  readonly result: Result;
};

export type AgentHttpActionListResponse = {
  readonly ok: true;
  readonly actions: readonly AgentHttpActionSummary[];
};

export type AgentHttpErrorResponse = {
  readonly ok: false;
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
};

export type AgentHttpMappedError = {
  readonly statusCode: number;
  readonly response: AgentHttpErrorResponse;
};

export type AgentHttpActionExecutionRequest = {
  readonly runner: AgentActionRunner;
  readonly actionName: string;
  readonly body: unknown;
  readonly context: AgentHttpRequestContext;
};

export type AgentHttpWorkflowExecutionRequest = {
  readonly runner: AgentActionRunner;
  readonly body: unknown;
  readonly context: AgentHttpRequestContext;
};
