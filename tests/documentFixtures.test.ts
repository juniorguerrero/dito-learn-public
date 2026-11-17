import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { describe, expect, it } from "vitest";
import { processUploadedFile } from "@/lib/documentIntake";
import { MAX_LESSON_TEXT_CHARS, MAX_UPLOAD_BYTES, normalizeLessonText } from "@/lib/uploadRules";
import { FIXTURE_DIR as DIR, REJECTED, VALID, readFixture as read } from "./documentFixtureCases";
import * as generator from "../scripts/generate-document-fixtures.mjs";

// Every synthetic upload fixture (tests/fixtures/documents) with its expected
// result through the real server-side intake (signature checks + the isolated
// parser worker). The README table mirrors this list.

describe("synthetic document fixtures", () => {
  // --check rebuilds every generated fixture (from the recorded booklet tuning, without
  // parsing PDFs) and compares bytes: ~0.2 s. The child is killed after 25 s so a hang
  // is reported as a failure instead of outliving the test; the test budget is 30 s.
  const SCRIPT = path.join(__dirname, "..", "scripts", "generate-document-fixtures.mjs");
  const runCheck = (env: Record<string, string> = {}) => {
    try {
      execFileSync(process.execPath, [SCRIPT, "--check"], { stdio: "pipe", timeout: 25_000, env: { ...process.env, ...env } });
      return { ok: true, output: "" };
    } catch (err) {
      const e = err as { stderr?: Buffer; signal?: string };
      if (e.signal) throw new Error(`fixture check did not finish within 25 s (${e.signal})`);
      return { ok: false, output: String(e.stderr ?? "") };
    }
  };

  it("generated fixtures are up to date with their sources", () => {
    const r = runCheck();
    expect(r.output).toBe("");
    expect(r.ok).toBe(true);
  }, 30_000);

  it("the check really detects drift (edited source, edited tuning, damaged file)", () => {
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "dito-fixtures-"));
    try {
      const fresh = () => {
        fs.rmSync(copy, { recursive: true, force: true });
        fs.cpSync(DIR, copy, { recursive: true });
      };
      fresh();
      expect(runCheck({ DITO_FIXTURES_DIR: copy }).ok).toBe(true); // an unmodified copy passes

      fs.appendFileSync(path.join(copy, "source", "valid-lesson-pdf.md"), "\nOne more sentence about lantern moths.\n");
      let r = runCheck({ DITO_FIXTURES_DIR: copy });
      expect(r.ok).toBe(false);
      expect(r.output).toMatch(/stale: valid-lesson\.pdf/);
      expect(r.output).toMatch(/stale: blank-pages-at-limit\.pdf/);
      expect(r.output).toMatch(/stale: source\/booklet-tuning\.json/);

      fresh();
      const tuningFile = path.join(copy, "source", "booklet-tuning.json");
      const tuning = JSON.parse(fs.readFileSync(tuningFile, "utf-8"));
      tuning["60000"].extra -= 1; // would make the booklet 59,999 characters
      fs.writeFileSync(tuningFile, JSON.stringify(tuning));
      r = runCheck({ DITO_FIXTURES_DIR: copy });
      expect(r.ok).toBe(false);
      expect(r.output).toMatch(/stale: blank-pages-at-limit\.pdf/);
      expect(r.output).not.toMatch(/stale: blank-pages-over-limit\.pdf/);

      fresh();
      const victim = path.join(copy, "valid-lesson.docx");
      const bytes = fs.readFileSync(victim);
      bytes[bytes.length - 30] ^= 0xff;
      fs.writeFileSync(victim, bytes);
      r = runCheck({ DITO_FIXTURES_DIR: copy });
      expect(r.ok).toBe(false);
      expect(r.output).toMatch(/stale: valid-lesson\.docx/);

      fresh();
      fs.rmSync(tuningFile);
      r = runCheck({ DITO_FIXTURES_DIR: copy });
      expect(r.ok).toBe(false);
      expect(r.output).toMatch(/booklet-tuning\.json is missing/);
    } finally {
      fs.rmSync(copy, { recursive: true, force: true });
    }
  }, 30_000);

  it("the generator uses the app's upload size limit", () => {
    expect(generator.MAX_UPLOAD_BYTES).toBe(MAX_UPLOAD_BYTES);
  });

  it("every committed fixture has an expected result", () => {
    const files = fs.readdirSync(DIR).filter((f) => fs.statSync(path.join(DIR, f)).isFile() && !f.startsWith(".") && !["README.md", "expected-results.json"].includes(f));
    expect(files.sort()).toEqual([...VALID.map((v) => v.file), ...REJECTED.map((r) => r.file)].sort());
  });

  it("expected-results.json (used by the HTTP smoke test) matches these tables", () => {
    const { _comment, ...expected } = JSON.parse(fs.readFileSync(path.join(DIR, "expected-results.json"), "utf-8"));
    expect(_comment).toBeTruthy();
    const results = Object.fromEntries(Object.entries(expected as Record<string, { result: string }>).map(([f, e]) => [f, e.result]));
    expect(results).toEqual(Object.fromEntries([...VALID.map((v) => [v.file, "accepted"]), ...REJECTED.map((r) => [r.file, r.code])]));
    for (const v of VALID) {
      const e = (expected as Record<string, { contains: string; chars?: number }>)[v.file];
      expect(e.contains, v.file).toBeTruthy();
      expect(e.chars).toBe(v.chars);
    }
  });

  it("blank-pages booklets: raw extraction of pages 1-50 is over the limit, normalized text is at / one over it", async () => {
    // The defining property, measured with pdf-parse directly (independent of the app's worker).
    const { PDFParse } = await import("pdf-parse");
    for (const [file, normalized] of [["blank-pages-at-limit.pdf", 60_000], ["blank-pages-over-limit.pdf", 60_001]] as const) {
      const parser = new PDFParse({ data: read(file) });
      const info = await parser.getInfo();
      const all = (await parser.getText({ pageJoiner: "" })).text;
      const first50 = (await parser.getText({ first: 1, last: 50, pageJoiner: "" })).text;
      await parser.destroy();
      expect(info.total).toBe(51);
      expect(first50.length).toBeGreaterThan(MAX_LESSON_TEXT_CHARS); // raw: over
      expect(normalizeLessonText(all).length).toBe(normalized); // normalized: at / one over
      expect(normalizeLessonText(all).endsWith("Back cover - end of the archive.")).toBe(true); // page 51
    }
  }, 30_000);

  it("valid files carry real format signatures (not renamed text)", () => {
    expect(Buffer.from(read("valid-lesson.pdf").subarray(0, 5)).toString("latin1")).toBe("%PDF-");
    expect(Array.from(read("valid-lesson.docx").subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(Buffer.from(read("valid-lesson.docx")).includes(Buffer.from("word/document.xml"))).toBe(true);
    // The PDF's text lives in compressed content streams: only a PDF parser can read it.
    expect(Buffer.from(read("valid-lesson.pdf")).includes(Buffer.from("luciferase"))).toBe(false);
  });

  const expectedJson = JSON.parse(fs.readFileSync(path.join(DIR, "expected-results.json"), "utf-8")) as Record<string, { contains?: string; chars?: number }>;

  for (const { file, title, phrases, chars } of VALID) {
    it(`accepts ${file} and extracts its text`, async () => {
      const r = await processUploadedFile(file, read(file));
      if (!r.ok) throw new Error(`${file} rejected: ${r.error.message}`);
      if (chars !== undefined) expect(r.text.length).toBe(chars);
      // The HTTP smoke test's stored-text expectation must hold for the real extraction.
      expect(r.text).toContain(expectedJson[file].contains);
      expect(r.text.startsWith(title)).toBe(true);
      for (const p of phrases) expect(r.text).toContain(p);
      expect(r.text).not.toMatch(/\uFFFD|-- \d+ of \d+ --/); // no decoding damage, no parser page markers
      expect(r.text.length).toBeGreaterThan(1000);
    }, 30_000);
  }

  for (const { file, code, mentions } of REJECTED) {
    it(`rejects ${file} with ${code}`, async () => {
      const r = await processUploadedFile(file, read(file));
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error.code).toBe(code);
      expect(r.error.message).toContain(`“${file}”`);
      expect(r.error.message).toMatch(mentions);
    }, 30_000);
  }
});
