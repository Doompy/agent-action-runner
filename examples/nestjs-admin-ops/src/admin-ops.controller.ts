import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AgentActionRunner, ActionMode } from '@agent-action-runner/core';
import { AGENT_RUNNER } from '@agent-action-runner/nestjs';
import {
  createActionListResponse,
  executeHttpAction,
  executeHttpWorkflow,
  mapAgentRunnerError,
  resolveAgentHttpRequestContext,
} from '@agent-action-runner/http';
import type { AgentHttpAdapterOptions } from '@agent-action-runner/http';
import {
  DisableUserApprovalRequestSchema,
  cloneUsers,
  createDisableUserApproval,
} from 'agent-action-runner-shared-admin-ops-example';
import type {
  AdminOpsAuditEntry,
  AdminUser,
  StoredApproval,
} from 'agent-action-runner-shared-admin-ops-example';
import {
  ADMIN_APPROVALS,
  ADMIN_AUDIT_TRAIL,
  ADMIN_USERS,
} from './tokens.js';

@Controller()
export class AdminOpsController {
  constructor(
    @Inject(AGENT_RUNNER)
    private readonly runner: AgentActionRunner,
    @Inject(ADMIN_USERS)
    private readonly users: AdminUser[],
    @Inject(ADMIN_APPROVALS)
    private readonly approvals: Map<string, StoredApproval>,
    @Inject(ADMIN_AUDIT_TRAIL)
    private readonly auditTrail: AdminOpsAuditEntry[],
  ) {}

  @Get('/agent-runner/actions')
  listActions() {
    return createActionListResponse(this.runner);
  }

  @Post('/agent-runner/actions/:name/execute')
  async executeAction(
    @Param('name') actionName: string,
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const context = await resolveAgentHttpRequestContext(
        request,
        createRequestContextOptions('action', actionName),
      );
      const result = await executeHttpAction(this.runner, actionName, body, context);
      response.status(200).json(result);
    } catch (error) {
      sendMappedError(response, error);
    }
  }

  @Post('/agent-runner/workflows/execute')
  async executeWorkflow(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    try {
      const context = await resolveAgentHttpRequestContext(
        request,
        createRequestContextOptions('workflow'),
      );
      const result = await executeHttpWorkflow(this.runner, body, context);
      response.status(200).json(result);
    } catch (error) {
      sendMappedError(response, error);
    }
  }

  @Post('/approvals/disable-user')
  createApproval(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): void {
    const parsedRequest = DisableUserApprovalRequestSchema.safeParse(body);
    if (!parsedRequest.success) {
      response.status(400).json({
        error: 'Invalid approval request.',
      });
      return;
    }

    response.status(200).json(createDisableUserApproval({
      operatorUserId: getOperatorUserId(request),
      targetUserId: parsedRequest.data.targetUserId,
      reason: parsedRequest.data.reason,
      dryRunHash: parsedRequest.data.dryRunHash,
      approvals: this.approvals,
    }));
  }

  @Get('/audit')
  listAudit() {
    return {
      audit: this.auditTrail,
    };
  }

  @Get('/users')
  listUsers() {
    return {
      users: cloneUsers(this.users),
    };
  }
}

function createRequestContextOptions(
  kind: 'action' | 'workflow',
  actionName?: string,
): AgentHttpAdapterOptions<Request> {
  return {
    getUserId: getOperatorUserId,
    getAllowedModes: () => (
      kind === 'workflow' || actionName === 'admin.disableUser'
        ? (['read', 'draft', 'dryRun', 'mutate'] satisfies ActionMode[])
        : undefined
    ),
    getApprovalToken: (request) => request.header('x-approval-token'),
    getApprovalContext: (request) => {
      if (actionName !== 'admin.disableUser') {
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
  };
}

function getOperatorUserId(request: Request): string {
  return request.header('x-user-id') ?? 'operator_1';
}

function sendMappedError(response: Response, error: unknown): void {
  const mapped = mapAgentRunnerError(error);
  response.status(mapped.statusCode).json(mapped.response);
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
