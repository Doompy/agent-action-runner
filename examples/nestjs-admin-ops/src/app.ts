import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import type { AgentActionRunner } from '@agent-action-runner/core';
import { AGENT_RUNNER } from '@agent-action-runner/nestjs';
import {
  NestAdminOpsExampleModule,
  createNestAdminOpsExampleState,
} from './app.module.js';

export async function createNestAdminOpsExampleApp(): Promise<{
  readonly app: INestApplication;
  readonly runner: AgentActionRunner;
  readonly state: ReturnType<typeof createNestAdminOpsExampleState>;
}> {
  const state = createNestAdminOpsExampleState();
  const app = await NestFactory.create(
    NestAdminOpsExampleModule.forRoot(state),
    { logger: false },
  );

  await app.init();

  return {
    app,
    runner: app.get<AgentActionRunner>(AGENT_RUNNER),
    state,
  };
}
