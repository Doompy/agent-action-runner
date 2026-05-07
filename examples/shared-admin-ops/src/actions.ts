import type {
  AgentActionRunner,
  AgentExecutionContext,
} from '@agent-action-runner/core';
import { createStableHash } from '@agent-action-runner/core';
import { z } from 'zod';
import type { AdminUser } from './data.js';

export const AdminUserSchema = z.object({
  id: z.string(),
  email: z.string(),
  name: z.string(),
  status: z.enum(['active', 'disabled']),
  activeSessions: z.number(),
});

export const SearchUsersInputSchema = z.object({
  query: z.string().optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

export const SearchUsersOutputSchema = z.object({
  users: z.array(AdminUserSchema),
});

export const DisableUserInputSchema = z.object({
  userId: z.string(),
  reason: z.string().min(1),
  dryRunHash: z.string(),
});

export const DisableUserOutputSchema = z.object({
  userId: z.string(),
  status: z.literal('disabled'),
  reason: z.string(),
});

export const DryRunDisableUserInputSchema = DisableUserInputSchema.omit({
  dryRunHash: true,
});

export const DryRunDisableUserOutputSchema = z.object({
  userId: z.string(),
  resourceIds: z.array(z.string()),
  dryRunHash: z.string(),
  wouldDisable: z.boolean(),
  affectedSessions: z.number(),
  warnings: z.array(z.string()),
});

export const DisableUserApprovalRequestSchema = z.object({
  targetUserId: z.string(),
  reason: z.string().min(1),
  dryRunHash: z.string(),
});

export type SearchUsersInput = z.infer<typeof SearchUsersInputSchema>;
export type SearchUsersOutput = z.infer<typeof SearchUsersOutputSchema>;
export type DryRunDisableUserInput = z.infer<typeof DryRunDisableUserInputSchema>;
export type DryRunDisableUserOutput = z.infer<typeof DryRunDisableUserOutputSchema>;
export type DisableUserInput = z.infer<typeof DisableUserInputSchema>;
export type DisableUserOutput = z.infer<typeof DisableUserOutputSchema>;
export type DisableUserApprovalRequest = z.infer<typeof DisableUserApprovalRequestSchema>;

export function registerAdminActions(
  runner: AgentActionRunner,
  users: AdminUser[],
): void {
  runner.registerAction({
    name: 'admin.searchUsers',
    mode: 'read',
    description: 'Search admin users by query and status.',
    inputSchema: SearchUsersInputSchema,
    outputSchema: SearchUsersOutputSchema,
    handler: (input) => searchAdminUsers(users, input),
  });

  runner.registerAction({
    name: 'admin.dryRunDisableUser',
    mode: 'dryRun',
    description: 'Preview the impact of disabling a user.',
    inputSchema: DryRunDisableUserInputSchema,
    outputSchema: DryRunDisableUserOutputSchema,
    handler: (input) => dryRunDisableUser(users, input),
  });

  runner.registerAction({
    name: 'admin.disableUser',
    mode: 'mutate',
    description: 'Disable a user after approval.',
    inputSchema: DisableUserInputSchema,
    outputSchema: DisableUserOutputSchema,
    handler: (input, context) => disableAdminUser(users, input, context),
  });
}

export function searchAdminUsers(
  users: readonly AdminUser[],
  input: SearchUsersInput,
): SearchUsersOutput {
  const query = input.query?.toLowerCase();

  return {
    users: users.filter((user) => {
      const matchesStatus = !input.status || user.status === input.status;
      const matchesQuery = !query
        || user.email.toLowerCase().includes(query)
        || user.name.toLowerCase().includes(query);
      return matchesStatus && matchesQuery;
    }),
  };
}

export function dryRunDisableUser(
  users: readonly AdminUser[],
  input: DryRunDisableUserInput,
): DryRunDisableUserOutput {
  const user = findUser(users, input.userId);
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

export function disableAdminUser(
  users: readonly AdminUser[],
  input: DisableUserInput,
  context: AgentExecutionContext,
): DisableUserOutput {
  context.requireApproval();

  const user = findUser(users, input.userId);
  user.status = 'disabled';

  return {
    userId: user.id,
    status: 'disabled',
    reason: input.reason,
  };
}

function findUser(users: readonly AdminUser[], userId: string): AdminUser {
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) {
    throw new Error(`User "${userId}" was not found.`);
  }

  return user;
}
