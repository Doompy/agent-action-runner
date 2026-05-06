import type {
  ActionMode,
  JsonPointer,
  StepReference,
  WorkflowDefinition,
  WorkflowInputValue,
} from './types.js';

const ACTION_MODES: readonly ActionMode[] = ['read', 'draft', 'dryRun', 'mutate'];

export type WorkflowValidationIssueCode =
  | 'invalidWorkflowName'
  | 'invalidSteps'
  | 'duplicateStepId'
  | 'unknownAction'
  | 'invalidMode'
  | 'invalidStepReference'
  | 'invalidInputValue';

export type WorkflowValidationIssue = {
  readonly code: WorkflowValidationIssueCode;
  readonly message: string;
  readonly path?: string;
  readonly stepId?: string;
  readonly actionName?: string;
};

export type WorkflowValidationResult = {
  readonly valid: boolean;
  readonly issues: readonly WorkflowValidationIssue[];
};

export type WorkflowValidationAction = {
  readonly name: string;
  readonly mode?: ActionMode;
};

export type WorkflowValidationOptions = {
  readonly actions?: readonly WorkflowValidationAction[];
};

export function validateWorkflowDefinition(
  workflow: unknown,
  options: WorkflowValidationOptions = {},
): WorkflowValidationResult {
  const issues: WorkflowValidationIssue[] = [];

  if (!isRecord(workflow)) {
    return createResult([{
      code: 'invalidSteps',
      message: 'Workflow must be an object.',
      path: '',
    }]);
  }

  if (typeof workflow.workflowName !== 'string' || workflow.workflowName.trim().length === 0) {
    issues.push({
      code: 'invalidWorkflowName',
      message: 'Workflow name must be a non-empty string.',
      path: '/workflowName',
    });
  }

  if (!Array.isArray(workflow.steps)) {
    issues.push({
      code: 'invalidSteps',
      message: 'Workflow steps must be an array.',
      path: '/steps',
    });
    return createResult(issues);
  }

  const knownActions = new Map((options.actions ?? []).map((action) => [action.name, action]));
  const hasActionCatalog = knownActions.size > 0;
  const seenStepIds = new Set<string>();

  workflow.steps.forEach((step, index) => {
    const stepPath = `/steps/${index}`;
    if (!isRecord(step)) {
      issues.push({
        code: 'invalidSteps',
        message: 'Workflow step must be an object.',
        path: stepPath,
      });
      return;
    }

    const stepId = typeof step.id === 'string' ? step.id : undefined;
    if (!stepId || stepId.length === 0) {
      issues.push({
        code: 'invalidSteps',
        message: 'Workflow step id must be a non-empty string.',
        path: `${stepPath}/id`,
      });
    } else if (seenStepIds.has(stepId)) {
      issues.push({
        code: 'duplicateStepId',
        message: `Workflow step "${stepId}" is duplicated.`,
        path: `${stepPath}/id`,
        stepId,
      });
    }

    const actionName = typeof step.action === 'string' ? step.action : undefined;
    if (!actionName || actionName.length === 0) {
      issues.push({
        code: 'invalidSteps',
        message: 'Workflow step action must be a non-empty string.',
        path: `${stepPath}/action`,
        stepId,
      });
    } else if (hasActionCatalog && !knownActions.has(actionName)) {
      issues.push({
        code: 'unknownAction',
        message: `Action "${actionName}" is not in the action catalog.`,
        path: `${stepPath}/action`,
        actionName,
        stepId,
      });
    }

    if ('allowedModes' in step) {
      validateAllowedModes(step.allowedModes, `${stepPath}/allowedModes`, stepId, issues);
    }

    if (!('input' in step)) {
      issues.push({
        code: 'invalidInputValue',
        message: 'Workflow step input is required.',
        path: `${stepPath}/input`,
        actionName,
        stepId,
      });
    } else {
      validateWorkflowInputValue(step.input, {
        actionName,
        issues,
        path: `${stepPath}/input`,
        previousStepIds: seenStepIds,
        stepId,
      });
    }

    if (stepId) {
      seenStepIds.add(stepId);
    }
  });

  return createResult(issues);
}

function validateAllowedModes(
  value: unknown,
  path: string,
  stepId: string | undefined,
  issues: WorkflowValidationIssue[],
): void {
  if (!Array.isArray(value)) {
    issues.push({
      code: 'invalidMode',
      message: 'allowedModes must be an array of action modes.',
      path,
      stepId,
    });
    return;
  }

  value.forEach((mode, index) => {
    if (typeof mode !== 'string' || !ACTION_MODES.includes(mode as ActionMode)) {
      issues.push({
        code: 'invalidMode',
        message: `allowedModes contains invalid mode "${String(mode)}".`,
        path: `${path}/${index}`,
        stepId,
      });
    }
  });
}

function validateWorkflowInputValue(
  value: unknown,
  context: {
    readonly actionName?: string;
    readonly issues: WorkflowValidationIssue[];
    readonly path: string;
    readonly previousStepIds: ReadonlySet<string>;
    readonly stepId?: string;
  },
): void {
  if (isStepReference(value)) {
    if (!context.previousStepIds.has(value.$fromStep)) {
      context.issues.push({
        code: 'invalidStepReference',
        message: `Step reference "${value.$fromStep}" must point to a previous step.`,
        path: context.path,
        actionName: context.actionName,
        stepId: context.stepId,
      });
    }
    return;
  }

  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => validateWorkflowInputValue(item, {
      ...context,
      path: `${context.path}/${index}`,
    }));
    return;
  }

  if (isRecord(value)) {
    if (Object.prototype.hasOwnProperty.call(value, '$fromStep')) {
      context.issues.push({
        code: 'invalidStepReference',
        message: 'Step reference must include string $fromStep and a JSON pointer path.',
        path: context.path,
        actionName: context.actionName,
        stepId: context.stepId,
      });
      return;
    }

    for (const [key, item] of Object.entries(value)) {
      validateWorkflowInputValue(item, {
        ...context,
        path: `${context.path}/${escapeJsonPointerSegment(key)}`,
      });
    }
    return;
  }

  context.issues.push({
    code: 'invalidInputValue',
    message: `Workflow input contains unsupported value "${String(value)}".`,
    path: context.path,
    actionName: context.actionName,
    stepId: context.stepId,
  });
}

function isStepReference(value: unknown): value is StepReference {
  return (
    isRecord(value)
    && typeof value.$fromStep === 'string'
    && isJsonPointer(value.path)
  );
}

function isJsonPointer(value: unknown): value is JsonPointer {
  return typeof value === 'string' && (value === '' || value.startsWith('/'));
}

function escapeJsonPointerSegment(segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1');
}

function createResult(issues: readonly WorkflowValidationIssue[]): WorkflowValidationResult {
  return {
    valid: issues.length === 0,
    issues,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
