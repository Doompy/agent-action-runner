import type { z } from 'zod';

export type ActionMode = 'read' | 'draft' | 'dryRun' | 'mutate';

export type ActionRiskLevel = 'low' | 'medium' | 'high';

export type ActionExample = {
  readonly title: string;
  readonly input: unknown;
  readonly description?: string;
};

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
  readonly approvalContext?: ApprovalContextOverrides;
  readonly timeoutMs?: number;
  readonly retry?: WorkflowStepRetry;
  readonly continueOnError?: boolean;
};

export type WorkflowStepRetry = {
  readonly maxAttempts: number;
  readonly delayMs?: number;
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
  readonly approvalContext: ApprovalContext;
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
  readonly tags?: readonly string[];
  readonly resourceType?: string;
  readonly riskLevel?: ActionRiskLevel;
  readonly deprecated?: boolean | string;
  readonly examples?: readonly ActionExample[];
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
  readonly approvalToken?: string;
  readonly approvalContext: ApprovalContext;
};

export type ApprovalContext = {
  readonly userId: string;
  readonly actionName: string;
  readonly mode: ActionMode;
  readonly inputHash: string;
  readonly resourceIds?: readonly string[];
  readonly dryRunHash?: string;
  readonly expiresAt?: string;
  readonly workflowId?: string;
  readonly stepId?: string;
};

export type ApprovalContextOverrides = {
  readonly resourceIds?: readonly string[];
  readonly dryRunHash?: string;
  readonly expiresAt?: string;
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
  readonly attempt?: number;
  readonly maxAttempts?: number;
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

export type AuditStore = {
  write(event: ActionExecutionEvent): Promise<void> | void;
};

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
  readonly executionId?: string;
  readonly attempt?: number;
  readonly maxAttempts?: number;
  readonly timeoutMs?: number;
  readonly allowedModes?: readonly ActionMode[];
  readonly approvalToken?: string;
  readonly approvalContext?: ApprovalContextOverrides;
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

export type WorkflowStepError = {
  readonly name: string;
  readonly message: string;
};

export type WorkflowStepSucceededResult = {
  readonly id: string;
  readonly actionName: string;
  readonly mode: ActionMode;
  readonly executionId: string;
  readonly status: 'succeeded';
  readonly attempts: number;
  readonly output: unknown;
};

export type WorkflowStepFailedResult = {
  readonly id: string;
  readonly actionName: string;
  readonly mode?: ActionMode;
  readonly executionId: string;
  readonly status: 'failed';
  readonly attempts: number;
  readonly error: WorkflowStepError;
  readonly continued: true;
  readonly output?: unknown;
};

export type WorkflowStepResult = WorkflowStepSucceededResult | WorkflowStepFailedResult;

export type WorkflowExecutionResult = {
  readonly workflowId: string;
  readonly workflowName: string;
  readonly steps: readonly WorkflowStepResult[];
  readonly outputByStep: Readonly<Record<string, unknown>>;
};
