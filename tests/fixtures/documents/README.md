# Synthetic upload fixtures

Documents for testing both upload paths by hand and from automated tests:

- standalone page `/upload` → `POST /api/upload`
- teacher classroom uploader `/teacher/[id]` → `POST /api/classrooms/[id]/lessons`

All content is fictional (invented places, species and people). There is no real
personal data, and generating the files needs no network or AI services.

## Finding the files

In the browser's file dialog (or a file manager, for drag-and-drop), go to:

```
/workspace/dito-learn/tests/fixtures/documents/
```

Files in the on-demand `generated/` subfolder only exist after you create
them (see below). They are git-ignored because they are 10 MiB each.

## Files and expected results

Both routes give the same result for every file. The same expectations are
machine-readable in `expected-results.json`, which `npm run smoke:uploads`
checks against a running server. For accepted files it also lists text from
the document's last page (`contains`) and, for the booklet, the exact stored
length (`chars`), so the smoke test proves nothing was cut off.
`tests/documentFixtureCases.ts` holds the same list with message checks.

The smoke test prints its own tally. With the current 22 fixtures it runs
**51 checks** (45 before the two booklets and the password PDF were added):
- 22 fixtures × 2 routes = 44
- pasted text and file + text on both routes = 4
- the 2 generated boundary files = 2 (skipped if you haven't generated them)
- a 12 MiB request = 1

| File | What it is | Expected result |
| --- | --- | --- |
| `valid-lesson.pdf` | Genuine 2-page PDF with a real text layer: *The Lantern Moths of Vellmark Valley* | **Accepted**: lesson created |
| `valid-lesson.docx` | Genuine Word document with headings and real bullet/numbered lists: *The Aqueducts of the Kingdom of Dunmere* | **Accepted** |
| `valid-lesson.txt` | UTF-8 text with non-ASCII characters (é, ë): *Cloud Harvesting on the Floating Isles of Aeralith* | **Accepted** |
| `valid-lesson.md` | Markdown with headings, emphasis, a table, lists and a quote: *Orbits and the Skyport of Caldera Nine* | **Accepted** (stored as Markdown text) |
| `empty-file.txt`, `empty-file.pdf` | 0 bytes | 400 `file_empty`: "… is empty (0 bytes)" (caught in the browser) |
| `whitespace-only.txt` | Only spaces, tabs and newlines | 422 `too_short`: "contains no text — only blank space" |
| `too-short.txt` | One 11-character sentence | 422 `too_short`: needs at least 50 characters |
| `no-text-scanned.pdf` | Valid PDF whose only content is an image (like a scan) | 422 `no_text_layer`: no selectable text; run OCR or upload the original |
| `damaged-truncated.pdf` | First 45% of `valid-lesson.pdf` | 422 `damaged_file`: damaged or incomplete, export a fresh copy |
| `damaged-truncated.docx` | First 50% of `valid-lesson.docx` | 422 `damaged_file` |
| `mislabeled-text-file.pdf` | Plain text with a `.pdf` name | 415 `type_mismatch`: "named like a PDF but isn't one — it looks like plain text" |
| `unsupported-legacy-word.doc` | Genuine Word 97–2003 (.doc) file | 415 `legacy_doc`: save as .docx or PDF (the file dialog no longer offers `.doc`) |
| `unsupported-image.png` | Genuine 32×32 PNG image | 415 `unsupported_type` |
| `unsupported-binary-disguised.txt` | The same PNG bytes with a `.txt` name | 415 `binary_content`: "it looks like a PNG image" |
| `not-utf8-windows-1252.txt` | `valid-lesson.txt` saved as Windows-1252 / Latin-1 | 422 `not_utf8`, with steps for saving as UTF-8 |
| `not-utf8-utf16.txt` | `valid-lesson.txt` saved as UTF-16 ("Unicode" in Notepad) | 422 `not_utf8`, names UTF-16 |
| `too-long-text.docx` | Genuine DOCX with 68,201 characters of text (6 KiB on disk) | 422 `text_too_long`: "has 68,201 characters … at most 60,000", split the material |
| `too-long-text.pdf` | Genuine 31-page PDF, about 65,000 characters (49 KiB) | 422 `text_too_long`: reading stops after page 30 ("more than 64,788 characters") |
| `blank-pages-at-limit.pdf` | 51-page print-ready booklet: 20 content pages each with a blank verso, 10 blank padding pages, and a one-line back cover (page 51). Normalized text is **exactly 60,000** characters, but the raw extraction of pages 1–50 is 60,028 because blank pages add removable newlines | **Accepted in full**: 60,000 characters stored, including the back cover. Regression fixture: the parser used to measure raw text, stop after page 40 and reject it |
| `blank-pages-over-limit.pdf` | The same booklet with a normalized length of **60,001** | 422 `text_too_long`: "has 60,001 characters" (counted exactly, not "more than") |
| `password-protected.pdf` | `valid-lesson.pdf` encrypted with AES-256 (qpdf, R6). Needs the password `dito-fixture` to open (owner password `dito-fixture-owner`) | 422 `password_protected`: save an unprotected copy and upload that (detected by the server) |
| `generated/at-size-limit.docx` *(on demand)* | Valid DOCX of exactly 10,485,760 bytes (10 MiB) | **Accepted** |
| `generated/oversized-lesson.txt` *(on demand)* | Valid text, 10 MiB + 1 byte | 413 `file_too_large` (caught in the browser) |

Browser vs server:
- The browser checks name, size, file signature, and (for `.txt`/`.md`) encoding and length before uploading, so those rejections appear instantly and nothing is sent.
- Damaged, scanned, password-protected and too-long PDF/DOCX files can only be detected by parsing, so they are reported by the server. The file stays selected so it can be replaced or retried.

## Editing and regenerating

The PDF and DOCX are generated from editable text sources:

- `source/valid-lesson-pdf.md` → `valid-lesson.pdf`, `damaged-truncated.pdf`, `too-long-text.pdf`, `blank-pages-at-limit.pdf`, `blank-pages-over-limit.pdf`
- `source/valid-lesson-docx.md` → `valid-lesson.docx`, `damaged-truncated.docx`, `too-long-text.docx`, `generated/at-size-limit.docx`
- `valid-lesson.txt` (hand-edited) → `not-utf8-windows-1252.txt`, `not-utf8-utf16.txt`, `generated/oversized-lesson.txt`

Supported source syntax:
- `# ` title (first line), `## ` heading, `- ` bullet, `1. ` numbered item
- a blank line between paragraphs
- `<!-- … -->` comment lines

The PDF font supports Latin-1 plus `– — ‘ ’ “ ” • … €`. The generator stops with a clear error on any other character.

```bash
npm run fixtures:documents                     # regenerate after editing a source
npm run fixtures:documents -- --check          # exit 1 if committed files are stale (~0.2 s, no PDF parsing; also run by npm test)
npm run fixtures:documents -- --at-limit       # generated/at-size-limit.docx, exactly 10 MiB
npm run fixtures:documents -- --oversized      # generated/oversized-lesson.txt, 10 MiB + 1 byte
npm run fixtures:documents -- --oversized=25   # custom size in MiB
```

The generator (`scripts/generate-document-fixtures.mjs`) writes the PDF and
DOCX files itself with Node built-ins. For the two blank-pages booklets it
also uses the project's pdf-parse and the app's normalization
(`src/lib/lessonText.mjs`). It tunes the last content page until the
normalized extraction is exactly 60,000 / 60,001 characters, and stops with an
error if the raw extraction of pages 1–50 is no longer over the limit, since
the fixture would then stop testing the regression. Run `npm ci` first.

Tuning parses the booklets repeatedly, so it takes a few seconds. A normal
run records the resulting layout, plus a hash of the source text, in
`source/booklet-tuning.json` (committed).

`--check` rebuilds every generated fixture from the sources and that recorded
layout, **without parsing any PDF**, and compares bytes. It takes about 0.2 s
and reports a file as stale if:
- a source changed;
- the tuning file changed or is missing;
- a committed file was altered.

The booklets' actual properties (51 pages, normalized length exactly
60,000 / 60,001, raw pages 1–50 over the limit) are checked separately with
pdf-parse by `tests/documentFixtures.test.ts`. `DITO_FIXTURES_DIR=<dir>` points
the generator at a copy; the tests use this to prove `--check` detects drift.

Output is byte-for-byte reproducible, with fixed timestamps in the PDF info
and the ZIP entries. The generator also writes `no-text-scanned.pdf`,
`unsupported-image.png` and `unsupported-binary-disguised.txt`.

`valid-lesson.txt`, `valid-lesson.md`, `too-short.txt`, `whitespace-only.txt`,
`mislabeled-text-file.pdf` and the empty files are hand-edited.

`password-protected.pdf` is a static file, made with qpdf from
`valid-lesson.pdf`. Recreate it after changing that PDF:

```bash
cd tests/fixtures/documents && qpdf --static-id --static-aes-iv \
  --encrypt dito-fixture dito-fixture-owner 256 -- valid-lesson.pdf password-protected.pdf
```

AES-256 (R6) encryption uses random password salts, so the bytes differ on each run even with the static options. That's why it isn't part of `--check`.

`unsupported-legacy-word.doc` is a static file. To recreate it (needs
LibreOffice; not part of normal regeneration):

```bash
cd /tmp && soffice --headless --convert-to doc /workspace/dito-learn/tests/fixtures/documents/valid-lesson.docx \
  && mv valid-lesson.doc /workspace/dito-learn/tests/fixtures/documents/unsupported-legacy-word.doc
```

## How validity was checked

- `npm test` (`tests/documentFixtures.test.ts`):
  - generated files match their sources;
  - valid files have real format signatures;
  - every file gives its expected result through the real server intake (including the parser worker).
- Independent tools, run when the fixtures were created:
  - `qpdf --check` and `pdftotext` for the PDFs (the scanned PDF yields no text, the truncated one fails recovery, the booklets' 30 blank pages contain no text and page 51 holds the back cover);
  - `qpdf --show-encryption` / `pdftotext` for the password-protected PDF (R6, opens only with the password);
  - `unzip -t` for the DOCX files, including the 10 MiB one;
  - LibreOffice converts the DOCX files to text and PDF;
  - `file` identifies each file's type and encoding.
