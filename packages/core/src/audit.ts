import type { AuditHook, AuditStore } from './types.js';

export function createAuditHook(store: AuditStore): AuditHook {
  return (event) => store.write(event);
}
