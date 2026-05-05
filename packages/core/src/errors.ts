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

export class WorkflowExecutionError extends AgentActionRunnerError {
  constructor(stepId: string, actionName: string, cause: unknown) {
    super(`Workflow step "${stepId}" failed while executing action "${actionName}".`);
    this.cause = cause;
  }
}
