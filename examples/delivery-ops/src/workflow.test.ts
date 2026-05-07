import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createDeliveryOpsRunner } from './agent-runner.js';

describe('delivery ops workflow examples', () => {
  it('executes the retry failed delivery workflow through the JSON runner', async () => {
    const workflow = JSON.parse(
      await readFile(join(process.cwd(), 'workflows/retry-failed-delivery.workflow.json'), 'utf8'),
    );
    const { runner } = createDeliveryOpsRunner();

    const result = await runner.executeWorkflow({
      userId: 'operator_1',
      workflow,
    });

    expect(result.workflowName).toBe('retry-failed-delivery-jobs');
    expect(result.outputByStep.jobs).toMatchObject({
      jobIds: ['job_1', 'job_2', 'job_3'],
    });
    expect(result.outputByStep.dryRun).toMatchObject({
      resourceIds: ['job_1', 'job_2', 'job_3'],
      retryableJobIds: ['job_1'],
      blockedJobIds: ['job_2', 'job_3'],
    });
  });
});
