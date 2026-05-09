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
  readonly includeUserId?: boolean;
  readonly includeWorkflowId?: boolean;
  readonly includeStepId?: boolean;
  readonly attributeMapper?: (input: OpenTelemetryAttributeMapperInput) => Attributes;
};

export type OpenTelemetryAttributeMapperInput = {
  readonly kind: 'action' | 'workflow';
  readonly attributes: Attributes;
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
        instruments,
        options,
        tracer,
      })
    ),
    executeWorkflow: (request: WorkflowExecutionInput) => (
      executeWorkflowWithTelemetry(runner, request, {
        instruments,
        options,
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
  const action = runner.getAction(request.action);
  const attributes = createActionAttributes(request, telemetry.options, action?.mode);
  telemetry.instruments.actionStarted.add(1, attributes);
  const start = Date.now();

  return telemetry.tracer.startActiveSpan('agent_action.execute', { attributes }, async (span) => {
    try {
      const result = await runner.executeAction<Output>(request);
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
  const attributes = createWorkflowAttributes(request, telemetry.options);
  telemetry.instruments.workflowStarted.add(1, attributes);

  return telemetry.tracer.startActiveSpan('agent_workflow.execute', { attributes }, async (span) => {
    try {
      const result = await runner.executeWorkflow(request);
      if (telemetry.options.includeWorkflowId) {
        span.setAttribute('agent_workflow.id', result.workflowId);
      }
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
  readonly instruments: RunnerInstruments;
  readonly options: OpenTelemetryInstrumentationOptions;
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
  options: OpenTelemetryInstrumentationOptions,
  actionMode: string | undefined,
): Attributes {
  return mapAttributes(options, 'action', {
    ...options.attributes,
    'agent_action.name': request.action,
    'agent_action.mode': actionMode,
    ...(options.includeUserId ? { 'agent_action.user_id': request.userId } : {}),
    ...(options.includeWorkflowId ? { 'agent_action.workflow_id': request.workflowId } : {}),
    ...(options.includeStepId ? { 'agent_action.step_id': request.stepId } : {}),
    'agent_action.attempt': request.attempt,
    'agent_action.max_attempts': request.maxAttempts,
  });
}

function createWorkflowAttributes(
  request: WorkflowExecutionInput,
  options: OpenTelemetryInstrumentationOptions,
): Attributes {
  return mapAttributes(options, 'workflow', {
    ...options.attributes,
    'agent_workflow.name': request.workflow.workflowName,
    ...(options.includeWorkflowId ? { 'agent_workflow.id': request.workflowId } : {}),
    ...(options.includeUserId ? { 'agent_action.user_id': request.userId } : {}),
  });
}

function mapAttributes(
  options: OpenTelemetryInstrumentationOptions,
  kind: OpenTelemetryAttributeMapperInput['kind'],
  attributes: Record<string, unknown>,
): Attributes {
  const safeAttributes = omitUndefined(attributes);
  return options.attributeMapper
    ? options.attributeMapper({ kind, attributes: safeAttributes })
    : safeAttributes;
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
