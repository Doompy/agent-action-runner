import { Inject, Injectable } from '@nestjs/common';
import type { AgentExecutionContext } from '@agent-action-runner/core';
import { AgentAction } from '@agent-action-runner/nestjs';
import {
  DisableUserInputSchema,
  DisableUserOutputSchema,
  DryRunDisableUserInputSchema,
  DryRunDisableUserOutputSchema,
  SearchUsersInputSchema,
  SearchUsersOutputSchema,
  disableAdminUser,
  dryRunDisableUser,
  searchAdminUsers,
} from 'agent-action-runner-shared-admin-ops-example';
import type {
  AdminUser,
  DisableUserInput,
  DryRunDisableUserInput,
  SearchUsersInput,
} from 'agent-action-runner-shared-admin-ops-example';
import { ADMIN_USERS } from './tokens.js';

@Injectable()
export class AdminOpsAgentActions {
  constructor(
    @Inject(ADMIN_USERS)
    private readonly users: AdminUser[],
  ) {}

  @AgentAction({
    name: 'admin.searchUsers',
    mode: 'read',
    description: 'Search admin users by query and status.',
    tags: ['admin', 'users'],
    resourceType: 'adminUser',
    riskLevel: 'low',
    examples: [
      {
        title: 'Search active users',
        input: { status: 'active' },
      },
    ],
    inputSchema: SearchUsersInputSchema,
    outputSchema: SearchUsersOutputSchema,
  })
  searchUsers(input: SearchUsersInput) {
    return searchAdminUsers(this.users, input);
  }

  @AgentAction({
    name: 'admin.dryRunDisableUser',
    mode: 'dryRun',
    description: 'Preview the impact of disabling a user.',
    tags: ['admin', 'users', 'approval'],
    resourceType: 'adminUser',
    riskLevel: 'medium',
    inputSchema: DryRunDisableUserInputSchema,
    outputSchema: DryRunDisableUserOutputSchema,
  })
  dryRunDisableUser(input: DryRunDisableUserInput) {
    return dryRunDisableUser(this.users, input);
  }

  @AgentAction({
    name: 'admin.disableUser',
    mode: 'mutate',
    description: 'Disable a user after approval.',
    tags: ['admin', 'users'],
    resourceType: 'adminUser',
    riskLevel: 'high',
    approvalRequired: true,
    inputSchema: DisableUserInputSchema,
    outputSchema: DisableUserOutputSchema,
  })
  disableUser(input: DisableUserInput, context: AgentExecutionContext) {
    return disableAdminUser(this.users, input, context);
  }
}
