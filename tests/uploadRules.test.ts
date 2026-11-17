import { describe, expect, it } from "vitest";
import {
  ACCEPT_ATTRIBUTE,
  MAX_LESSON_TEXT_CHARS,
  MAX_UPLOAD_BYTES,
  checkFileMeta,
  checkLessonTextLength,
  checkSubmission,
  decodeTextFile,
  normalizeLessonText,
  precheckFile,
} from "@/lib/uploadRules";
import { processUploadedFile } from "@/lib/documentIntake";
import { REJECTED, VALID, readFixture } from "./documentFixtureCases";

const enc = (s: string) => new TextEncoder().encode(s);

describe("file name and size rules", () => {
  it("accepts exactly the four document types (any letter case)", () => {
    for (const n of ["a.pdf", "a.PDF", "a.docx", "a.txt", "a.md", "a.markdown", "notes.v2.Md"]) expect(checkFileMeta(n, 10)).toBeNull();
    expect(ACCEPT_ATTRIBUTE).toBe(".pdf,.docx,.txt,.md,.markdown");
  });

  it("rejects other types, with a specific message for legacy .doc", () => {
    expect(checkFileMeta("old.doc", 10)?.code).toBe("legacy_doc");
    for (const n of ["pic.png", "sheet.xlsx", "lesson.pdf.exe", "README", ".pdf", "slides.pptx", "notes.rtf"]) {
      expect(checkFileMeta(n, 10)?.code).toBe("unsupported_type");
    }
  });

  it("size boundaries use the actual byte count: 0 empty, MAX ok, MAX+1 too large", () => {
    expect(checkFileMeta("a.pdf", 0)?.code).toBe("file_empty");
    expect(checkFileMeta("a.pdf", 1)).toBeNull();
    expect(checkFileMeta("a.pdf", MAX_UPLOAD_BYTES)).toBeNull();
    const over = checkFileMeta("big.pdf", MAX_UPLOAD_BYTES + 1);
    expect(over?.code).toBe("file_too_large");
    expect(over?.status).toBe(413);
    expect(over?.message).toMatch(/“big.pdf” is 10\.0 MiB, but the maximum is 10 MiB/);
  });
});

describe("text file decoding", () => {
  it("accepts UTF-8 with or without a byte-order mark", () => {
    expect(decodeTextFile("a.txt", enc("Zoë’s café — 18 °C"))).toEqual({ ok: true, text: "Zoë’s café — 18 °C" });
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...Array.from(enc("hello"))]);
    expect(decodeTextFile("a.txt", bom)).toEqual({ ok: true, text: "hello" });
  });

  it("rejects other encodings with instructions for saving as UTF-8", () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in Windows-1252
    const r = decodeTextFile("a.txt", latin1);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe("not_utf8");
      expect(r.error.message).toMatch(/Windows-1252.*Notepad.*UTF-8/);
    }
    const utf16 = decodeTextFile("a.txt", new Uint8Array([0xff, 0xfe, 0x68, 0x00]));
    expect(!utf16.ok && utf16.error.message).toMatch(/UTF-16/);
  });

  it("rejects binary content, naming what it looks like", () => {
    const png = decodeTextFile("a.txt", new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    expect(!png.ok && png.error.code).toBe("binary_content");
    expect(!png.ok && png.error.message).toMatch(/PNG image/);
    expect(decodeTextFile("a.txt", enc("text\u0000with a NUL")).ok).toBe(false);
    const manyControls = enc("abc" + "\u0001\u0002\u0003".repeat(10));
    expect(decodeTextFile("a.md", manyControls).ok).toBe(false);
    // A stray control character in a long text is tolerated (removed by normalization).
    expect(decodeTextFile("a.md", enc("x".repeat(5000) + "\u0007")).ok).toBe(true);
  });
});

describe("lesson text length (the Learning Blueprint limit)", () => {
  it("boundaries: 49 too short, 50 ok, 60,000 ok, 60,001 too long", () => {
    expect(checkLessonTextLength("a".repeat(49))?.code).toBe("too_short");
    expect(checkLessonTextLength("a".repeat(50))).toBeNull();
    expect(checkLessonTextLength("a".repeat(MAX_LESSON_TEXT_CHARS))).toBeNull();
    const over = checkLessonTextLength("a".repeat(MAX_LESSON_TEXT_CHARS + 1), { pasted: true });
    expect(over?.code).toBe("text_too_long");
    expect(over?.message).toMatch(/The pasted text has 60,001 characters.*at most 60,000/);
  });

  it("is measured after normalization, in UTF-16 code units", () => {
    expect(normalizeLessonText("\uFEFF  line one  \r\n\r\n\r\n\r\nline two\t\r\n")).toBe("line one\n\nline two");
    expect(normalizeLessonText("a\u0000b\u0007c")).toBe("abc");
    expect("é".length).toBe(1);
    expect("🦋".length).toBe(2); // emoji count as two, documented
  });
});

describe("submission shape", () => {
  it("requires exactly one of file or pasted text", () => {
    expect(checkSubmission(true, "some pasted words")?.code).toBe("file_and_text");
    expect(checkSubmission(true, "  \n\t ")).toBeNull(); // blank text doesn't count
    expect(checkSubmission(false, "   ")?.code).toBe("no_input");
    expect(checkSubmission(false, "short")?.code).toBe("too_short");
    expect(checkSubmission(false, "x".repeat(60))).toBeNull();
  });
});

describe("browser pre-check agrees with the server", () => {
  const asFile = (name: string) => new File([readFixture(name)], name);

  for (const { file } of VALID) {
    it(`passes ${file}`, async () => {
      expect(await precheckFile(asFile(file))).toBeNull();
    });
  }

  for (const { file, code } of REJECTED) {
    it(`${file}: browser either defers to the server or reports the same ${code}`, async () => {
      const browser = await precheckFile(asFile(file));
      const server = await processUploadedFile(file, readFixture(file));
      expect(server.ok).toBe(false);
      if (browser) expect(browser.code).toBe(code);
      // What only the server can know (parsing PDF/DOCX) is deferred, everything else is caught early.
      const needsParsing = ["damaged_file", "no_text_layer", "password_protected"].includes(code) || (code === "text_too_long" && !file.endsWith(".txt"));
      expect(browser === null).toBe(needsParsing);
    }, 30_000);
  }
});
