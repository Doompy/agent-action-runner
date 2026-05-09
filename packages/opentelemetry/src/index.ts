import {
  SpanStatusCode,
  metrics,
  trace,
  type Attributes,
  type Counter,
  type Histogram,
  type Meter,
  type Span,
  type Tracer,
} from '@opentelemetry/api';
import type {
  ActionDefinition,
  ActionExecutionInput,
  ActionExecutionResult,
  AgentActionRunner,
  WorkflowExecutionInput,
  WorkflowExecutionResult,
} from '@agent-action-runner/core';

const DEFAULT_INSTRUMENTATION_NAME = '@agent-action-runner/opentelemetry';

export type InstrumentedAgentActionRunner = Pick<
  AgentActionRunner,
  'registerAction' | 'getAction' | 'listActions' | 'executeAction' | 'executeWorkflow'
>;

export type OpenTelemetryInstrumentationOptions = {
  readonly tracer?: Tracer;
  readonly meter?: Meter;
  readonly tracerName?: string;
  readonly meterName?: string;
  readonly attributes?: Attributes;
};

export function instrumentRunner(
  runner: AgentActionRunner,
  options: OpenTelemetryInstrumentationOptions = {},
): InstrumentedAgentActionRunner {
  const tracer = options.tracer ?? trace.getTracer(options.tracerName ?? DEFAULT_INSTRUMENTATION_NAME);
  const meter = options.meter ?? metrics.getMeter(options.meterName ?? DEFAULT_INSTRUMENTATION_NAME);
  const instruments = createInstruments(meter);

  return {
    registerAction: <Input, Output>(definition: ActionDefinition<Input, Output>) => {
      runner.registerAction(definition);
    },
    getAction: (name) => runner.getAction(name),
    listActions: () => runner.listActions(),
    executeAction: <Output = unknown>(request: ActionExecutionInput) => (
      executeActionWithTelemetry<Output>(runner, request, {
        attributes: options.attributes,
        instruments,
        tracer,
      })
    ),
    executeWorkflow: (request: WorkflowExecutionInput) => (
      executeWorkflowWithTelemetry(runner, request, {
        attributes: options.attributes,
        instruments,
        tracer,
      })
    ),
  };
}

async function executeActionWithTelemetry<Output>(
  runner: AgentActionRunner,
  request: ActionExecutionInput,
  telemetry: TelemetryRuntime,
): Promise<ActionExecutionResult<Output>> {
  const attributes = createActionAttributes(request, telemetry.attributes);
  telemetry.instruments.actionStarted.add(1, attributes);
  const start = Date.now();

  return telemetry.tracer.startActiveSpan('agent_action.execute', { attributes }, async (span) => {
    try {
      const result = await runner.executeAction<Output>(request);
      span.setAttribute('agent_action.execution_id', result.executionId);
      telemetry.instruments.actionSucceeded.add(1, attributes);
      return result;
    } catch (error) {
      recordSpanError(span, error);
      telemetry.instruments.actionFailed.add(1, attributes);
      throw error;
    } finally {
      telemetry.instruments.actionDuration.record(Date.now() - start, attributes);
      span.end();
    }
  });
}

async function executeWorkflowWithTelemetry(
  runner: AgentActionRunner,
  request: WorkflowExecutionInput,
  telemetry: TelemetryRuntime,
): Promise<WorkflowExecutionResult> {
  const attributes = createWorkflowAttributes(request, telemetry.attributes);
  telemetry.instruments.workflowStarted.add(1, attributes);

  return telemetry.tracer.startActiveSpan('agent_workflow.execute', { attributes }, async (span) => {
    try {
      const result = await runner.executeWorkflow(request);
      span.setAttribute('agent_workflow.id', result.workflowId);
      telemetry.instruments.workflowSucceeded.add(1, attributes);
      return result;
    } catch (error) {
      recordSpanError(span, error);
      telemetry.instruments.workflowFailed.add(1, attributes);
      throw error;
    } finally {
      span.end();
    }
  });
}

type TelemetryRuntime = {
  readonly attributes?: Attributes;
  readonly instruments: RunnerInstruments;
  readonly tracer: Tracer;
};

type RunnerInstruments = {
  readonly actionStarted: Counter;
  readonly actionSucceeded: Counter;
  readonly actionFailed: Counter;
  readonly actionDuration: Histogram;
  readonly workflowStarted: Counter;
  readonly workflowSucceeded: Counter;
  readonly workflowFailed: Counter;
};

function createInstruments(meter: Meter): RunnerInstruments {
  return {
    actionStarted: meter.createCounter('agent_action_started_total'),
    actionSucceeded: meter.createCounter('agent_action_succeeded_total'),
    actionFailed: meter.createCounter('agent_action_failed_total'),
    actionDuration: meter.createHistogram('agent_action_duration_ms', {
      unit: 'ms',
    }),
    workflowStarted: meter.createCounter('agent_workflow_started_total'),
    workflowSucceeded: meter.createCounter('agent_workflow_succeeded_total'),
    workflowFailed: meter.createCounter('agent_workflow_failed_total'),
  };
}

function createActionAttributes(
  request: ActionExecutionInput,
  base: Attributes | undefined,
): Attributes {
  return omitUndefined({
    ...base,
    'agent_action.name': request.action,
    'agent_action.user_id': request.userId,
    'agent_action.workflow_id': request.workflowId,
    'agent_action.step_id': request.stepId,
    'agent_action.attempt': request.attempt,
    'agent_action.max_attempts': request.maxAttempts,
  });
}

function createWorkflowAttributes(
  request: WorkflowExecutionInput,
  base: Attributes | undefined,
): Attributes {
  return omitUndefined({
    ...base,
    'agent_workflow.name': request.workflow.workflowName,
    'agent_workflow.id': request.workflowId,
    'agent_action.user_id': request.userId,
  });
}

function recordSpanError(span: Span, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error) {
    span.recordException(error);
  }
  span.setStatus({
    code: SpanStatusCode.ERROR,
    message,
  });
}

function omitUndefined(attributes: Record<string, unknown>): Attributes {
  return Object.fromEntries(
    Object.entries(attributes).filter((entry): entry is [string, string | number | boolean] => (
      entry[1] !== undefined
      && (
        typeof entry[1] === 'string'
        || typeof entry[1] === 'number'
        || typeof entry[1] === 'boolean'
      )
    )),
  );
}
