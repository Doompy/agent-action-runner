import type { AgentActionRunner } from '@agent-action-runner/core';
import { z } from 'zod';
import type { AdminUser } from './data.js';
import { createStableHash } from './hash.js';

const SearchUsersInputSchema = z.object({
  query: z.string().optional(),
  status: z.enum(['active', 'disabled']).optional(),
});

const DisableUserInputSchema = z.object({
  userId: z.string(),
  reason: z.string().min(1),
  dryRunHash: z.string(),
});

const DryRunDisableUserInputSchema = DisableUserInputSchema.omit({
  dryRunHash: true,
});

export function registerAdminActions(
  runner: AgentActionRunner,
  users: AdminUser[],
): void {
  runner.registerAction({
    name: 'admin.searchUsers',
    mode: 'read',
    description: 'Search admin users by query and status.',
    inputSchema: SearchUsersInputSchema,
    outputSchema: z.object({
      users: z.array(z.object({
        id: z.string(),
        email: z.string(),
        name: z.string(),
        status: z.enum(['active', 'disabled']),
        activeSessions: z.number(),
      })),
    }),
    handler: (input) => {
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
    },
  });

  runner.registerAction({
    name: 'admin.dryRunDisableUser',
    mode: 'dryRun',
    description: 'Preview the impact of disabling a user.',
    inputSchema: DryRunDisableUserInputSchema,
    outputSchema: z.object({
      userId: z.string(),
      resourceIds: z.array(z.string()),
      dryRunHash: z.string(),
      wouldDisable: z.boolean(),
      affectedSessions: z.number(),
      warnings: z.array(z.string()),
    }),
    handler: (input) => {
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
    },
  });

  runner.registerAction({
    name: 'admin.disableUser',
    mode: 'mutate',
    description: 'Disable a user after approval.',
    inputSchema: DisableUserInputSchema,
    outputSchema: z.object({
      userId: z.string(),
      status: z.enum(['disabled']),
      reason: z.string(),
    }),
    handler: (input, context) => {
      context.requireApproval();

      const user = findUser(users, input.userId);
      user.status = 'disabled';

      return {
        userId: user.id,
        status: user.status,
        reason: input.reason,
      };
    },
  });
}

function findUser(users: readonly AdminUser[], userId: string): AdminUser {
  const user = users.find((candidate) => candidate.id === userId);
  if (!user) {
    throw new Error(`User "${userId}" was not found.`);
  }

  return user;
}
