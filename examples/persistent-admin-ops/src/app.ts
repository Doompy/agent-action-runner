import { join } from 'node:path';
import express from 'express';
import type { Request } from 'express';
import { createAuditHook, createRunner } from '@agent-action-runner/core';
import { createExpressAdapter } from '@agent-action-runner/express';
import {
  DisableUserApprovalRequestSchema,
  cloneUsers,
  createUserStore,
  registerAdminActions,
} from 'agent-action-runner-shared-admin-ops-example';
import { FileApprovalStore } from './approval-store.js';
import { FileAuditStore } from './audit-store.js';

export type PersistentAdminOpsExampleOptions = {
  readonly dataDir?: string;
};

export function createPersistentAdminOpsExampleApp(
  options: PersistentAdminOpsExampleOptions = {},
) {
  const dataDir = options.dataDir ?? join(process.cwd(), '.agent-runner-data', 'persistent-admin-ops');
  const users = createUserStore();
  const auditStore = new FileAuditStore(join(dataDir, 'audit.jsonl'));
  const approvalStore = new FileApprovalStore(join(dataDir, 'approvals.json'));

  const runner = createRunner({
    approval: ({ approvalToken, approvalContext }) => approvalStore.verifyApprovalToken({
      token: approvalToken,
      approvalContext,
    }),
    audit: createAuditHook(auditStore),
    summarizeOutput: (output) => JSON.stringify(output),
  });

  registerAdminActions(runner, users);

  const app = express();
  app.use(express.json());

  app.use('/agent-runner', createExpressAdapter(runner, {
    getUserId: getOperatorUserId,
    getAllowedModes: (request) => (
      isMutateRequest(request) ? ['read', 'draft', 'dryRun', 'mutate'] : undefined
    ),
    getApprovalToken: (request) => request.header('x-approval-token'),
    getApprovalContext: (request) => {
      if (!isDisableUserActionRequest(request)) {
        return undefined;
      }

      const input = getBodyInput(request);
      if (!isDisableUserInput(input)) {
        return undefined;
      }

      return {
        resourceIds: [input.userId],
        dryRunHash: input.dryRunHash,
      };
    },
    getMetadata: (request) => ({
      requestPath: request.path,
      requestMethod: request.method,
    }),
  }));

  app.get('/users', (_request, response) => {
    response.json({
      users: cloneUsers(users),
    });
  });

  app.get('/audit', async (_request, response, next) => {
    try {
      response.json({
        audit: await auditStore.readAll(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.post('/approvals/disable-user', async (request, response, next) => {
    try {
      const parsedRequest = DisableUserApprovalRequestSchema.safeParse(request.body);
      if (!parsedRequest.success) {
        response.status(400).json({
          error: 'Invalid approval request.',
        });
        return;
      }

      const approval = await approvalStore.createDisableUserApproval({
        operatorUserId: getOperatorUserId(request),
        targetUserId: parsedRequest.data.targetUserId,
        reason: parsedRequest.data.reason,
        dryRunHash: parsedRequest.data.dryRunHash,
      });

      response.json(approval);
    } catch (error) {
      next(error);
    }
  });

  return {
    app,
    runner,
    users,
    auditStore,
    approvalStore,
    dataDir,
  };
}

function getOperatorUserId(request: Request): string {
  return request.header('x-user-id') ?? 'operator_1';
}

function isMutateRequest(request: Request): boolean {
  return request.path === '/actions/admin.disableUser/execute'
    || request.path === '/workflows/execute';
}

function isDisableUserActionRequest(request: Request): boolean {
  return request.path === '/actions/admin.disableUser/execute';
}

function getBodyInput(request: Request): unknown {
  return isRecord(request.body) ? request.body.input : undefined;
}

function isDisableUserInput(value: unknown): value is {
  readonly userId: string;
  readonly reason: string;
  readonly dryRunHash: string;
} {
  return isRecord(value)
    && typeof value.userId === 'string'
    && typeof value.reason === 'string'
    && typeof value.dryRunHash === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
