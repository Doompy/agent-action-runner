import { DynamicModule, Module } from '@nestjs/common';
import { AgentRunnerModule } from '@agent-action-runner/nestjs';
import {
  createAuditTrail,
  createApprovalStore,
  createUserStore,
  toAuditEntry,
  verifyApprovalToken,
} from 'agent-action-runner-shared-admin-ops-example';
import type {
  AdminOpsAuditEntry,
  AdminUser,
  StoredApproval,
} from 'agent-action-runner-shared-admin-ops-example';
import { AdminOpsAgentActions } from './admin-actions.provider.js';
import { AdminOpsController } from './admin-ops.controller.js';
import {
  ADMIN_APPROVALS,
  ADMIN_AUDIT_TRAIL,
  ADMIN_USERS,
} from './tokens.js';

export type NestAdminOpsExampleState = {
  readonly users: AdminUser[];
  readonly approvals: Map<string, StoredApproval>;
  readonly auditTrail: AdminOpsAuditEntry[];
};

export function createNestAdminOpsExampleState(): NestAdminOpsExampleState {
  return {
    users: createUserStore(),
    approvals: createApprovalStore(),
    auditTrail: createAuditTrail(),
  };
}

@Module({})
export class NestAdminOpsExampleModule {
  static forRoot(
    state: NestAdminOpsExampleState = createNestAdminOpsExampleState(),
  ): DynamicModule {
    return {
      module: NestAdminOpsExampleModule,
      imports: [
        AgentRunnerModule.forRoot({
          approval: ({ approvalToken, approvalContext }) => verifyApprovalToken({
            token: approvalToken,
            approvalContext,
            approvals: state.approvals,
          }),
          audit: (event) => {
            state.auditTrail.push(toAuditEntry(event));
          },
        }),
      ],
      controllers: [AdminOpsController],
      providers: [
        AdminOpsAgentActions,
        {
          provide: ADMIN_USERS,
          useValue: state.users,
        },
        {
          provide: ADMIN_APPROVALS,
          useValue: state.approvals,
        },
        {
          provide: ADMIN_AUDIT_TRAIL,
          useValue: state.auditTrail,
        },
      ],
    };
  }
}
