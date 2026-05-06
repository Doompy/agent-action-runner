import { describe, expect, it } from 'vitest';
import { validateWorkflowDefinition } from './index.js';

const actions = [
  { name: 'delivery.searchJobs', mode: 'read' as const },
  { name: 'delivery.dryRunRetry', mode: 'dryRun' as const },
];

describe('validateWorkflowDefinition', () => {
  it('accepts a valid sequential workflow', () => {
    const result = validateWorkflowDefinition({
      workflowName: 'retry-failed-jobs',
      steps: [
        {
          id: 'jobs',
          action: 'delivery.searchJobs',
          input: { status: ['FAILED'] },
        },
        {
          id: 'dryRun',
          action: 'delivery.dryRunRetry',
          input: {
            jobIds: { $fromStep: 'jobs', path: '/jobIds' },
          },
        },
      ],
    }, { actions });

    expect(result).toEqual({
      valid: true,
      issues: [],
    });
  });

  it('reports duplicate step ids', () => {
    const result = validateWorkflowDefinition({
      workflowName: 'duplicate',
      steps: [
        { id: 'jobs', action: 'delivery.searchJobs', input: {} },
        { id: 'jobs', action: 'delivery.searchJobs', input: {} },
      ],
    }, { actions });

    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'duplicateStepId',
        stepId: 'jobs',
      }),
    ]);
  });

  it('reports unknown actions when an action catalog is supplied', () => {
    const result = validateWorkflowDefinition({
      workflowName: 'unknown-action',
      steps: [
        { id: 'jobs', action: 'delivery.missing', input: {} },
      ],
    }, { actions });

    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'unknownAction',
        actionName: 'delivery.missing',
      }),
    ]);
  });

  it('reports future or nonexistent step references', () => {
    const result = validateWorkflowDefinition({
      workflowName: 'bad-reference',
      steps: [
        {
          id: 'dryRun',
          action: 'delivery.dryRunRetry',
          input: {
            jobIds: { $fromStep: 'jobs', path: '/jobIds' },
          },
        },
        {
          id: 'jobs',
          action: 'delivery.searchJobs',
          input: {},
        },
      ],
    }, { actions });

    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'invalidStepReference',
        stepId: 'dryRun',
      }),
    ]);
  });

  it('reports invalid modes and unsupported input values', () => {
    const result = validateWorkflowDefinition({
      workflowName: 'invalid-mode',
      steps: [
        {
          id: 'jobs',
          action: 'delivery.searchJobs',
          allowedModes: ['read', 'invalid'],
          input: {
            value: undefined,
          },
        },
      ],
    }, { actions });

    expect(result.issues.map((issue) => issue.code)).toEqual([
      'invalidMode',
      'invalidInputValue',
    ]);
  });
});
