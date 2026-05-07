import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ActionExecutionEvent } from '@agent-action-runner/core';
import { describe, expect, it } from 'vitest';
import { FileAuditStore } from './audit-store.js';

describe('FileAuditStore', () => {
  it('persists audit events and reads them from a new store instance', async () => {
    const filePath = join(await mkdtemp(join(tmpdir(), 'aar-audit-')), 'audit.jsonl');
    const store = new FileAuditStore(filePath);
    const event: ActionExecutionEvent = {
      executionId: 'exec_1',
      userId: 'operator_1',
      actionName: 'admin.disableUser',
      mode: 'mutate',
      input: {
        userId: 'user_2',
      },
      outputSummary: '{"userId":"user_2"}',
      approvalTokenHash: 'hashed-token',
      approvalId: 'approval_1',
      status: 'succeeded',
      createdAt: new Date('2026-05-07T00:00:00.000Z'),
    };

    await store.write(event);

    const reloaded = new FileAuditStore(filePath);
    await expect(reloaded.readAll()).resolves.toEqual([
      {
        executionId: 'exec_1',
        userId: 'operator_1',
        actionName: 'admin.disableUser',
        mode: 'mutate',
        input: {
          userId: 'user_2',
        },
        outputSummary: '{"userId":"user_2"}',
        approvalTokenHash: 'hashed-token',
        approvalId: 'approval_1',
        status: 'succeeded',
        createdAt: '2026-05-07T00:00:00.000Z',
      },
    ]);
  });
});
