import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AgentActionRunner } from '@agent-action-runner/core';
import { AGENT_RUNNER } from '@agent-action-runner/nestjs';
import type { PrismaClient } from '@prisma/client';
import {
  createExamplePrismaClient,
  initializeExampleDatabase,
  resetExampleData,
} from './prisma.js';
import { PrismaAdminOpsExampleModule } from './app.module.js';

export async function createPrismaAdminOpsExampleApp(options: {
  readonly databaseUrl?: string;
} = {}): Promise<{
  readonly app: INestApplication;
  readonly prisma: PrismaClient;
  readonly runner: AgentActionRunner;
}> {
  const prisma = createExamplePrismaClient(options.databaseUrl ?? createTempDatabaseUrl());
  await initializeExampleDatabase(prisma);
  await resetExampleData(prisma);

  const app = await NestFactory.create(
    PrismaAdminOpsExampleModule.forRoot(prisma),
    { logger: false },
  );
  await app.init();

  return {
    app,
    prisma,
    runner: app.get<AgentActionRunner>(AGENT_RUNNER),
  };
}

function createTempDatabaseUrl(): string {
  const dbPath = join(tmpdir(), `agent-action-runner-prisma-${randomUUID()}.db`).replace(/\\/g, '/');
  return `file:${dbPath}`;
}
