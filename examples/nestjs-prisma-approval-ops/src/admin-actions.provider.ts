import { Inject, Injectable } from '@nestjs/common';
import type { AgentExecutionContext } from '@agent-action-runner/core';
import { createStableHash } from '@agent-action-runner/core';
import { AgentAction } from '@agent-action-runner/nestjs';
import type { PrismaClient } from '@prisma/client';
import {
  DisableUserInputSchema,
  DisableUserOutputSchema,
  DryRunDisableUserInputSchema,
  DryRunDisableUserOutputSchema,
  SearchUsersInputSchema,
  SearchUsersOutputSchema,
} from 'agent-action-runner-shared-admin-ops-example';
import type {
  DisableUserInput,
  DisableUserOutput,
  DryRunDisableUserInput,
  DryRunDisableUserOutput,
  SearchUsersInput,
  SearchUsersOutput,
} from 'agent-action-runner-shared-admin-ops-example';
import { consumeApprovalOnce } from './approval.js';
import { reserveIdempotencyKey, markIdempotencySucceeded } from './idempotency.js';
import { PRISMA } from './tokens.js';

@Injectable()
export class PrismaAdminOpsAgentActions {
  constructor(
    @Inject(PRISMA)
    private readonly prisma: PrismaClient,
  ) {}

  @AgentAction({
    name: 'admin.searchUsers',
    mode: 'read',
    description: 'Search admin users by query and status from Prisma.',
    tags: ['admin', 'users', 'prisma'],
    resourceType: 'adminUser',
    riskLevel: 'low',
    inputSchema: SearchUsersInputSchema,
    outputSchema: SearchUsersOutputSchema,
  })
  async searchUsers(input: SearchUsersInput): Promise<SearchUsersOutput> {
    const query = input.query?.toLowerCase();
    const users = await this.prisma.adminUser.findMany({
      where: {
        ...(input.status ? { status: input.status } : {}),
      },
      orderBy: { id: 'asc' },
    });

    return {
      users: users
        .filter((user) => !query
          || user.email.toLowerCase().includes(query)
          || user.name.toLowerCase().includes(query))
        .map((user) => ({
          id: user.id,
          email: user.email,
          name: user.name,
          status: user.status as 'active' | 'disabled',
          activeSessions: user.activeSessions,
        })),
    };
  }

  @AgentAction({
    name: 'admin.dryRunDisableUser',
    mode: 'dryRun',
    description: 'Preview disabling a Prisma-backed admin user.',
    tags: ['admin', 'users', 'approval', 'prisma'],
    resourceType: 'adminUser',
    riskLevel: 'medium',
    inputSchema: DryRunDisableUserInputSchema,
    outputSchema: DryRunDisableUserOutputSchema,
  })
  async dryRunDisableUser(input: DryRunDisableUserInput): Promise<DryRunDisableUserOutput> {
    const user = await this.findUser(input.userId);
    const wouldDisable = user.status !== 'disabled';
    const result = {
      userId: user.id,
      resourceIds: [user.id],
      wouldDisable,
      affectedSessions: user.activeSessions,
      warnings: wouldDisable ? [] : ['User is already disabled.'],
    };

    return {
      ...result,
      dryRunHash: createStableHash({
        actionName: 'admin.dryRunDisableUser',
        input,
        result,
      }),
    };
  }

  @AgentAction({
    name: 'admin.disableUser',
    mode: 'mutate',
    description: 'Disable a Prisma-backed admin user after approval.',
    tags: ['admin', 'users', 'approval', 'prisma'],
    resourceType: 'adminUser',
    riskLevel: 'high',
    approvalRequired: true,
    auditPolicy: {
      input: 'hash',
      output: 'summary',
      error: 'summary',
      redactPaths: ['/reason'],
    },
    inputSchema: DisableUserInputSchema,
    outputSchema: DisableUserOutputSchema,
  })
  async disableUser(
    input: DisableUserInput,
    context: AgentExecutionContext,
  ): Promise<DisableUserOutput> {
    context.requireApproval();
    if (!context.approvalToken) {
      throw new Error('approvalToken is required.');
    }
    if (!context.idempotencyKey) {
      throw new Error('idempotencyKey is required.');
    }

    return this.prisma.$transaction(async (tx) => {
      const idempotency = await reserveIdempotencyKey({
        tx,
        key: context.idempotencyKey as string,
        actionName: context.actionName,
        userId: context.userId,
        executionId: context.executionId,
      });
      if (idempotency.replay) {
        return DisableUserOutputSchema.parse(idempotency.result);
      }

      await consumeApprovalOnce({
        tx,
        approvalToken: context.approvalToken as string,
        approvalContext: context.approvalContext,
        executionId: context.executionId,
      });

      const user = await tx.adminUser.update({
        where: { id: input.userId },
        data: { status: 'disabled' },
      });
      const result = {
        userId: user.id,
        status: 'disabled' as const,
        reason: input.reason,
      };

      await markIdempotencySucceeded({
        tx,
        key: context.idempotencyKey as string,
        result,
      });

      return result;
    });
  }

  private async findUser(userId: string) {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
    });
    if (!user) {
      throw new Error(`User "${userId}" was not found.`);
    }
    return user;
  }
}
