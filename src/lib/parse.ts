import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import { MAX_LESSON_TEXT_CHARS } from "./uploadRules";

// PDF / DOCX text extraction, isolated in a worker thread per document.
//
// Containment:
// - Time: each parse has a deadline (default 20 s, DITO_PARSE_TIMEOUT_MS).
//   On timeout the worker is terminated: V8 stops the thread even in a tight
//   loop. We wait for its exit before answering, so no parsing continues after
//   the teacher has been told it was stopped.
// - Memory: V8 heap limits per worker (resourceLimits). Exceeding them kills
//   the worker (ERR_WORKER_OUT_OF_MEMORY), reported as "resources".
// - Concurrency: at most MAX_CONCURRENT_PARSES workers at once. A few more
//   requests wait in a queue; beyond that, uploads get "busy" (503).
// - Work: PDFs are read in page batches and reading stops once the text is
//   over the lesson limit, so a whole book is never extracted.
//
// Known limits (documented in README): the worker shares the server process,
// so memory outside the V8 heap (ArrayBuffers, native allocations) is not
// capped by resourceLimits, and a crash in native code would still affect the
// process. A separate OS process would be the next step if that matters.

export type ParseFailure = "damaged" | "password" | "timeout" | "resources" | "busy";

export type ParseOutcome =
  | { ok: true; text: string; stoppedEarly: boolean; pagesRead: number | null; totalPages: number | null }
  | { ok: false; reason: ParseFailure; detail?: string };

export interface ParseOptions {
  timeoutMs?: number;
  maxChars?: number;
  /** Test hook: run a different worker script (e.g. one that never finishes). */
  workerPath?: string;
  resourceLimits?: { maxOldGenerationSizeMb?: number; maxYoungGenerationSizeMb?: number; stackSizeMb?: number };
}

export const DEFAULT_PARSE_TIMEOUT_MS = 20_000;
export const MAX_CONCURRENT_PARSES = 2;
export const MAX_QUEUED_PARSES = 8;
const PDF_BATCH_PAGES = 10;
const DEFAULT_LIMITS = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 };

export function parseTimeoutMs(): number {
  const v = Number(process.env.DITO_PARSE_TIMEOUT_MS);
  return Number.isFinite(v) && v > 0 ? v : DEFAULT_PARSE_TIMEOUT_MS;
}

// Resolved at call time from the project root: the worker is a plain file on
// disk and must not go through the Next.js bundler.
export function defaultWorkerPath(): string {
  return path.join(process.cwd(), "src", "workers", "parse-document.worker.mjs");
}

// ---------- concurrency gate ----------

let running = 0;
const waiting: (() => void)[] = [];

function acquire(): Promise<boolean> {
  if (running < MAX_CONCURRENT_PARSES) {
    running++;
    return Promise.resolve(true);
  }
  if (waiting.length >= MAX_QUEUED_PARSES) return Promise.resolve(false);
  return new Promise((resolve) => waiting.push(() => resolve(true)));
}

function release() {
  const next = waiting.shift();
  if (next) next(); // hand the slot straight to the next waiter
  else running--;
}

/** For tests: how many parse workers are alive right now. */
export function activeParseWorkers(): number {
  return liveWorkers;
}
let liveWorkers = 0;

// ---------- run one document ----------

export async function extractDocumentText(kind: "pdf" | "docx", bytes: Uint8Array, opts: ParseOptions = {}): Promise<ParseOutcome> {
  if (!(await acquire())) return { ok: false, reason: "busy" };
  try {
    return await runWorker(kind, bytes, opts);
  } finally {
    release();
  }
}

function runWorker(kind: "pdf" | "docx", bytes: Uint8Array, opts: ParseOptions): Promise<ParseOutcome> {
  const workerPath = opts.workerPath ?? defaultWorkerPath();
  if (!fs.existsSync(workerPath)) throw new Error(`Document parser worker is missing: ${workerPath}`);
  const timeoutMs = opts.timeoutMs ?? parseTimeoutMs();

  // Copy into a standalone buffer and transfer it (no second copy, and the
  // worker never sees the rest of a pooled Buffer).
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);

  return new Promise<ParseOutcome>((resolve) => {
    let outcome: ParseOutcome | null = null;
    const worker = new Worker(workerPath, {
      workerData: { kind, bytes: copy, maxChars: opts.maxChars ?? MAX_LESSON_TEXT_CHARS, batchPages: PDF_BATCH_PAGES },
      transferList: [copy.buffer],
      resourceLimits: { ...DEFAULT_LIMITS, ...opts.resourceLimits },
      stdout: true, // swallow library console output; parse problems are reported via messages
      stderr: true,
    });
    liveWorkers++;
    worker.stdout.resume();
    worker.stderr.resume();

    const settle = (o: ParseOutcome) => {
      if (!outcome) outcome = o;
    };
    const timer = setTimeout(() => {
      settle({ ok: false, reason: "timeout", detail: `no result after ${timeoutMs} ms` });
      void worker.terminate(); // resolves via the "exit" handler below
    }, timeoutMs);

    worker.on("message", (m: ParseOutcome) => {
      settle(m);
      void worker.terminate();
    });
    worker.on("error", (err: Error & { code?: string }) => {
      const oom = err.code === "ERR_WORKER_OUT_OF_MEMORY" || /out of memory|heap/i.test(err.message);
      settle({ ok: false, reason: oom ? "resources" : "damaged", detail: `${err.code || err.name}: ${err.message}`.slice(0, 500) });
    });
    worker.on("exit", () => {
      // Only answer once the thread is gone: nothing keeps running after this.
      clearTimeout(timer);
      liveWorkers--;
      resolve(outcome ?? { ok: false, reason: "damaged", detail: "parser exited without a result" });
    });
  });
}
