import { describe, expect, it } from 'vitest';
import {
  createAuditHook,
  createStableHash,
  type ActionExecutionEvent,
  type AuditStore,
} from './index.js';

describe('audit helpers', () => {
  it('creates a stable hash for equivalent object values', () => {
    const left = createStableHash({
      beta: ['job_1', { nested: true }],
      alpha: 1,
    });
    const right = createStableHash({
      alpha: 1,
      beta: ['job_1', { nested: true }],
    });
    const different = createStableHash({
      alpha: 1,
      beta: ['job_2', { nested: true }],
    });

    expect(left).toBe(right);
    expect(left).not.toBe(different);
  });

  it('forwards audit events to a store', async () => {
    const events: ActionExecutionEvent[] = [];
    const store: AuditStore = {
      write: (event) => {
        events.push(event);
      },
    };
    const hook = createAuditHook(store);
    const event: ActionExecutionEvent = {
      executionId: 'exec_1',
      userId: 'operator_1',
      actionName: 'admin.searchUsers',
      mode: 'read',
      input: {},
      status: 'started',
      createdAt: new Date('2026-05-07T00:00:00.000Z'),
    };

    await hook(event);

    expect(events).toEqual([event]);
  });
});
