import { createRunner } from '@agent-action-runner/core';
import { registerDeliveryActions } from './actions.js';
import {
  createDeliveryJobStore,
  type DeliveryJob,
} from './data.js';

export function createDeliveryOpsRunner(): {
  readonly runner: ReturnType<typeof createRunner>;
  readonly jobs: DeliveryJob[];
} {
  const jobs = createDeliveryJobStore();
  const runner = createRunner();
  registerDeliveryActions(runner, jobs);

  return {
    runner,
    jobs,
  };
}

const deliveryOps = createDeliveryOpsRunner();

export const runner = deliveryOps.runner;
export const jobs = deliveryOps.jobs;

export default runner;
