import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { MAX_CONCURRENT_PARSES, MAX_QUEUED_PARSES, activeParseWorkers, extractDocumentText, parseTimeoutMs } from "@/lib/parse";
import { processUploadedFile } from "@/lib/documentIntake";
import { readFixture } from "./documentFixtureCases";

// Parsing runs in a worker thread that is *stopped* on timeout or when it
// exceeds its memory limit — not merely abandoned while it keeps running.

const HANG = path.join(__dirname, "helpers", "hanging-parse-worker.mjs");
const HOG = path.join(__dirname, "helpers", "memory-hog-parse-worker.mjs");
const pdf = readFixture("valid-lesson.pdf");
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  delete process.env.HANG_HEARTBEAT_FILE;
  delete process.env.DITO_PARSE_TIMEOUT_MS;
});

describe("parse containment", () => {
  it("terminates a parser stuck in a CPU loop at the deadline, and it really stops", async () => {
    const beat = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "dito-hang-")), "heartbeat");
    process.env.HANG_HEARTBEAT_FILE = beat;
    const t0 = Date.now();
    const r = await extractDocumentText("pdf", pdf, { workerPath: HANG, timeoutMs: 400 });
    const elapsed = Date.now() - t0;
    expect(r).toMatchObject({ ok: false, reason: "timeout" });
    expect(elapsed).toBeGreaterThanOrEqual(400);
    expect(elapsed).toBeLessThan(5000);
    expect(activeParseWorkers()).toBe(0); // the answer only comes after the thread exited
    const beatsAtTimeout = fs.statSync(beat).size;
    expect(beatsAtTimeout).toBeGreaterThan(3); // it was running...
    await sleep(300);
    expect(fs.statSync(beat).size).toBe(beatsAtTimeout); // ...and no longer is
    fs.rmSync(path.dirname(beat), { recursive: true, force: true });
  }, 15_000); // the meaningful bound is the elapsed < 5 s assertion above

  it("stops a parser that exceeds its memory limit", async () => {
    const r = await extractDocumentText("pdf", pdf, { workerPath: HOG, timeoutMs: 20_000, resourceLimits: { maxOldGenerationSizeMb: 32, maxYoungGenerationSizeMb: 8 } });
    expect(r).toMatchObject({ ok: false, reason: "resources" });
    expect(activeParseWorkers()).toBe(0);
  }, 30_000);

  it("limits concurrent parses and turns away requests beyond the queue", async () => {
    const jobs = Array.from({ length: MAX_CONCURRENT_PARSES + MAX_QUEUED_PARSES + 1 }, () =>
      extractDocumentText("pdf", pdf, { workerPath: HANG, timeoutMs: 150 })
    );
    await sleep(50);
    expect(activeParseWorkers()).toBe(MAX_CONCURRENT_PARSES); // never more threads than the limit
    const results = await Promise.all(jobs);
    expect(results.filter((r) => !r.ok && r.reason === "busy")).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.reason === "timeout")).toHaveLength(MAX_CONCURRENT_PARSES + MAX_QUEUED_PARSES);
    expect(activeParseWorkers()).toBe(0);
  }, 30_000);

  it("reports a timeout to the teacher as a clear upload error", async () => {
    const r = await processUploadedFile("valid-lesson.pdf", pdf, { timeoutMs: 1 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("parse_timeout");
      expect(r.error.status).toBe(422);
      expect(r.error.message).toMatch(/took longer than 1 second, so it was stopped/);
    }
    expect(activeParseWorkers()).toBe(0);
  }, 15_000);

  it("the deadline is configurable with DITO_PARSE_TIMEOUT_MS (default 20 s)", () => {
    expect(parseTimeoutMs()).toBe(20_000);
    process.env.DITO_PARSE_TIMEOUT_MS = "5000";
    expect(parseTimeoutMs()).toBe(5000);
    process.env.DITO_PARSE_TIMEOUT_MS = "nonsense";
    expect(parseTimeoutMs()).toBe(20_000);
  });

  it("real PDF and DOCX parsing still succeeds inside the limits", async () => {
    const p = await extractDocumentText("pdf", pdf);
    expect(p.ok && p.text).toContain("Vellmark");
    const d = await extractDocumentText("docx", readFixture("valid-lesson.docx"));
    expect(d.ok && d.text).toContain("Dunmere");
    expect(activeParseWorkers()).toBe(0);
  }, 30_000);
});
