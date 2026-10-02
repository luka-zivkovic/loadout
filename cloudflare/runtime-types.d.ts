interface SqlCursor {
  rowsWritten: number;
  toArray(): Record<string, unknown>[];
}
interface DurableObjectStorage {
  sql: { exec(query: string, ...bindings: unknown[]): SqlCursor };
  transactionSync<T>(callback: () => T): T;
}
interface DurableObjectState {
  id: { jurisdiction: string | null };
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
interface DurableObjectStub<T> {
  fetch(request: Request): Promise<Response>;
  issueSetupLink(): Promise<{ url: string; expiresAt: string }>;
}
interface DurableObjectNamespace<T> {
  jurisdiction(region: "eu"): DurableObjectNamespace<T>;
  getByName(name: string): DurableObjectStub<T>;
}
interface Fetcher {
  fetch(request: Request): Promise<Response>;
}
declare module "cloudflare:workers" {
  export class DurableObject<Env> {
    constructor(ctx: DurableObjectState, env: Env);
    protected readonly env: Env;
  }
}
declare module "cloudflare:node" {
  export function handleAsNodeRequest(port: number, request: Request): Promise<Response>;
}
