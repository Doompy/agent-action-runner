import { createRunner } from '@agent-action-runner/core';
import { createMcpExporter } from '@agent-action-runner/mcp';
import {
  createAuditTrail,
  createUserStore,
  registerAdminActions,
  toAuditEntry,
} from 'agent-action-runner-shared-admin-ops-example';

export function createMcpAdminOpsExample() {
  const users = createUserStore();
  const auditTrail = createAuditTrail();
  const runner = createRunner({
    audit: (event) => {
      auditTrail.push(toAuditEntry(event));
    },
  });

  registerAdminActions(runner, users);

  const server = createMcpExporter(runner, {
    getUserId: () => process.env.AGENT_RUNNER_USER_ID ?? 'demo_admin',
  });

  return {
    auditTrail,
    runner,
    server,
    users,
  };
}
