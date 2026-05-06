import Fastify from 'fastify';
import type { FastifyRequest } from 'fastify';
import { createRunner } from '@agent-action-runner/core';
import { agentRunnerFastifyPlugin } from '@agent-action-runner/fastify';
import {
  DisableUserApprovalRequestSchema,
  cloneUsers,
  createAuditTrail,
  createApprovalStore,
  createDisableUserApproval,
  createUserStore,
  registerAdminActions,
  toAuditEntry,
  verifyApprovalToken,
} from 'agent-action-runner-shared-admin-ops-example';

export async function createFastifyAdminOpsExampleApp() {
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

  const app = Fastify();

  await app.register(agentRunnerFastifyPlugin, {
    prefix: '/agent-runner',
    runner,
    getUserId: getOperatorUserId,
    getAllowedModes: (request) => (
      isMutateRequest(request) ? ['read', 'draft', 'dryRun', 'mutate'] : undefined
    ),
    getApprovalToken: (request) => getHeader(request, 'x-approval-token'),
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
      requestPath: getRequestPath(request),
      requestMethod: request.method,
    }),
  });

  app.get('/users', async () => ({
    users: cloneUsers(users),
  }));

  app.get('/audit', async () => ({
    audit: auditTrail,
  }));

  app.post('/approvals/disable-user', async (request, reply) => {
    const parsedRequest = DisableUserApprovalRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      return reply.status(400).send({
        error: 'Invalid approval request.',
      });
    }

    return createDisableUserApproval({
      operatorUserId: getOperatorUserId(request),
      targetUserId: parsedRequest.data.targetUserId,
      reason: parsedRequest.data.reason,
      dryRunHash: parsedRequest.data.dryRunHash,
      approvals,
    });
  });

  return {
    app,
    runner,
    users,
    approvals,
    auditTrail,
  };
}

function getOperatorUserId(request: FastifyRequest): string {
  return getHeader(request, 'x-user-id') ?? 'operator_1';
}

function getHeader(request: FastifyRequest, name: string): string | undefined {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value?.toString();
}

function isMutateRequest(request: FastifyRequest): boolean {
  const path = getRequestPath(request);
  return path.endsWith('/actions/admin.disableUser/execute')
    || path.endsWith('/workflows/execute');
}

function isDisableUserActionRequest(request: FastifyRequest): boolean {
  return getRequestPath(request).endsWith('/actions/admin.disableUser/execute');
}

function getRequestPath(request: FastifyRequest): string {
  return new URL(request.url, 'http://localhost').pathname;
}

function getBodyInput(request: FastifyRequest): unknown {
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
