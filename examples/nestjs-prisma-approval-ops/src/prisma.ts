import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const INITIAL_USERS = [
  {
    id: 'user_1',
    email: 'alex@example.com',
    name: 'Alex Morgan',
    status: 'active',
    activeSessions: 1,
  },
  {
    id: 'user_2',
    email: 'casey@example.com',
    name: 'Casey Kim',
    status: 'active',
    activeSessions: 3,
  },
  {
    id: 'user_3',
    email: 'disabled@example.com',
    name: 'Disabled User',
    status: 'disabled',
    activeSessions: 0,
  },
] as const;

export function createExamplePrismaClient(databaseUrl?: string): PrismaClient {
  return new PrismaClient({
    ...(databaseUrl
      ? {
        datasources: {
          db: {
            url: databaseUrl,
          },
        },
      }
      : {}),
  });
}

export async function initializeExampleDatabase(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AdminUser" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "email" TEXT NOT NULL,
      "name" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "activeSessions" INTEGER NOT NULL
    )
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AgentApproval" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "tokenHash" TEXT NOT NULL UNIQUE,
      "userId" TEXT NOT NULL,
      "actionName" TEXT NOT NULL,
      "inputHash" TEXT NOT NULL,
      "resourceIdsJson" TEXT,
      "dryRunHash" TEXT,
      "expiresAt" DATETIME NOT NULL,
      "consumedAt" DATETIME,
      "consumedByExecId" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AgentApproval_userId_actionName_idx" ON "AgentApproval" ("userId", "actionName")');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AgentApproval_expiresAt_idx" ON "AgentApproval" ("expiresAt")');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AgentAuditEvent" (
      "id" TEXT NOT NULL PRIMARY KEY,
      "executionId" TEXT NOT NULL,
      "workflowId" TEXT,
      "stepId" TEXT,
      "userId" TEXT NOT NULL,
      "actionName" TEXT NOT NULL,
      "mode" TEXT NOT NULL,
      "status" TEXT NOT NULL,
      "attempt" INTEGER,
      "maxAttempts" INTEGER,
      "inputJson" TEXT,
      "outputSummary" TEXT,
      "approvalId" TEXT,
      "approvalTokenHash" TEXT,
      "idempotencyKeyHash" TEXT,
      "errorJson" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AgentAuditEvent_executionId_idx" ON "AgentAuditEvent" ("executionId")');
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AgentAuditEvent_actionName_status_idx" ON "AgentAuditEvent" ("actionName", "status")');
  await prisma.$executeRawUnsafe(`
    CREATE TABLE IF NOT EXISTS "AgentIdempotencyKey" (
      "key" TEXT NOT NULL PRIMARY KEY,
      "actionName" TEXT NOT NULL,
      "userId" TEXT NOT NULL,
      "executionId" TEXT,
      "status" TEXT NOT NULL,
      "resultJson" TEXT,
      "errorJson" TEXT,
      "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "completedAt" DATETIME
    )
  `);
  await prisma.$executeRawUnsafe('CREATE INDEX IF NOT EXISTS "AgentIdempotencyKey_actionName_userId_idx" ON "AgentIdempotencyKey" ("actionName", "userId")');
}

export async function resetExampleData(prisma: PrismaClient): Promise<void> {
  await prisma.agentAuditEvent.deleteMany();
  await prisma.agentIdempotencyKey.deleteMany();
  await prisma.agentApproval.deleteMany();
  await prisma.adminUser.deleteMany();
  await prisma.adminUser.createMany({
    data: INITIAL_USERS.map((user) => ({ ...user })),
  });
}

export function createAuditId(): string {
  return randomUUID();
}
