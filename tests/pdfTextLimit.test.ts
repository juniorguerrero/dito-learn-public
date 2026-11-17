import { describe, expect, it } from "vitest";
import { extractDocumentText } from "@/lib/parse";
import { processUploadedFile } from "@/lib/documentIntake";
import { MAX_LESSON_TEXT_CHARS, normalizeLessonText } from "@/lib/uploadRules";
import { readFixture } from "./documentFixtureCases";

// Regression: the PDF worker used to compare the *raw* extracted text with the
// 60,000-character limit, while the documented limit applies after
// normalization. A document within the limit but with removable whitespace
// (blank pages) was cut off after page 40 and rejected.

describe("PDF length limit is measured on normalized text", () => {
  it("reads a booklet at exactly the limit to its last page (no early stop)", async () => {
    const r = await extractDocumentText("pdf", readFixture("blank-pages-at-limit.pdf"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r).toMatchObject({ stoppedEarly: false, pagesRead: 51, totalPages: 51 });
    expect(r.text.length).toBeGreaterThan(MAX_LESSON_TEXT_CHARS); // raw is over...
    expect(normalizeLessonText(r.text)).toHaveLength(MAX_LESSON_TEXT_CHARS); // ...normalized is exactly at the limit
    expect(r.text).toContain("Back cover - end of the archive."); // page 51
  }, 30_000);

  it("accepts it in full and rejects the same booklet one character over", async () => {
    const at = await processUploadedFile("blank-pages-at-limit.pdf", readFixture("blank-pages-at-limit.pdf"));
    expect(at.ok && at.text.length).toBe(60_000);
    expect(at.ok && at.text.endsWith("Ledger 20 of 20") === false && at.text.endsWith("Back cover - end of the archive.")).toBe(true);
    const over = await processUploadedFile("blank-pages-over-limit.pdf", readFixture("blank-pages-over-limit.pdf"));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error.message).toMatch(/has 60,001 characters of text/); // counted in full, not "more than"
  }, 30_000);

  it("still stops early on a genuinely long PDF, and the reported lower bound is really over the limit", async () => {
    const r = await extractDocumentText("pdf", readFixture("too-long-text.pdf"));
    expect(r.ok && r.stoppedEarly).toBe(true);
    if (!r.ok) return;
    expect(r.pagesRead).toBeLessThan(r.totalPages!);
    expect(normalizeLessonText(r.text).length).toBeGreaterThan(MAX_LESSON_TEXT_CHARS);
    const up = await processUploadedFile("too-long-text.pdf", readFixture("too-long-text.pdf"));
    const n = !up.ok ? Number(/more than ([\d,]+) characters/.exec(up.error.message)?.[1].replace(/,/g, "")) : NaN;
    expect(n).toBeGreaterThan(MAX_LESSON_TEXT_CHARS);
  }, 30_000);

  it("normalization is prefix-monotonic (what makes stopping early safe)", () => {
    // normalize(a) is a prefix of normalize(a + b), so it is never longer.
    const alphabet = ["x", "y", " ", "\t", "\n", "\r", "\r\n", "\u0007", "\f", "\uFEFF", "é", "🦋"];
    let seed = 12345;
    const rand = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31), seed % n);
    const word = () => Array.from({ length: rand(12) }, () => alphabet[rand(alphabet.length)]).join("");
    for (let i = 0; i < 5000; i++) {
      const a = word();
      const b = word();
      const na = normalizeLessonText(a);
      const nab = normalizeLessonText(a + b);
      expect(nab.startsWith(na), JSON.stringify({ a, b })).toBe(true);
    }
  });
});
