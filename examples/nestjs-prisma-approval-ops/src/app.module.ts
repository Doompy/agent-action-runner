import { DynamicModule, Module } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import { AgentRunnerModule } from '@agent-action-runner/nestjs';
import { appendAuditEvent } from './audit.js';
import { PrismaAdminOpsAgentActions } from './admin-actions.provider.js';
import { PrismaAdminOpsController } from './prisma-admin-ops.controller.js';
import { verifyApprovalToken } from './approval.js';
import { PRISMA } from './tokens.js';

@Module({})
export class PrismaAdminOpsExampleModule {
  static forRoot(prisma: PrismaClient): DynamicModule {
    return {
      module: PrismaAdminOpsExampleModule,
      imports: [
        AgentRunnerModule.forRoot({
          auditDefaults: {
            input: 'hash',
            output: 'summary',
            error: 'summary',
            redactPaths: ['/reason'],
          },
          approval: (input) => verifyApprovalToken({
            prisma,
            approvalToken: input.approvalToken,
            approvalContext: input.approvalContext,
            executionContext: input.context,
          }),
          audit: (event) => appendAuditEvent(prisma, event),
        }),
      ],
      controllers: [PrismaAdminOpsController],
      providers: [
        PrismaAdminOpsAgentActions,
        {
          provide: PRISMA,
          useValue: prisma,
        },
      ],
      exports: [PRISMA],
    };
  }
}
