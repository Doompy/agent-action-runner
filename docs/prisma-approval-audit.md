# Prisma Approval And Audit Pattern

This is a v0.7.0 direction note, not a public package contract.

Agent Action Runner should keep production persistence in the application boundary. A Prisma integration should show how to combine approval consumption, mutation side effects, idempotency, and audit append without turning the runner into a database framework.

## Goals

- Store approval records without raw approval tokens.
- Consume mutation approval once.
- Append audit events for every attempt.
- Record idempotency keys for retried mutations.
- Keep the business mutation inside the application transaction.

## Suggested Models

```prisma
model AgentApproval {
  id              String    @id
  tokenHash       String    @unique
  userId          String
  actionName      String
  inputHash       String
  resourceIdsJson Json?
  dryRunHash      String?
  expiresAt       DateTime
  consumedAt      DateTime?
  createdAt       DateTime  @default(now())
}

model AgentAuditEvent {
  id                String   @id
  executionId       String
  workflowId        String?
  stepId            String?
  userId            String
  actionName        String
  mode              String
  status            String
  attempt           Int?
  maxAttempts       Int?
  inputJson         Json?
  outputSummary     String?
  approvalId        String?
  approvalTokenHash String?
  errorJson         Json?
  createdAt         DateTime @default(now())
}

model AgentIdempotencyKey {
  key         String   @id
  actionName String
  resourceId String?
  status     String
  resultJson  Json?
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt
}
```

## Mutation Transaction Shape

```ts
await prisma.$transaction(async (tx) => {
  const approval = await consumeApprovalOnce(tx, {
    tokenHash,
    userId: ctx.userId,
    actionName: ctx.actionName,
    inputHash: ctx.approvalContext.inputHash,
    resourceIds: ctx.approvalContext.resourceIds,
    dryRunHash: ctx.approvalContext.dryRunHash,
  });

  const idempotency = await reserveIdempotencyKey(tx, {
    key: `${ctx.actionName}:${ctx.approvalContext.inputHash}`,
    actionName: ctx.actionName,
  });

  if (idempotency.status === 'succeeded') {
    return idempotency.resultJson;
  }

  const result = await performBusinessMutation(tx, input);

  await markIdempotencySucceeded(tx, idempotency.key, result);
  await appendAudit(tx, {
    ...auditContext,
    approvalId: approval.id,
  });

  return result;
});
```

## Notes

- Approval token signing, rotation, expiry policy, and operator review UI belong to the application.
- Raw approval tokens should never be written to audit logs or approval records.
- Audit `approvalTokenHash` is a correlation fingerprint. Approval records should use a secret-backed HMAC or sufficiently random token hash for verification.
- A timed-out action attempt may keep running. Retried mutations need idempotency and transactional state checks.
- A future package such as `@agent-action-runner/prisma` should only provide small helpers after this pattern is proven in real applications.
