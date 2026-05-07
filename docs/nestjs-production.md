# NestJS Production Guide

`@agent-action-runner/nestjs` is a first-party adapter for registering NestJS provider methods as agent actions.

## Provider Discovery

The adapter discovers decorated methods from provider instances available through NestJS `DiscoveryService` during module initialization.

This works best with singleton/static providers. Request-scoped provider auto-registration is not a supported discovery path because those providers do not have stable instances at module initialization.

Pass request-specific data through execution context and metadata instead of relying on request-scoped action providers.

## Recommended Shape

```ts
@Injectable()
export class DeliveryAgentActions {
  constructor(private readonly deliveryService: DeliveryService) {}

  @AgentAction({
    name: 'delivery.executeRetry',
    mode: 'mutate',
    approvalRequired: true,
    riskLevel: 'high',
    resourceType: 'deliveryJob',
    auditPolicy: {
      input: 'hash',
      output: 'summary',
      error: 'summary',
      redactPaths: ['/operatorNote'],
    },
    inputSchema: ExecuteRetryInputSchema,
    outputSchema: ExecuteRetryOutputSchema,
  })
  async executeRetry(input: ExecuteRetryInput, ctx: AgentExecutionContext) {
    ctx.requireApproval();
    return this.deliveryService.executeRetry(input, {
      operatorId: ctx.userId,
      requestId: ctx.metadata.requestId,
    });
  }
}
```

## HTTP Controllers

If you expose actions through Nest controllers, resolve execution context from your Nest auth/session layer:

- `userId`
- allowed modes
- approval token
- approval context
- metadata such as request id, tenant id, roles, or scopes

Do not trust the request body for those fields unless you are building a trusted internal endpoint.

## Transactions And Side Effects

The runner does not own your database transaction. For mutations, keep transaction and idempotency logic in your service or use-case layer.

Recommended mutation flow:

```txt
ctx.requireApproval()
  -> service/use-case transaction
  -> approval single-use consume
  -> idempotency claim
  -> business side effect
  -> domain audit append
```

## Audit

Use `auditDefaults` at the module root for production-safe defaults:

```ts
AgentRunnerModule.forRoot({
  auditDefaults: {
    input: 'hash',
    output: 'summary',
    error: 'summary',
    redactPaths: ['/password', '/token', '/secret'],
  },
  audit: createAuditHook(auditStore),
});
```

Action-level `auditPolicy` can tighten specific high-risk actions.
