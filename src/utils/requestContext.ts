import { AsyncLocalStorage } from 'async_hooks';

// Lets utils/logger.ts attach the current request's ID to every log line
// (including ones written from deep inside a service call, not just the
// route handler) without threading requestId through every function
// signature or rewriting call sites to use a per-request child logger.
interface RequestContext {
  requestId: string;
}

const requestContextStorage = new AsyncLocalStorage<RequestContext>();

export function runWithRequestContext<T>(context: RequestContext, fn: () => T): T {
  return requestContextStorage.run(context, fn);
}

export function getRequestId(): string | undefined {
  return requestContextStorage.getStore()?.requestId;
}
