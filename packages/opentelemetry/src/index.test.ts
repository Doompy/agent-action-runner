import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createRunner } from '@agent-action-runner/core';
import { instrumentRunner } from './index.js';
import type {
  Attributes,
  Counter,
  Histogram,
  Meter,
  Span,
  Tracer,
} from '@opentelemetry/api';

describe('@agent-action-runner/opentelemetry', () => {
  it('wraps action execution with spans and metrics', async () => {
    const telemetry = createFakeTelemetry();
    const runner = createRunner();
    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      inputSchema: z.object({ value: z.number() }),
      handler: ({ value }) => ({ value: value * 2 }),
    });

    const instrumented = instrumentRunner(runner, {
      tracer: telemetry.tracer,
      meter: telemetry.meter,
      attributes: {
        service: 'test',
      },
    });

    const result = await instrumented.executeAction({
      userId: 'user_1',
      action: 'math.double',
      input: { value: 2 },
      workflowId: 'workflow_1',
      stepId: 'step_1',
    });

    expect(result.output).toEqual({ value: 4 });
    expect(telemetry.spans.map((span) => span.name)).toEqual(['agent_action.execute']);
    expect(telemetry.spans[0].attributes).toEqual({
      service: 'test',
      'agent_action.name': 'math.double',
      'agent_action.mode': 'read',
    });
    expect(JSON.stringify(telemetry.spans[0].attributes)).not.toContain('user_1');
    expect(JSON.stringify(telemetry.spans[0].attributes)).not.toContain('workflow_1');
    expect(JSON.stringify(telemetry.spans[0].attributes)).not.toContain('step_1');
    expect(telemetry.counters.agent_action_started_total).toHaveLength(1);
    expect(telemetry.counters.agent_action_succeeded_total).toHaveLength(1);
    expect(telemetry.histograms.agent_action_duration_ms).toHaveLength(1);
    expect(JSON.stringify(telemetry.spans)).not.toContain('"value":2');
  });

  it('records failed action spans and metrics', async () => {
    const telemetry = createFakeTelemetry();
    const runner = createRunner();
    runner.registerAction({
      name: 'unstable.read',
      mode: 'read',
      handler: () => {
        throw new Error('boom');
      },
    });
    const instrumented = instrumentRunner(runner, {
      tracer: telemetry.tracer,
      meter: telemetry.meter,
    });

    await expect(instrumented.executeAction({
      userId: 'user_1',
      action: 'unstable.read',
      input: {},
    })).rejects.toThrow('boom');

    expect(telemetry.counters.agent_action_failed_total).toHaveLength(1);
    expect(telemetry.spans[0].status?.message).toBe('boom');
    expect(telemetry.spans[0].exceptions).toHaveLength(1);
  });

  it('adds high-cardinality attributes only with explicit opt-in and supports mapping', async () => {
    const telemetry = createFakeTelemetry();
    const runner = createRunner();
    runner.registerAction({
      name: 'math.double',
      mode: 'read',
      handler: () => ({ ok: true }),
    });
    const instrumented = instrumentRunner(runner, {
      tracer: telemetry.tracer,
      meter: telemetry.meter,
      includeUserId: true,
      includeWorkflowId: true,
      includeStepId: true,
      attributeMapper: ({ attributes }) => ({
        ...attributes,
        mapped: true,
      }),
    });

    await instrumented.executeAction({
      userId: 'user_1',
      action: 'math.double',
      input: {},
      workflowId: 'workflow_1',
      stepId: 'step_1',
    });

    expect(telemetry.spans[0].attributes).toMatchObject({
      'agent_action.user_id': 'user_1',
      'agent_action.workflow_id': 'workflow_1',
      'agent_action.step_id': 'step_1',
      mapped: true,
    });
    expect(telemetry.counters.agent_action_started_total[0].attributes).toMatchObject({
      mapped: true,
    });
  });

  it('wraps workflow execution with spans and metrics', async () => {
    const telemetry = createFakeTelemetry();
    const runner = createRunner();
    runner.registerAction({
      name: 'system.ping',
      mode: 'read',
      handler: () => ({ ok: true }),
    });
    const instrumented = instrumentRunner(runner, {
      tracer: telemetry.tracer,
      meter: telemetry.meter,
    });

    const result = await instrumented.executeWorkflow({
      userId: 'user_1',
      workflow: {
        workflowName: 'ping',
        steps: [
          {
            id: 'ping',
            action: 'system.ping',
            input: {},
          },
        ],
      },
    });

    expect(result.outputByStep.ping).toEqual({ ok: true });
    expect(telemetry.spans.map((span) => span.name)).toEqual(['agent_workflow.execute']);
    expect(telemetry.spans[0].attributes).toEqual({
      'agent_workflow.name': 'ping',
    });
    expect(telemetry.counters.agent_workflow_started_total).toHaveLength(1);
    expect(telemetry.counters.agent_workflow_succeeded_total).toHaveLength(1);
  });
});

type FakeSpan = {
  readonly name: string;
  readonly attributes: Attributes;
  readonly exceptions: unknown[];
  ended: boolean;
  status?: { readonly code: number; readonly message?: string };
  setAttribute(name: string, value: string | number | boolean): void;
  recordException(error: unknown): void;
  setStatus(status: { readonly code: number; readonly message?: string }): void;
  end(): void;
};

function createFakeTelemetry(): {
  readonly counters: Record<string, Array<{ readonly value: number; readonly attributes?: Attributes }>>;
  readonly histograms: Record<string, Array<{ readonly value: number; readonly attributes?: Attributes }>>;
  readonly meter: Meter;
  readonly spans: FakeSpan[];
  readonly tracer: Tracer;
} {
  const counters: Record<string, Array<{ readonly value: number; readonly attributes?: Attributes }>> = {};
  const histograms: Record<string, Array<{ readonly value: number; readonly attributes?: Attributes }>> = {};
  const spans: FakeSpan[] = [];
  const tracer = {
    startActiveSpan: (name: string, options: { readonly attributes?: Attributes }, callback: (span: Span) => unknown) => {
      const span = createFakeSpan(name, options.attributes ?? {});
      spans.push(span);
      return callback(span as unknown as Span);
    },
  } as unknown as Tracer;
  const meter = {
    createCounter: (name: string) => ({
      add: (value: number, attributes?: Attributes) => {
        counters[name] = [...(counters[name] ?? []), { value, attributes }];
      },
    }) as Counter,
    createHistogram: (name: string) => ({
      record: (value: number, attributes?: Attributes) => {
        histograms[name] = [...(histograms[name] ?? []), { value, attributes }];
      },
    }) as Histogram,
  } as unknown as Meter;

  return {
    counters,
    histograms,
    meter,
    spans,
    tracer,
  };
}

function createFakeSpan(name: string, attributes: Attributes): FakeSpan {
  return {
    name,
    attributes,
    exceptions: [],
    ended: false,
    setAttribute(attributeName, value) {
      (this.attributes as Record<string, string | number | boolean>)[attributeName] = value;
    },
    recordException(error) {
      this.exceptions.push(error);
    },
    setStatus(status) {
      this.status = status;
    },
    end() {
      this.ended = true;
    },
  };
}
