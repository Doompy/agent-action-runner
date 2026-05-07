import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createDeliveryOpsExampleApp } from './app.js';

describe('delivery ops example', () => {
  it('runs failed job search, dry-run, approval, retry mutation, and audit flow', async () => {
    const { app } = createDeliveryOpsExampleApp();

    const searchResponse = await request(app)
      .post('/agent-runner/actions/delivery.searchJobs/execute')
      .set('x-user-id', 'operator_1')
      .send({
        input: {
          status: ['FAILED', 'DLQ'],
          campaignId: 'campaign_spring',
        },
      })
      .expect(200);

    expect(searchResponse.body.result.output.jobIds).toEqual(['job_1', 'job_2', 'job_3']);

    const dryRunResponse = await request(app)
      .post('/agent-runner/actions/delivery.dryRunRetry/execute')
      .set('x-user-id', 'operator_1')
      .send({
        input: {
          jobIds: searchResponse.body.result.output.jobIds,
          reason: 'Recover transient CMS failures.',
        },
      })
      .expect(200);

    const dryRun = dryRunResponse.body.result.output;
    expect(dryRun.resourceIds).toEqual(['job_1', 'job_2', 'job_3']);
    expect(dryRun.retryableJobIds).toEqual(['job_1']);
    expect(dryRun.blockedJobIds).toEqual(['job_2', 'job_3']);
    expect(typeof dryRun.dryRunHash).toBe('string');

    await request(app)
      .post('/agent-runner/actions/delivery.executeRetry/execute')
      .set('x-user-id', 'operator_1')
      .send({
        input: {
          jobIds: dryRun.resourceIds,
          reason: 'Recover transient CMS failures.',
          dryRunHash: dryRun.dryRunHash,
        },
      })
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe('APPROVAL_REQUIRED');
      });

    const approvalResponse = await request(app)
      .post('/approvals/retry-jobs')
      .set('x-user-id', 'operator_1')
      .send({
        jobIds: dryRun.resourceIds,
        reason: 'Recover transient CMS failures.',
        dryRunHash: dryRun.dryRunHash,
      })
      .expect(200);

    await request(app)
      .post('/agent-runner/actions/delivery.executeRetry/execute')
      .set('x-user-id', 'operator_1')
      .set('x-approval-token', approvalResponse.body.approvalToken)
      .send({
        input: {
          jobIds: ['job_1'],
          reason: 'Different resource set breaks approval binding.',
          dryRunHash: dryRun.dryRunHash,
        },
      })
      .expect(403)
      .expect(({ body }) => {
        expect(body.error.code).toBe('APPROVAL_REQUIRED');
      });

    const retryResponse = await request(app)
      .post('/agent-runner/actions/delivery.executeRetry/execute')
      .set('x-user-id', 'operator_1')
      .set('x-approval-token', approvalResponse.body.approvalToken)
      .send({
        input: approvalResponse.body.mutateInput,
      })
      .expect(200);

    expect(retryResponse.body.result.output).toEqual({
      retriedJobIds: ['job_1'],
      skippedJobIds: ['job_2', 'job_3'],
    });
    expect(retryResponse.body.result.approvalId).toBe(approvalResponse.body.approvalId);

    const jobsResponse = await request(app)
      .get('/jobs')
      .expect(200);
    const retriedJob = jobsResponse.body.jobs.find((job: { id: string }) => job.id === 'job_1');
    expect(retriedJob.status).toBe('RETRY_QUEUED');
    expect(retriedJob.attempts).toBe(2);

    const auditResponse = await request(app)
      .get('/audit')
      .expect(200);
    const statuses = auditResponse.body.audit.map((entry: { status: string }) => entry.status);
    expect(statuses).toContain('started');
    expect(statuses).toContain('succeeded');
    expect(statuses).toContain('failed');
  });
});
