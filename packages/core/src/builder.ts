import { DuplicateWorkflowStepError } from './errors.js';
import { fromStep as createStepReference } from './references.js';
import type { AgentActionRunner } from './runner.js';
import type {
  ActionDefinition,
  JsonPointer,
  StepReference,
  WorkflowDefinition,
  WorkflowInputValue,
  WorkflowStep,
} from './types.js';

export type DefinedAction<Input = unknown, Output = unknown> = ActionDefinition<Input, Output>;

export type ActionCatalog = Readonly<Record<string, DefinedAction<any, any>>>;

export type ActionInput<Action> = Action extends ActionDefinition<infer Input, any> ? Input : never;

export type ActionOutput<Action> = Action extends ActionDefinition<any, infer Output> ? Output : never;

export type WorkflowInputFor<T> =
  | StepReference
  | (
    T extends readonly (infer Item)[]
      ? readonly WorkflowInputFor<Item>[]
      : T extends object
        ? { readonly [Key in keyof T]: WorkflowInputFor<T[Key]> }
        : T
  );

export type WorkflowStepOptions = Pick<
  WorkflowStep,
  'allowedModes' | 'approvalToken' | 'approvalContext'
>;

export type WorkflowBuilderStepContext<Outputs extends WorkflowBuilderOutputs> = {
  readonly fromStep: <StepId extends Extract<keyof Outputs, string>>(
    stepId: StepId,
    path?: JsonPointer,
  ) => StepReference;
};

export type WorkflowBuilderOutputs = Readonly<Record<string, unknown>>;

export type WorkflowBuilder<Outputs extends WorkflowBuilderOutputs = Record<never, never>> = {
  step<StepId extends string, Input, Output>(
    id: StepId extends keyof Outputs ? never : StepId,
    action: ActionDefinition<Input, Output>,
    input: WorkflowInputFor<Input> | ((
      context: WorkflowBuilderStepContext<Outputs>,
    ) => WorkflowInputFor<Input>),
    options?: WorkflowStepOptions,
  ): WorkflowBuilder<Outputs & Readonly<Record<StepId, Output>>>;
  build(): WorkflowDefinition;
};

export function defineAction<Input, Output>(
  definition: ActionDefinition<Input, Output>,
): DefinedAction<Input, Output> {
  return definition;
}

export function defineActionCatalog<Catalog extends ActionCatalog>(
  catalog: Catalog,
): Catalog {
  return catalog;
}

export function registerActionCatalog(
  runner: AgentActionRunner,
  catalog: ActionCatalog,
): void {
  for (const action of Object.values(catalog)) {
    runner.registerAction(action);
  }
}

export function defineWorkflow(workflowName: string): WorkflowBuilder {
  return new WorkflowBuilderImpl(workflowName, []) as WorkflowBuilder;
}

class WorkflowBuilderImpl {
  constructor(
    private readonly workflowName: string,
    private readonly steps: readonly WorkflowStep[],
  ) {}

  step(
    id: string,
    action: ActionDefinition,
    input: WorkflowInputFor<unknown> | ((
      context: WorkflowBuilderStepContext<WorkflowBuilderOutputs>,
    ) => WorkflowInputFor<unknown>),
    options: WorkflowStepOptions = {},
  ): WorkflowBuilder {
    if (this.steps.some((step) => step.id === id)) {
      throw new DuplicateWorkflowStepError(id);
    }

    const resolvedInput = typeof input === 'function'
      ? input({ fromStep: createStepReference })
      : input;

    return new WorkflowBuilderImpl(this.workflowName, [
      ...this.steps,
      {
        id,
        action: action.name,
        input: resolvedInput as WorkflowInputValue,
        ...options,
      },
    ]) as WorkflowBuilder;
  }

  build(): WorkflowDefinition {
    return {
      workflowName: this.workflowName,
      steps: this.steps,
    };
  }
}
