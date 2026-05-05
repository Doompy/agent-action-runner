import express from 'express';
import type { Request } from 'express';
import { createRunner } from '@agent-action-runner/core';
import { createExpressAdapter } from '@agent-action-runner/express';
import { z } from 'zod';
import { registerAdminActions } from './actions.js';
import { createAuditTrail, toAuditEntry } from './audit.js';
import {
  createApprovalStore,
  createDisableUserApproval,
  verifyApprovalToken,
} from './approval.js';
import { cloneUsers, createUserStore } from './data.js';

const DisableUserApprovalRequestSchema = z.object({
  targetUserId: z.string(),
  reason: z.string().min(1),
  dryRunHash: z.string(),
});

export function createAdminOpsExampleApp() {
  const users = createUserStore();
  const auditTrail = createAuditTrail();
  const approvals = createApprovalStore();

  const runner = createRunner({
    approval: ({ approvalToken, approvalContext }) => verifyApprovalToken({
      token: approvalToken,
      approvalContext,
      approvals,
    }),
    audit: (event) => {
      auditTrail.push(toAuditEntry(event));
    },
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

  app.get('/audit', (_request, response) => {
    response.json({
      audit: auditTrail,
    });
  });

  app.post('/approvals/disable-user', (request, response) => {
    const parsedRequest = DisableUserApprovalRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      response.status(400).json({
        error: 'Invalid approval request.',
      });
      return;
    }

    const approval = createDisableUserApproval({
      operatorUserId: getOperatorUserId(request),
      targetUserId: parsedRequest.data.targetUserId,
      reason: parsedRequest.data.reason,
      dryRunHash: parsedRequest.data.dryRunHash,
      approvals,
    });

    response.json(approval);
  });

  return {
    app,
    runner,
    users,
    approvals,
    auditTrail,
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
