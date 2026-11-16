// Framework-free "save the latest snapshot" queue used for flashcard progress.
//
// - Debounces bursts of changes (fast card clicks) into one request.
// - Only one request is in flight at a time during normal use. Network order is
//   still NOT guaranteed once flushOnExit() runs (or across tabs/page loads), so
//   callers must make snapshots self-ordering (the progress API ignores any
//   snapshot whose revision is not newer than the stored one).
// - Retries transient failures (network / 5xx) a few times; permanent
//   rejections (4xx) are dropped.
// - flushOnExit() sends anything unsaved with `keepalive` when the page hides,
//   including a snapshot that is still in flight (the browser may cancel it).

export type SaveStatus = "idle" | "saving" | "saved" | "error";
export type SendResult = "ok" | "retry" | "drop";

export interface SaverOptions<T> {
  send: (value: T, opts: { keepalive: boolean }) => Promise<SendResult>;
  onStatus?: (status: SaveStatus) => void;
  debounceMs?: number;
  retryMs?: number;
  maxRetries?: number;
}

export interface LatestValueSaver<T> {
  schedule(value: T): void;
  flushNow(): void;
  flushOnExit(): void;
  dispose(): void;
}

export function createLatestValueSaver<T>(opts: SaverOptions<T>): LatestValueSaver<T> {
  const debounceMs = opts.debounceMs ?? 400;
  const retryMs = opts.retryMs ?? 2000;
  const maxRetries = opts.maxRetries ?? 3;

  let pending: { value: T } | null = null;
  let inFlight: { value: T } | null = null;
  let retries = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;
  let handoffs = 0; // incremented whenever a snapshot is handed to send()
  let status: SaveStatus = "idle";

  const setStatus = (s: SaveStatus) => {
    if (s === status) return;
    status = s;
    opts.onStatus?.(s);
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };
  const arm = (ms: number) => {
    clearTimer();
    timer = setTimeout(flushNow, ms);
  };

  function flushNow() {
    clearTimer();
    if (disposed || inFlight || !pending) return;
    const { value } = pending;
    pending = null;
    inFlight = { value };
    const mine = ++handoffs;
    setStatus("saving");

    opts
      .send(value, { keepalive: false })
      .catch((): SendResult => "retry") // network failure
      .then((result) => {
        inFlight = null;
        if (disposed) return;
        if (result === "retry") {
          // Re-queue only if nothing newer was scheduled or sent meanwhile,
          // so a retry can never overwrite a newer snapshot.
          if (!pending && mine === handoffs) pending = { value };
          if (!pending) return;
          if (retries < maxRetries) {
            retries++;
            arm(retryMs);
          } else {
            setStatus("error"); // kept pending; the next change tries again
          }
          return;
        }
        retries = 0;
        if (pending) flushNow();
        else setStatus(result === "ok" ? "saved" : "error");
      });
  }

  return {
    schedule(value: T) {
      if (disposed) return;
      pending = { value };
      retries = 0;
      setStatus("saving");
      if (!inFlight) arm(debounceMs);
    },
    flushNow,
    flushOnExit() {
      clearTimer();
      if (disposed) return;
      // Unsaved changes, or else the latest snapshot if it's still in flight:
      // unloading may cancel that request, so re-send it with keepalive.
      const next = pending ?? inFlight;
      if (!next) return;
      const { value } = next;
      pending = null;
      handoffs++;
      opts.send(value, { keepalive: true }).catch(() => "drop");
    },
    dispose() {
      clearTimer();
      disposed = true;
    },
  };
}
