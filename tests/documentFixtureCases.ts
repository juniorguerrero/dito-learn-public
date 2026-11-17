import fs from "fs";
import path from "path";
import type { UploadErrorCode } from "@/lib/uploadRules";

// Expected results for every committed upload fixture (tests/fixtures/documents).
// Shared by the fixture test, the upload route tests and the browser checks'
// README table.

export const FIXTURE_DIR = path.join(__dirname, "fixtures", "documents");
export const readFixture = (name: string) => new Uint8Array(fs.readFileSync(path.join(FIXTURE_DIR, name)));

/** `chars`: exact stored length where the fixture was built to a precise size. */
export const VALID: { file: string; title: string; phrases: string[]; chars?: number }[] = [
  { file: "valid-lesson.pdf", title: "The Lantern Moths of Vellmark Valley", phrases: ["luciferase", "18 °C", "evening tide\" – the moment", "naïve"] },
  { file: "valid-lesson.docx", title: "The Aqueducts of the Kingdom of Dunmere", phrases: ["chorobate", "Water Council", "about one metre for every three kilometres"] },
  { file: "valid-lesson.txt", title: "Cloud Harvesting on the Floating Isles of Aeralith", phrases: ["dew point", "Captain Zoë Marrant", "café ledger"] },
  { file: "valid-lesson.md", title: "# Orbits and the Skyport of Caldera Nine", phrases: ["Orbital speed", "Tessaly", "| Change | Result |"] },
  // 51-page booklet: normalized text exactly at the limit, raw extraction of pages 1-50 over it.
  // The back cover (page 51) must survive: the parser may not stop reading early.
  { file: "blank-pages-at-limit.pdf", title: "The Salt Glass Archive of Mereth", phrases: ["Ledger 1 of 20", "Ledger 20 of 20", "Back cover - end of the archive."], chars: 60_000 },
];

export const REJECTED: { file: string; code: UploadErrorCode; mentions: RegExp }[] = [
  { file: "empty-file.txt", code: "file_empty", mentions: /is empty \(0 bytes\)/ },
  { file: "empty-file.pdf", code: "file_empty", mentions: /is empty \(0 bytes\)/ },
  { file: "whitespace-only.txt", code: "too_short", mentions: /contains no text/ },
  { file: "too-short.txt", code: "too_short", mentions: /only 11 characters.*at least 50/ },
  { file: "no-text-scanned.pdf", code: "no_text_layer", mentions: /no selectable text[\s\S]*scanned[\s\S]*OCR/ },
  { file: "damaged-truncated.pdf", code: "damaged_file", mentions: /damaged or incomplete.*PDF viewer/ },
  { file: "damaged-truncated.docx", code: "damaged_file", mentions: /damaged or incomplete.*Word or LibreOffice/ },
  { file: "mislabeled-text-file.pdf", code: "type_mismatch", mentions: /named like a PDF but isn't one — it looks like plain text/ },
  { file: "unsupported-legacy-word.doc", code: "legacy_doc", mentions: /Word 97–2003.*\.docx/ },
  { file: "unsupported-image.png", code: "unsupported_type", mentions: /isn't a supported file type/ },
  { file: "unsupported-binary-disguised.txt", code: "binary_content", mentions: /binary data \(it looks like a PNG image\)/ },
  { file: "not-utf8-windows-1252.txt", code: "not_utf8", mentions: /isn't saved as UTF-8.*Windows-1252.*Save with Encoding/ },
  { file: "not-utf8-utf16.txt", code: "not_utf8", mentions: /UTF-16.*UTF-8/ },
  { file: "too-long-text.docx", code: "text_too_long", mentions: /has 6\d,\d{3} characters.*at most 60,000/ },
  { file: "too-long-text.pdf", code: "text_too_long", mentions: /has more than 6\d,\d{3} characters.*at most 60,000/ },
  { file: "blank-pages-over-limit.pdf", code: "text_too_long", mentions: /has 60,001 characters of text.*at most 60,000/ },
  { file: "password-protected.pdf", code: "password_protected", mentions: /is password-protected.*save a copy without the password/ },
];

