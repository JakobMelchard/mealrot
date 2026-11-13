// The slice of the Workers runtime this Worker uses, typed against the Request and Response
// the DOM lib declares; @cloudflare/workers-types declares its own, which the DOM ones do not satisfy.

/** `kv_namespaces` in wrangler.jsonc, text values only */
interface KVBinding {
  get(key: string): Promise<string | null>
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void
  passThroughOnException(): void
}
