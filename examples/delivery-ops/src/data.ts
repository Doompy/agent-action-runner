export type DeliveryJobStatus = 'PENDING' | 'FAILED' | 'DLQ' | 'RETRY_QUEUED' | 'COMPLETED';

export type DeliveryJob = {
  readonly id: string;
  readonly campaignId: string;
  readonly mediaId: string;
  readonly status: DeliveryJobStatus;
  readonly failureCode?: string;
  readonly attempts: number;
  readonly maxAttempts: number;
  readonly createdAt: string;
};

const INITIAL_JOBS: readonly DeliveryJob[] = [
  {
    id: 'job_1',
    campaignId: 'campaign_spring',
    mediaId: 'media_screen_1',
    status: 'FAILED',
    failureCode: 'CMS_TIMEOUT',
    attempts: 1,
    maxAttempts: 3,
    createdAt: '2026-05-07T00:10:00.000Z',
  },
  {
    id: 'job_2',
    campaignId: 'campaign_spring',
    mediaId: 'media_screen_2',
    status: 'FAILED',
    failureCode: 'VALIDATION_ERROR',
    attempts: 1,
    maxAttempts: 3,
    createdAt: '2026-05-07T00:12:00.000Z',
  },
  {
    id: 'job_3',
    campaignId: 'campaign_spring',
    mediaId: 'media_screen_3',
    status: 'DLQ',
    failureCode: 'CMS_TIMEOUT',
    attempts: 3,
    maxAttempts: 3,
    createdAt: '2026-05-07T00:14:00.000Z',
  },
  {
    id: 'job_4',
    campaignId: 'campaign_fall',
    mediaId: 'media_screen_4',
    status: 'COMPLETED',
    attempts: 1,
    maxAttempts: 3,
    createdAt: '2026-05-07T00:16:00.000Z',
  },
];

export function createDeliveryJobStore(): DeliveryJob[] {
  return INITIAL_JOBS.map((job) => ({ ...job }));
}

export function cloneDeliveryJobs(jobs: readonly DeliveryJob[]): DeliveryJob[] {
  return jobs.map((job) => ({ ...job }));
}
