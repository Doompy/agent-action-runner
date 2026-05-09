# Prisma Approval And Audit Pattern

This is production guidance, not a public package contract.

Agent Action Runner should keep persistence inside the application boundary. The runner passes `approvalContext`, audit events, retry attempts, and `idempotencyKey`; your service layer decides how to consume approvals, claim idempotency keys, perform mutations, and append durable records in one transaction.

## Goals

- Store approval records without raw approval tokens.
- Consume mutation approval exactly once.
- Reserve idempotency keys before side effects.
- Replay successful idempotent results when appropriate.
- Record in-progress, succeeded, and failed attempts.
- Append audit records without storing raw approval tokens or raw idempotency keys.
- Keep the business mutation inside the application transaction.

## Suggested Models

```prisma
model AgentApproval {
  id                String    @id @default(cuid())
  tokenHash         String    @unique
  userId            String
  actionName        String
  inputHash         String
  resourceIdsJson   Json?
  dryRunHash        String?
  expiresAt         DateTime
  consumedAt        DateTime?
  consumedByExecId  String?
  createdAt         DateTime  @default(now())

  @@index([userId, actionName])
  @@index([expiresAt])
}

model AgentAuditEvent {
  id                 String   @id @default(cuid())
  executionId        String
  workflowId         String?
  stepId             String?
  userId             String
  actionName         String
  mode               String
  status             String
  attempt            Int?
  maxAttempts        Int?
  inputJson          Json?
  outputSummary      String?
  approvalId         String?
  approvalTokenHash  String?
  idempotencyKeyHash String?
  errorJson          Json?
  createdAt          DateTime @default(now())

  @@index([executionId])
  @@index([actionName, status])
}

model AgentIdempotencyKey {
  key          String   @id
  actionName   String
  userId       String
  executionId  String?
  status       String
  resultJson   Json?
  errorJson    Json?
  createdAt    DateTime @default(now())
  updatedAt    DateTime @updatedAt
  completedAt  DateTime?

  @@index([actionName, userId])
}
```

Recommended `AgentIdempotencyKey.status` values:

```txt
in_progress
succeeded
failed
```

## Approval Single-Use Consume

Approval verification should compare the persisted approval record with the current `ApprovalContext`. Consume inside the same transaction as the mutation.

```ts
async function consumeApprovalOnce(tx, input: {
  tokenHash: string;
  executionId: string;
  userId: string;
  actionName: string;
  inputHash: string;
  resourceIds?: readonly string[];
  dryRunHash?: string;
}) {
  const approval = await tx.agentApproval.findUnique({
    where: { tokenHash: input.tokenHash },
  });

  if (!approval) {
    throw new Error('Approval not found.');
  }
  if (approval.consumedAt) {
    throw new Error('Approval was already consumed.');
  }
  if (approval.expiresAt.getTime() <= Date.now()) {
    throw new Error('Approval expired.');
  }
  if (
    approval.userId !== input.userId
    || approval.actionName !== input.actionName
    || approval.inputHash !== input.inputHash
    || approval.dryRunHash !== input.dryRunHash
    || JSON.stringify(approval.resourceIdsJson ?? []) !== JSON.stringify(input.resourceIds ?? [])
  ) {
    throw new Error('Approval context mismatch.');
  }

  return tx.agentApproval.update({
    where: { tokenHash: input.tokenHash },
    data: {
      consumedAt: new Date(),
      consumedByExecId: input.executionId,
    },
  });
}
```

Use a secret-backed HMAC or a sufficiently random token before hashing. Plain SHA-256 is useful as an audit fingerprint, but it is not a password hashing scheme and does not protect low-entropy tokens from guessing.

## Idempotency Reserve And Replay

Reserve the idempotency key before the mutation. If a previous call already succeeded, return the stored result. If another execution is in progress, reject or return a retryable conflict depending on your API.

```ts
async function reserveIdempotencyKey(tx, input: {
  key: string;
  actionName: string;
  userId: string;
  executionId: string;
}) {
  const existing = await tx.agentIdempotencyKey.findUnique({
    where: { key: input.key },
  });

  if (existing?.status === 'succeeded') {
    return { replay: true, result: existing.resultJson };
  }
  if (existing?.status === 'in_progress') {
    throw new Error('A matching operation is already in progress.');
  }
  if (existing) {
    return {
      replay: false,
      record: await tx.agentIdempotencyKey.update({
        where: { key: input.key },
        data: {
          status: 'in_progress',
          executionId: input.executionId,
          errorJson: undefined,
        },
      }),
    };
  }

  return {
    replay: false,
    record: await tx.agentIdempotencyKey.create({
      data: {
        key: input.key,
        actionName: input.actionName,
        userId: input.userId,
        executionId: input.executionId,
        status: 'in_progress',
      },
    }),
  };
}

async function markIdempotencySucceeded(tx, key: string, result: unknown) {
  return tx.agentIdempotencyKey.update({
    where: { key },
    data: {
      status: 'succeeded',
      resultJson: result,
      completedAt: new Date(),
    },
  });
}

async function markIdempotencyFailed(tx, key: string, error: unknown) {
  return tx.agentIdempotencyKey.update({
    where: { key },
    data: {
      status: 'failed',
      errorJson: serializeError(error),
      completedAt: new Date(),
    },
  });
}
```

The unique primary key on `AgentIdempotencyKey.key` is the race-condition boundary. In a highly concurrent system, catch unique constraint errors and re-read the existing record.

## Mutate Handler Transaction Shape

```ts
handler: async (input, ctx) => {
  ctx.requireApproval();
  if (!ctx.idempotencyKey) {
    throw new Error('idempotencyKey is required for delivery retry.');
  }

  return prisma.$transaction(async (tx) => {
    const tokenHash = hmacApprovalToken(ctx.approvalToken);
    const approval = await consumeApprovalOnce(tx, {
      tokenHash,
      executionId: ctx.executionId,
      userId: ctx.userId,
      actionName: ctx.actionName,
      inputHash: ctx.approvalContext.inputHash,
      resourceIds: ctx.approvalContext.resourceIds,
      dryRunHash: ctx.approvalContext.dryRunHash,
    });

    const idempotency = await reserveIdempotencyKey(tx, {
      key: ctx.idempotencyKey,
      actionName: ctx.actionName,
      userId: ctx.userId,
      executionId: ctx.executionId,
    });

    if (idempotency.replay) {
      return idempotency.result;
    }

    try {
      const result = await performBusinessMutation(tx, input);

      await markIdempotencySucceeded(tx, ctx.idempotencyKey, result);
      await appendAudit(tx, {
        executionId: ctx.executionId,
        userId: ctx.userId,
        actionName: ctx.actionName,
        approvalId: approval.id,
        status: 'succeeded',
      });

      return result;
    } catch (error) {
      await markIdempotencyFailed(tx, ctx.idempotencyKey, error);
      throw error;
    }
  });
}
```

## Timeout And Retry Race Conditions

`timeoutMs` is a runner-side failure boundary, not cancellation. A timed-out mutation may continue inside Node.js or inside an external system while the workflow starts the next attempt. For mutation retries:

- require an `idempotencyKey`
- reserve the key before the side effect
- consume approval in the same transaction
- make the business operation itself idempotent when it calls external systems
- replay successful results when the same key is seen again
- reject conflicting in-progress executions

## What The Library Does Not Own

- Prisma schema migrations
- approval token signing or rotation
- operator review UI
- transaction isolation choices
- idempotency key generation
- result replay policy
- external API idempotency headers

A future package such as `@agent-action-runner/prisma` should only provide small helpers after this pattern is proven in real applications.
