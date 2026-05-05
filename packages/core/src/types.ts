import type { z } from 'zod';

export type ActionMode = 'read' | 'draft' | 'dryRun' | 'mutate';

export type JsonPointer = `/${string}` | '';

export type StepReference = {
  readonly $fromStep: string;
  readonly path: JsonPointer;
};

export type WorkflowInputValue =
  | null
  | string
  | number
  | boolean
  | StepReference
  | WorkflowInputValue[]
  | { readonly [key: string]: WorkflowInputValue };

export type WorkflowStep = {
  readonly id: string;
  readonly action: string;
  readonly input: WorkflowInputValue;
  readonly allowedModes?: readonly ActionMode[];
  readonly approvalToken?: string;
};

export type WorkflowDefinition = {
  readonly workflowName: string;
  readonly steps: readonly WorkflowStep[];
};

export type ResolvedWorkflowStep = Omit<WorkflowStep, 'input'> & {
  readonly input: unknown;
};

export type AgentExecutionContext = {
  readonly executionId: string;
  readonly workflowId?: string;
  readonly stepId?: string;
  readonly userId: string;
  readonly actionName: string;
  readonly mode: ActionMode;
  readonly approvalToken?: string;
  readonly metadata: Readonly<Record<string, unknown>>;
  requireApproval(): void;
};

export type ActionHandler<Input, Output> = (
  input: Input,
  context: AgentExecutionContext,
) => Promise<Output> | Output;

export type ActionDefinition<Input = unknown, Output = unknown> = {
  readonly name: string;
  readonly mode: ActionMode;
  readonly description?: string;
  readonly inputSchema?: z.ZodType<Input>;
  readonly outputSchema?: z.ZodType<Output>;
  readonly approvalRequired?: boolean;
  readonly handler: ActionHandler<Input, Output>;
};

export type ExecutableActionDefinition = ActionDefinition<unknown, unknown>;

export type PolicyCheckInput = {
  readonly action: ExecutableActionDefinition;
  readonly input: unknown;
  readonly context: AgentExecutionContext;
};

export type PolicyCheckResult =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string };

export type PolicyCheck = (input: PolicyCheckInput) => Promise<PolicyCheckResult> | PolicyCheckResult;

export type ApprovalCheckInput = {
  readonly action: ExecutableActionDefinition;
  readonly input: unknown;
  readonly context: AgentExecutionContext;
};

export type ApprovalCheckResult =
  | { readonly approved: true; readonly approvalId?: string }
  | { readonly approved: false; readonly reason?: string };

export type ApprovalCheck = (input: ApprovalCheckInput) => Promise<ApprovalCheckResult> | ApprovalCheckResult;

export type ActionExecutionEvent = {
  readonly executionId: string;
  readonly workflowId?: string;
  readonly stepId?: string;
  readonly userId: string;
  readonly actionName: string;
  readonly mode: ActionMode;
  readonly input: unknown;
  readonly output?: unknown;
  readonly outputSummary?: string;
  readonly approvalToken?: string;
  readonly approvalId?: string;
  readonly status: 'started' | 'succeeded' | 'failed';
  readonly error?: unknown;
  readonly createdAt: Date;
};

export type AuditHook = (event: ActionExecutionEvent) => Promise<void> | void;

export type AgentRunnerOptions = {
  readonly defaultAllowedModes?: readonly ActionMode[];
  readonly policy?: PolicyCheck;
  readonly approval?: ApprovalCheck;
  readonly audit?: AuditHook;
  readonly createExecutionId?: () => string;
  readonly summarizeOutput?: (output: unknown) => string | undefined;
};

export type ActionExecutionInput = {
  readonly userId: string;
  readonly action: string;
  readonly input: unknown;
  readonly allowedModes?: readonly ActionMode[];
  readonly approvalToken?: string;
  readonly workflowId?: string;
  readonly stepId?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type ActionExecutionResult<Output = unknown> = {
  readonly executionId: string;
  readonly actionName: string;
  readonly mode: ActionMode;
  readonly output: Output;
  readonly approvalId?: string;
};

export type WorkflowExecutionInput = {
  readonly userId: string;
  readonly workflow: WorkflowDefinition;
  readonly workflowId?: string;
  readonly allowedModes?: readonly ActionMode[];
  readonly metadata?: Readonly<Record<string, unknown>>;
};

export type WorkflowStepResult = {
  readonly id: string;
  readonly actionName: string;
  readonly mode: ActionMode;
  readonly executionId: string;
  readonly output: unknown;
};

export type WorkflowExecutionResult = {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly steps: readonly WorkflowStepResult[];
  readonly outputByStep: Readonly<Record<string, unknown>>;
};
