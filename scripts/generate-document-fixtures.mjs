#!/usr/bin/env node
// Generates the synthetic upload fixtures in tests/fixtures/documents/.
//
//   npm run fixtures:documents                      regenerate PDF/DOCX + derived binary fixtures
//   npm run fixtures:documents -- --check           fail if committed fixtures are stale (fast: no PDF parsing)
//   npm run fixtures:documents -- --oversized       write generated/oversized-lesson.txt (10 MiB + 1 byte)
//   npm run fixtures:documents -- --oversized=25    ... with a custom size in MiB
//   npm run fixtures:documents -- --at-limit        write generated/at-size-limit.docx (valid, exactly 10 MiB)
//
// Uses Node built-ins (zlib, fs) plus, for tuning the blank-pages booklets to an
// exact normalized length, the project's own pdf-parse and src/lib/lessonText.mjs
// (run `npm ci` first). No network, no AI services. Output is byte-for-byte
// deterministic (fixed dates, fixed zip timestamps), so re-running without
// editing the sources changes nothing.
//
// Editable sources: tests/fixtures/documents/source/valid-lesson-{pdf,docx}.md
// Supported source syntax: "# " title, "## " heading, "- " bullet,
// "1. " numbered item, blank line between paragraphs, <!-- comment --> lines.

import fs from "fs";
import path from "path";
import zlib from "zlib";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { normalizeLessonText } from "../src/lib/lessonText.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Must equal MAX_UPLOAD_BYTES in src/lib/uploadRules.ts (checked by tests/documentFixtures.test.ts).
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// DITO_FIXTURES_DIR: check or write a copy elsewhere (tests use it to prove --check detects drift).
const DIR = process.env.DITO_FIXTURES_DIR ? path.resolve(process.env.DITO_FIXTURES_DIR) : path.join(ROOT, "tests", "fixtures", "documents");
const SRC = path.join(DIR, "source");
const GENERATED = path.join(DIR, "generated");
// Layout parameters found by tuning the blank-pages booklets (written by a normal
// run, read by --check so checking needs no PDF parsing).
const TUNING_FILE = path.join(SRC, "booklet-tuning.json");

// ---------------------------------------------------------------------------
// Source parsing (tiny markdown subset)
// ---------------------------------------------------------------------------

/** @returns {{kind: "title"|"heading"|"para"|"bullet"|"number", text: string, n?: string}[]} */
export function parseSource(file) {
  const lines = fs.readFileSync(file, "utf-8").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let para = [];
  const flush = () => {
    if (para.length) blocks.push({ kind: "para", text: para.join(" ") });
    para = [];
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (/^<!--.*-->$/.test(line)) continue;
    if (!line) { flush(); continue; }
    let m;
    if ((m = line.match(/^#\s+(.*)$/))) { flush(); blocks.push({ kind: "title", text: m[1] }); }
    else if ((m = line.match(/^##\s+(.*)$/))) { flush(); blocks.push({ kind: "heading", text: m[1] }); }
    else if ((m = line.match(/^[-*]\s+(.*)$/))) { flush(); blocks.push({ kind: "bullet", text: m[1] }); }
    else if ((m = line.match(/^(\d+)\.\s+(.*)$/))) { flush(); blocks.push({ kind: "number", n: m[1], text: m[2] }); }
    else para.push(line);
  }
  flush();
  if (!blocks.length || blocks[0].kind !== "title") throw new Error(`${file}: must start with a "# Title" line`);
  return blocks;
}

// ---------------------------------------------------------------------------
// PDF writer (PDF 1.4, standard Helvetica fonts, WinAnsi encoding, Flate streams)
// ---------------------------------------------------------------------------

// Helvetica advance widths (AFM, 1/1000 em) for ASCII 32..126.
const HELV = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584];
const WINANSI_EXTRA = { "\u2013": 0x96, "\u2014": 0x97, "\u2018": 0x91, "\u2019": 0x92, "\u201c": 0x93, "\u201d": 0x94, "\u2022": 0x95, "\u2026": 0x85, "\u20ac": 0x80 };

function winAnsi(text) {
  const bytes = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp >= 0x20 && cp <= 0x7e) bytes.push(cp);
    else if (cp >= 0xa0 && cp <= 0xff) bytes.push(cp);
    else if (WINANSI_EXTRA[ch] !== undefined) bytes.push(WINANSI_EXTRA[ch]);
    else throw new Error(`Character ${JSON.stringify(ch)} (U+${cp.toString(16)}) is not supported by the PDF fixture font`);
  }
  return Buffer.from(bytes);
}

function textWidth(text, size, bold) {
  let w = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    w += cp >= 32 && cp <= 126 ? HELV[cp - 32] : 556;
  }
  return (w / 1000) * size * (bold ? 1.08 : 1);
}

function wrap(text, maxWidth, size, bold) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && textWidth(next, size, bold) > maxWidth) { out.push(line); line = word; }
    else line = next;
  }
  if (line) out.push(line);
  return out;
}

function pdfString(text) {
  // Literal string with (, ) and \ escaped; bytes are WinAnsi.
  const b = winAnsi(text);
  const parts = [];
  for (const byte of b) {
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) parts.push(0x5c);
    parts.push(byte);
  }
  return Buffer.concat([Buffer.from("("), Buffer.from(parts), Buffer.from(")")]);
}

/** Assemble a PDF from object bodies (Buffers); object 1 must be the catalog. */
function assemblePdf(objects, infoRef) {
  const chunks = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
  let offset = chunks[0].length;
  const offsets = [];
  objects.forEach((body, i) => {
    const buf = Buffer.concat([Buffer.from(`${i + 1} 0 obj\n`), body, Buffer.from("\nendobj\n")]);
    offsets.push(offset);
    chunks.push(buf);
    offset += buf.length;
  });
  const xref = [`xref\n0 ${objects.length + 1}\n`, "0000000000 65535 f \n", ...offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`)].join("");
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R${infoRef ? ` /Info ${infoRef} 0 R` : ""} >>\nstartxref\n${offset}\n%%EOF\n`;
  chunks.push(Buffer.from(xref + trailer));
  return Buffer.concat(chunks);
}

function streamObject(content, extraDict = "") {
  const data = zlib.deflateSync(content, { level: 9 });
  return Buffer.concat([Buffer.from(`<< /Length ${data.length} /Filter /FlateDecode${extraDict} >>\nstream\n`), data, Buffer.from("\nendstream")]);
}

function infoObject(title) {
  return Buffer.concat([
    Buffer.from("<< /Title "), pdfString(title),
    Buffer.from(" /Author (Dito Learn synthetic fixture generator) /Subject (Synthetic test material - fictional content)"),
    Buffer.from(" /Producer (scripts/generate-document-fixtures.mjs) /CreationDate (D:20240101000000Z) /ModDate (D:20240101000000Z) >>"),
  ]);
}

/**
 * @param blocks parsed source
 * @param opts.padColumns pad every rendered line with trailing spaces to this many characters,
 *   like fixed-width text-to-PDF exports do. The spaces are invisible but are part of the
 *   page's text, so a parser extracts them (and lesson-text normalization removes them).
 */
export function buildLessonPdf(blocks, opts = {}) {
  const W = 595, H = 842, M = 64, maxW = W - 2 * M;
  const styles = {
    title: { font: "F2", size: 20, lead: 26, before: 0, after: 8 },
    heading: { font: "F2", size: 13.5, lead: 18, before: 12, after: 4 },
    para: { font: "F1", size: 11, lead: 15.5, before: 0, after: 8 },
    bullet: { font: "F1", size: 11, lead: 15.5, before: 0, after: 3, indent: 16 },
    number: { font: "F1", size: 11, lead: 15.5, before: 0, after: 3, indent: 16 },
  };
  const pages = [];
  let ops = [];
  let y = H - M;
  const newPage = () => { pages.push(ops); ops = []; y = H - M; };
  for (const block of blocks) {
    const st = styles[block.kind];
    const bold = st.font === "F2";
    const indent = st.indent || 0;
    const lines = wrap(block.text, maxW - indent, st.size, bold);
    y -= st.before;
    if (y - st.lead * Math.min(lines.length, 2) < M + 30) newPage();
    lines.forEach((line, i) => {
      if (y - st.lead < M + 30) newPage();
      y -= st.lead;
      if (i === 0 && (block.kind === "bullet" || block.kind === "number")) {
        const marker = block.kind === "bullet" ? "\u2022" : `${block.n}.`;
        ops.push(Buffer.concat([Buffer.from(`BT /F1 ${st.size} Tf 1 0 0 1 ${M + 2} ${y.toFixed(2)} Tm `), pdfString(marker), Buffer.from(" Tj ET\n")]));
      }
      const shown = opts.padColumns ? line.padEnd(opts.padColumns, " ") : line;
      ops.push(Buffer.concat([Buffer.from(`BT /${st.font} ${st.size} Tf 1 0 0 1 ${M + indent} ${y.toFixed(2)} Tm `), pdfString(shown), Buffer.from(" Tj ET\n")]));
    });
    y -= st.after;
  }
  pages.push(ops);

  // Objects: 1 catalog, 2 pages, 3 F1, 4 F2, 5 info, then (page, content) pairs.
  const objects = [];
  const pageRefs = pages.map((_, i) => 6 + i * 2);
  objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(Buffer.from(`<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pages.length} >>`));
  objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));
  objects.push(infoObject(blocks[0].text));
  pages.forEach((pageOps, i) => {
    const footer = Buffer.concat([Buffer.from(`BT /F1 9 Tf 1 0 0 1 ${M} ${M - 20} Tm `), pdfString(`Synthetic fixture - page ${i + 1} of ${pages.length}`), Buffer.from(" Tj ET\n")]);
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageRefs[i] + 1} 0 R >>`));
    objects.push(streamObject(Buffer.concat([...pageOps, footer])));
  });
  return assemblePdf(objects, 5);
}

/**
 * A PDF with explicit pages: each entry is an array of blocks (one page of
 * content, with a footer), { blocks, footer: false }, or null (a truly blank page: no text, no footer,
 * like the blank versos of a print-ready booklet). Throws if content overflows.
 */
export function buildPagedPdf(pages, title) {
  const W = 595, H = 842, M = 64, maxW = W - 2 * M;
  const styles = {
    title: { font: "F2", size: 16, lead: 21, after: 5 },
    heading: { font: "F2", size: 12, lead: 16, after: 2 },
    para: { font: "F1", size: 10, lead: 12.5, after: 4 },
  };
  const contentCount = pages.filter((pg) => pg && (Array.isArray(pg) || pg.footer !== false)).length;
  let contentNo = 0;
  const pageOps = pages.map((page, pi) => {
    if (!page) return [];
    const blocks = Array.isArray(page) ? page : page.blocks;
    const footer = Array.isArray(page) || page.footer !== false;
    contentNo++;
    const ops = [];
    let y = H - M;
    for (const block of blocks) {
      const st = styles[block.kind];
      for (const line of wrap(block.text, maxW, st.size, st.font === "F2")) {
        y -= st.lead;
        if (y < M + 20) throw new Error(`page ${pi + 1} overflows; shorten its text`);
        ops.push(Buffer.concat([Buffer.from(`BT /${st.font} ${st.size} Tf 1 0 0 1 ${M} ${y.toFixed(2)} Tm `), pdfString(line), Buffer.from(" Tj ET\n")]));
      }
      y -= st.after;
    }
    if (footer) ops.push(Buffer.concat([Buffer.from(`BT /F1 9 Tf 1 0 0 1 ${M} ${M - 20} Tm `), pdfString(`Synthetic fixture - content page ${contentNo} of ${contentCount}`), Buffer.from(" Tj ET\n")]));
    return ops;
  });
  const objects = [];
  const pageRefs = pageOps.map((_, i) => 6 + i * 2);
  objects.push(Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"));
  objects.push(Buffer.from(`<< /Type /Pages /Kids [${pageRefs.map((r) => `${r} 0 R`).join(" ")}] /Count ${pageOps.length} >>`));
  objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>"));
  objects.push(Buffer.from("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"));
  objects.push(infoObject(title));
  pageOps.forEach((ops, i) => {
    objects.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${pageRefs[i] + 1} 0 R >>`));
    objects.push(streamObject(Buffer.concat(ops)));
  });
  return assemblePdf(objects, 5);
}

export const BOOKLET_LAST_PAGE_TEXT = "Back cover - end of the archive.";
export const BOOKLET_CONTENT_PAGES = 20;
export const BOOKLET_PADDING_PAGES = 10;

/**
 * Print-ready booklet, 51 pages: 20 content pages each followed by a blank
 * verso (pages 1-40), 10 blank padding pages (41-50, as printers add to reach
 * a whole signature), and a back cover with one short line and no footer (51).
 * The last content page is padded so the *normalized* extracted text is
 * exactly `targetChars`. Blank pages add newlines that normalization removes,
 * so the raw extraction of pages 1-50 is over the 60,000 limit even when the
 * normalized document is not — the case the parser must not cut short.
 */
export async function buildBooklet(targetChars, recorded) {
  // Every paragraph and list item of the PDF lesson source, reused in a cycle.
  const pool = parseSource(path.join(SRC, "valid-lesson-pdf.md")).filter((b) => b.kind !== "title" && b.kind !== "heading").map((b) => b.text);
  const title = "The Salt Glass Archive of Mereth (print-ready booklet with blank pages)";
  const make = (extra, perPage) => {
    const pages = [];
    for (let c = 1; c <= BOOKLET_CONTENT_PAGES; c++) {
      const blocks = c === 1 ? [{ kind: "title", text: title }] : [];
      blocks.push({ kind: "heading", text: `Ledger ${c} of ${BOOKLET_CONTENT_PAGES}` });
      let used = 0;
      for (let k = 0; used < perPage; k++) {
        const text = pool[(c * 7 + k) % pool.length];
        const room = perPage - used;
        blocks.push({ kind: "para", text: text.length <= room ? text : text.slice(0, room).replace(/\s+\S*$/, "") + "." });
        used += Math.min(text.length, room) + 2;
      }
      if (c === BOOKLET_CONTENT_PAGES && extra > 0) {
        const filler = "The archivists of Mereth copied every ledger twice, once in ink and once in salt glass. ";
        // Exactly `extra` characters; never end on a space (it would be trimmed and skip a length).
        const cut = filler.repeat(Math.ceil(extra / filler.length) + 1).slice(0, extra);
        blocks.push({ kind: "para", text: cut.endsWith(" ") ? `${cut.slice(0, -1)}.` : cut });
      }
      pages.push(blocks, null); // content page + blank verso
    }
    for (let b = 0; b < BOOKLET_PADDING_PAGES; b++) pages.push(null);
    pages.push({ blocks: [{ kind: "para", text: BOOKLET_LAST_PAGE_TEXT }], footer: false });
    return buildPagedPdf(pages, title);
  };
  // --check: rebuild from the recorded layout; deterministic, no parsing.
  if (recorded) return { pdf: make(recorded.extra, recorded.perPage), tuning: recorded };

  const { PDFParse } = await import("pdf-parse");
  const extract = async (pdf, range = {}) => {
    const parser = new PDFParse({ data: new Uint8Array(pdf) });
    try {
      return (await parser.getText({ pageJoiner: "", ...range })).text;
    } finally {
      await parser.destroy();
    }
  };
  // 1) Size the pages from a measured first pass, leaving ~300 characters;
  // 2) tune the filler on the last content page until the normalized text is exactly the target.
  const firstBudget = Math.floor((targetChars - 3000) / BOOKLET_CONTENT_PAGES);
  const firstPass = normalizeLessonText(await extract(make(0, firstBudget))).length;
  const perPage = firstBudget + Math.floor((targetChars - firstPass - 300) / BOOKLET_CONTENT_PAGES);
  let extra = 0;
  for (let attempt = 0; attempt < 40; attempt++) {
    const pdf = make(extra, perPage);
    const normalized = normalizeLessonText(await extract(pdf)).length;
    if (process.env.BOOKLET_DEBUG) console.error(`target ${targetChars} extra ${extra} -> ${normalized}`);
    if (normalized === targetChars) {
      const rawFirst50 = (await extract(pdf, { first: 1, last: 2 * BOOKLET_CONTENT_PAGES + BOOKLET_PADDING_PAGES })).length;
      if (rawFirst50 <= 60_000) throw new Error(`booklet: raw extraction of pages 1-50 is only ${rawFirst50}; the fixture would not exercise the raw-vs-normalized case`);
      return { pdf, normalized, rawFirst50, tuning: { perPage, extra } };
    }
    extra += targetChars - normalized;
    if (extra < 0) throw new Error("booklet: base content already exceeds the target; use fewer paragraphs");
  }
  throw new Error(`booklet: could not reach exactly ${targetChars} normalized characters`);
}

/** A valid PDF whose only page content is a raster image: no extractable text (like a scan). */
export function buildImageOnlyPdf() {
  const w = 120, h = 160;
  const px = Buffer.alloc(w * h);
  for (let yy = 0; yy < h; yy++) {
    for (let xx = 0; xx < w; xx++) {
      // Paper-grey background with dark "handwriting" bars, so it looks like a scanned page.
      const bar = yy % 16 < 3 && xx > 10 && xx < 110 - ((yy * 7) % 40);
      px[yy * w + xx] = bar ? 60 : 235 - ((xx + yy) % 9);
    }
  }
  const objects = [
    Buffer.from("<< /Type /Catalog /Pages 2 0 R >>"),
    Buffer.from("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    Buffer.from("<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im1 5 0 R >> >> /Contents 4 0 R >>"),
    streamObject(Buffer.from("q 467 0 0 622 64 110 cm /Im1 Do Q\n")),
    streamObject(px, ` /Type /XObject /Subtype /Image /Width ${w} /Height ${h} /ColorSpace /DeviceGray /BitsPerComponent 8`),
    infoObject("Scanned worksheet (image only, no text layer)"),
  ];
  return assemblePdf(objects, 6);
}

// ---------------------------------------------------------------------------
// ZIP writer (deflate, fixed timestamps) + DOCX (WordprocessingML)
// ---------------------------------------------------------------------------

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

export function zip(entries) {
  const DOS_TIME = 0, DOS_DATE = (0 << 9) | (1 << 5) | 1; // 1980-01-01 00:00
  const locals = [], centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const nameBuf = Buffer.from(name, "utf-8");
    const comp = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10); local.writeUInt16LE(DOS_DATE, 12); local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(nameBuf.length, 26); local.writeUInt16LE(0, 28);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(0, 8);
    central.writeUInt16LE(8, 10); central.writeUInt16LE(DOS_TIME, 12); central.writeUInt16LE(DOS_DATE, 14); central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, comp);
    centrals.push(central, nameBuf);
    offset += local.length + nameBuf.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const xmlEscape = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const W_NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

export function buildLessonDocx(blocks, extraEntries = []) {
  const run = (text) => `<w:r><w:t xml:space="preserve">${xmlEscape(text)}</w:t></w:r>`;
  const para = (b) => {
    switch (b.kind) {
      case "title": return `<w:p><w:pPr><w:pStyle w:val="Title"/></w:pPr>${run(b.text)}</w:p>`;
      case "heading": return `<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr>${run(b.text)}</w:p>`;
      case "bullet": return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>${run(b.text)}</w:p>`;
      case "number": return `<w:p><w:pPr><w:pStyle w:val="ListParagraph"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>${run(b.text)}</w:p>`;
      default: return `<w:p>${run(b.text)}</w:p>`;
    }
  };
  const document = `${XML}<w:document ${W_NS}><w:body>${blocks.map(para).join("")}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const style = (id, name, rpr, ppr = "", extra = "") => `<w:style w:type="paragraph" w:styleId="${id}"${extra}><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/>${ppr}<w:rPr>${rpr}</w:rPr></w:style>`;
  const styles = `${XML}<w:styles ${W_NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:lang w:val="en-GB"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="259" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>`
    + `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>`
    + style("Title", "Title", '<w:b/><w:sz w:val="48"/>', '<w:pPr><w:spacing w:after="240"/></w:pPr>')
    + style("Heading1", "heading 1", '<w:b/><w:color w:val="4B2E83"/><w:sz w:val="30"/>', '<w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="0"/></w:pPr>')
    + style("ListParagraph", "List Paragraph", "", '<w:pPr><w:ind w:left="720"/><w:contextualSpacing/></w:pPr>')
    + `</w:styles>`;
  const lvl = (fmt, text, font) => `<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}"/></w:rPr>` : ""}</w:lvl>`;
  const numbering = `${XML}<w:numbering ${W_NS}><w:abstractNum w:abstractNumId="0">${lvl("bullet", "\u2022", "Calibri")}</w:abstractNum><w:abstractNum w:abstractNumId="1">${lvl("decimal", "%1.")}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`;
  const contentTypes = `${XML}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const docRels = `${XML}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/></Relationships>`;
  const core = `${XML}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(blocks[0].text)}</dc:title><dc:subject>Synthetic test material - fictional content</dc:subject><dc:creator>Dito Learn synthetic fixture generator</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">2024-01-01T00:00:00Z</dcterms:modified></cp:coreProperties>`;
  const app = `${XML}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Dito Learn fixture generator</Application></Properties>`;
  return zip([
    { name: "[Content_Types].xml", data: Buffer.from(contentTypes) },
    { name: "_rels/.rels", data: Buffer.from(rels) },
    { name: "docProps/core.xml", data: Buffer.from(core) },
    { name: "docProps/app.xml", data: Buffer.from(app) },
    { name: "word/document.xml", data: Buffer.from(document) },
    { name: "word/_rels/document.xml.rels", data: Buffer.from(docRels) },
    { name: "word/styles.xml", data: Buffer.from(styles) },
    { name: "word/numbering.xml", data: Buffer.from(numbering) },
    ...extraEntries,
  ]);
}

// ---------------------------------------------------------------------------
// PNG (for the "unsupported image" and "binary disguised as text" fixtures)
// ---------------------------------------------------------------------------

export function buildPng() {
  const w = 32, h = 32;
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2; // 8-bit RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0; // filter: none
    for (let x = 0; x < w; x++) {
      const o = y * (w * 3 + 1) + 1 + x * 3;
      raw[o] = 120 + x * 4; raw[o + 1] = 60 + y * 5; raw[o + 2] = 200;
    }
  }
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw, { level: 9 })), chunk("IEND", Buffer.alloc(0))]);
}

// ---------------------------------------------------------------------------

/** The source repeated until it is well over the 60,000-character lesson limit. */
export function repeatForLength(blocks, title, times) {
  const body = blocks.slice(1);
  const out = [{ kind: "title", text: title }];
  for (let i = 1; i <= times; i++) out.push({ kind: "heading", text: `Part ${i}` }, ...body);
  return out;
}

/** A valid DOCX padded (with an incompressible, unused ZIP entry) to exactly `size` bytes. */
export function buildPaddedDocx(blocks, size) {
  const base = buildLessonDocx(blocks);
  // Each stored-as-deflate entry adds headers; find the padding length that hits `size` exactly.
  let pad = Math.max(0, size - base.length - 200);
  for (let attempt = 0; attempt < 50; attempt++) {
    const noise = Buffer.alloc(pad);
    let x = 0x12345678;
    for (let i = 0; i < pad; i++) { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; noise[i] = x & 0xff; }
    const out = buildLessonDocx(blocks, [{ name: "customXml/padding.bin", data: noise }]);
    if (out.length === size) return out;
    pad += size - out.length;
  }
  throw new Error("could not pad DOCX to the exact size");
}

const sha256 = (file) => crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

/**
 * @param opts.tune true: tune the booklets (slow: parses them repeatedly) and
 *   return the tuning to record; false: use the recorded tuning (fast).
 */
export async function buildAll({ tune = true } = {}) {
  let recorded = null;
  if (!tune) {
    if (!fs.existsSync(TUNING_FILE)) throw new Error(`${path.relative(ROOT, TUNING_FILE)} is missing: run npm run fixtures:documents`);
    recorded = JSON.parse(fs.readFileSync(TUNING_FILE, "utf-8"));
  }
  const atLimit = await buildBooklet(60_000, recorded?.["60000"]);
  const overLimit = await buildBooklet(60_001, recorded?.["60001"]);
  const tuning = {
    _comment: "Written by npm run fixtures:documents. Layout that makes the blank-pages booklets normalize to exactly 60,000 / 60,001 characters; --check rebuilds from it without parsing.",
    source: "valid-lesson-pdf.md",
    sourceSha256: sha256(path.join(SRC, "valid-lesson-pdf.md")),
    60000: atLimit.tuning,
    60001: overLimit.tuning,
  };
  const pdfBlocks = parseSource(path.join(SRC, "valid-lesson-pdf.md"));
  const docxBlocks = parseSource(path.join(SRC, "valid-lesson-docx.md"));
  const pdf = buildLessonPdf(pdfBlocks);
  const docx = buildLessonDocx(docxBlocks);
  const png = buildPng();
  const plain = fs.readFileSync(path.join(DIR, "valid-lesson.txt"), "utf-8");
  const files = {
    // Same lesson text saved in encodings other than UTF-8 (as older editors do).
    "not-utf8-windows-1252.txt": Buffer.from(plain, "latin1"),
    "not-utf8-utf16.txt": Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(plain, "utf16le")]),
    // Genuine documents with more text than one lesson may contain (small on disk).
    "too-long-text.docx": buildLessonDocx(repeatForLength(docxBlocks, "The Complete Chronicles of Dunmere (too long for one lesson)", 25)),
    "too-long-text.pdf": buildLessonPdf(repeatForLength(pdfBlocks, "The Complete Vellmark Field Guide (too long for one lesson)", 25)),
    // Blank pages make the raw extraction longer than the normalized text: exactly at / one over the limit.
    "blank-pages-at-limit.pdf": atLimit.pdf,
    "blank-pages-over-limit.pdf": overLimit.pdf,
    "valid-lesson.pdf": pdf,
    "valid-lesson.docx": docx,
    // Cut partway through (as after an interrupted download). The header is intact,
    // so these pass a signature check and must be caught when parsing.
    "damaged-truncated.pdf": pdf.subarray(0, Math.floor(pdf.length * 0.45)),
    "damaged-truncated.docx": docx.subarray(0, Math.floor(docx.length * 0.5)),
    "no-text-scanned.pdf": buildImageOnlyPdf(),
    "unsupported-image.png": png,
    // Real PNG bytes with a .txt name: must not be accepted as lesson text.
    "unsupported-binary-disguised.txt": png,
  };
  return { files, tuning, recorded };
}

function writeOversized(target) {
  const paragraph = fs.readFileSync(path.join(DIR, "valid-lesson.txt"), "utf-8");
  fs.mkdirSync(GENERATED, { recursive: true });
  const file = path.join(GENERATED, "oversized-lesson.txt");
  const fd = fs.openSync(file, "w");
  let written = 0;
  const block = Buffer.from(paragraph + "\n\n");
  while (written < target) {
    const part = block.subarray(0, Math.min(block.length, target - written));
    fs.writeSync(fd, part);
    written += part.length;
  }
  fs.closeSync(fd);
  console.log(`wrote ${path.relative(ROOT, file)} (${written} bytes; limit is ${MAX_UPLOAD_BYTES})`);
}

async function main() {
const args = process.argv.slice(2);
const oversized = args.find((a) => a.startsWith("--oversized"));
if (args.includes("--at-limit")) {
  const out = buildPaddedDocx(parseSource(path.join(SRC, "valid-lesson-docx.md")), MAX_UPLOAD_BYTES);
  fs.mkdirSync(GENERATED, { recursive: true });
  const file = path.join(GENERATED, "at-size-limit.docx");
  fs.writeFileSync(file, out);
  console.log(`wrote ${path.relative(ROOT, file)} (${out.length} bytes = exactly the ${MAX_UPLOAD_BYTES / 1048576} MiB limit)`);
} else if (oversized) {
  const arg = oversized.split("=")[1];
  const bytes = arg ? Math.round(Number(arg) * 1024 * 1024) : MAX_UPLOAD_BYTES + 1;
  if (!(bytes > 0)) throw new Error("--oversized=<MiB> must be a positive number");
  writeOversized(bytes);
} else {
  const check = args.includes("--check");
  const { files, tuning, recorded } = await buildAll({ tune: !check });
  let stale = 0;
  if (check && recorded.sourceSha256 !== tuning.sourceSha256) {
    stale++;
    console.error("stale: source/booklet-tuning.json (source/valid-lesson-pdf.md changed since the booklets were tuned)");
  }
  for (const [name, buf] of Object.entries(files)) {
    const file = path.join(DIR, name);
    if (check) {
      const same = fs.existsSync(file) && Buffer.compare(fs.readFileSync(file), buf) === 0;
      if (!same) { stale++; console.error(`stale: ${name}`); }
    } else {
      fs.writeFileSync(file, buf);
      console.log(`wrote ${path.relative(ROOT, file)} (${buf.length} bytes)`);
    }
  }
  if (!check) {
    fs.writeFileSync(TUNING_FILE, JSON.stringify(tuning, null, 2) + "\n");
    console.log(`wrote ${path.relative(ROOT, TUNING_FILE)}`);
  }
  if (check) {
    if (stale) { console.error(`${stale} fixture(s) out of date: run npm run fixtures:documents`); process.exit(1); }
    console.log("document fixtures are up to date");
  }
}
}

// Run only when executed directly (tests import the builders).
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
