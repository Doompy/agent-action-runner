import express from 'express';
import type { Request } from 'express';
import { createRunner } from '@agent-action-runner/core';
import { createExpressAdapter } from '@agent-action-runner/express';
import {
  RetryJobsApprovalRequestSchema,
  registerDeliveryActions,
} from './actions.js';
import {
  createApprovalStore,
  createRetryJobsApproval,
  verifyApprovalToken,
} from './approval.js';
import { createAuditTrail, toAuditEntry } from './audit.js';
import { cloneDeliveryJobs, createDeliveryJobStore } from './data.js';

export function createDeliveryOpsExampleApp() {
  const jobs = createDeliveryJobStore();
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

  registerDeliveryActions(runner, jobs);

  const app = express();
  app.use(express.json());

  app.use('/agent-runner', createExpressAdapter(runner, {
    getUserId: getOperatorUserId,
    getAllowedModes: (request) => (
      isMutateRequest(request) ? ['read', 'draft', 'dryRun', 'mutate'] : undefined
    ),
    getApprovalToken: (request) => request.header('x-approval-token'),
    getApprovalContext: (request) => {
      if (!isExecuteRetryActionRequest(request)) {
        return undefined;
      }

      const input = getBodyInput(request);
      if (!isExecuteRetryInput(input)) {
        return undefined;
      }

      return {
        resourceIds: input.jobIds,
        dryRunHash: input.dryRunHash,
      };
    },
    getMetadata: (request) => ({
      requestPath: request.path,
      requestMethod: request.method,
    }),
  }));

  app.get('/jobs', (_request, response) => {
    response.json({
      jobs: cloneDeliveryJobs(jobs),
    });
  });

  app.get('/audit', (_request, response) => {
    response.json({
      audit: auditTrail,
    });
  });

  app.post('/approvals/retry-jobs', (request, response) => {
    const parsedRequest = RetryJobsApprovalRequestSchema.safeParse(request.body);
    if (!parsedRequest.success) {
      response.status(400).json({
        error: 'Invalid approval request.',
      });
      return;
    }

    const approval = createRetryJobsApproval({
      operatorUserId: getOperatorUserId(request),
      jobIds: parsedRequest.data.jobIds,
      reason: parsedRequest.data.reason,
      dryRunHash: parsedRequest.data.dryRunHash,
      approvals,
    });

    response.json(approval);
  });

  return {
    app,
    runner,
    jobs,
    approvals,
    auditTrail,
  };
}

function getOperatorUserId(request: Request): string {
  return request.header('x-user-id') ?? 'operator_1';
}

function isMutateRequest(request: Request): boolean {
  return request.path === '/actions/delivery.executeRetry/execute'
    || request.path === '/workflows/execute';
}

function isExecuteRetryActionRequest(request: Request): boolean {
  return request.path === '/actions/delivery.executeRetry/execute';
}

function getBodyInput(request: Request): unknown {
  return isRecord(request.body) ? request.body.input : undefined;
}

function isExecuteRetryInput(value: unknown): value is {
  readonly jobIds: readonly string[];
  readonly reason: string;
  readonly dryRunHash: string;
} {
  return isRecord(value)
    && Array.isArray(value.jobIds)
    && value.jobIds.every((jobId) => typeof jobId === 'string')
    && typeof value.reason === 'string'
    && typeof value.dryRunHash === 'string';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
