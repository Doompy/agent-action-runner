import type { WorkflowValidationIssue } from './validation.js';

export class AgentActionRunnerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
  }
}

export class ActionAlreadyRegisteredError extends AgentActionRunnerError {
  constructor(actionName: string) {
    super(`Action "${actionName}" is already registered.`);
  }
}

export class ActionNotFoundError extends AgentActionRunnerError {
  constructor(actionName: string) {
    super(`Action "${actionName}" is not registered.`);
  }
}

export class ActionTimeoutError extends AgentActionRunnerError {
  constructor(actionName: string, timeoutMs: number) {
    super(`Action "${actionName}" timed out after ${timeoutMs}ms.`);
  }
}

export class ModeNotAllowedError extends AgentActionRunnerError {
  constructor(actionName: string, mode: string) {
    super(`Action "${actionName}" uses mode "${mode}", which is not allowed for this execution.`);
  }
}

export class PolicyRejectedError extends AgentActionRunnerError {
  constructor(actionName: string, reason: string) {
    super(`Policy rejected action "${actionName}": ${reason}`);
  }
}

export class ApprovalRequiredError extends AgentActionRunnerError {
  constructor(actionName: string) {
    super(`Action "${actionName}" requires approval.`);
  }
}

export class SchemaValidationError extends AgentActionRunnerError {
  constructor(actionName: string, target: 'input' | 'output', cause: unknown) {
    super(`Action "${actionName}" failed ${target} schema validation.`);
    this.cause = cause;
  }
}

export class InvalidStepReferenceError extends AgentActionRunnerError {
  constructor(message: string) {
    super(message);
  }
}

export class DuplicateWorkflowStepError extends AgentActionRunnerError {
  constructor(stepId: string) {
    super(`Workflow step "${stepId}" is already defined.`);
  }
}

export class WorkflowExecutionError extends AgentActionRunnerError {
  constructor(stepId: string, actionName: string, cause: unknown) {
    super(`Workflow step "${stepId}" failed while executing action "${actionName}".`);
    this.cause = cause;
  }
}

export class WorkflowValidationError extends AgentActionRunnerError {
  constructor(readonly issues: readonly WorkflowValidationIssue[]) {
    super('Workflow definition failed validation.');
  }
}
