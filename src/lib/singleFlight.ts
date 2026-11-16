// Coalesce concurrent identical work: while a task for `key` is running, other
// callers get the same promise instead of starting a duplicate (e.g. 30
// students opening the same not-yet-generated format at once -> one AI call,
// one deck for everyone). Kept on globalThis so every route in the server
// process shares it.

const g = globalThis as unknown as { __ditoInflight?: Map<string, Promise<unknown>> };
const inflight: Map<string, Promise<unknown>> = (g.__ditoInflight ??= new Map());

export function singleFlight<T>(key: string, task: () => Promise<T>): Promise<T> {
  const running = inflight.get(key) as Promise<T> | undefined;
  if (running) return running;
  const p = (async () => task())().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export const inflightCount = () => inflight.size;
