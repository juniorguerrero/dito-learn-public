#!/usr/bin/env node
// Upload smoke test against a *running* Dito Learn server (next dev or next start).
// Unit tests call the route handlers directly; this checks the real runtime,
// including the Next.js bundle (which is where PDF parsing used to break).
//
//   npm run smoke:uploads                        # BASE=http://localhost:3000
//   BASE=http://localhost:3100 npm run smoke:uploads
//
// Creates its own synthetic classroom, uploads every fixture in
// tests/fixtures/documents to both upload routes, and checks each response
// against expected-results.json (and, for accepted files, the stored lesson
// text). Rejected uploads must not add lessons. Prints "<passed>/<total> checks".
// If the on-demand files exist (npm run fixtures:documents -- --at-limit /
// --oversized) the size boundaries are checked over HTTP as well.
// Run it against a server started with a throwaway DITO_DATA_DIR.

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIR = path.join(ROOT, "tests", "fixtures", "documents");
const BASE = (process.env.BASE || "http://localhost:3000").replace(/\/$/, "");
const { _comment, ...EXPECTED } = JSON.parse(fs.readFileSync(path.join(DIR, "expected-results.json"), "utf-8"));

let checks = 0;
let failures = 0;
const check = (ok, label, detail = "") => {
  checks++;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

async function postForm(url, { file, name, text } = {}) {
  const form = new FormData();
  if (file) form.append("file", new Blob([file]), name);
  if (text !== undefined) form.append("text", text);
  const t0 = Date.now();
  try {
    const res = await fetch(url, { method: "POST", body: form });
    const body = await res.json().catch(() => ({}));
    return { status: res.status, body, ms: Date.now() - t0 };
  } catch (err) {
    return { status: 0, body: { error: String(err.cause?.code || err.message) }, ms: Date.now() - t0 };
  }
}

const lessonCount = async (cid) => (await (await fetch(`${BASE}/api/classrooms/${cid}`, { cache: "no-store" })).json()).lessons.length;

const cls = await (
  await fetch(`${BASE}/api/classrooms`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name: `Upload smoke ${new Date().toISOString()}`, subject: "Synthetic Science", professor_name: "Prof. Synthetic" }),
  })
).json();
const cid = cls.classroom.id;
console.log(`server ${BASE}, synthetic classroom ${cid}\n`);

const routes = [
  ["/api/upload", `${BASE}/api/upload`],
  ["/api/classrooms/[id]/lessons", `${BASE}/api/classrooms/${cid}/lessons`],
];

// One check per fixture and route: status/code, lesson count, and for accepted
// files the stored lesson text (contains text from the last page; exact length if given).
for (const [file, expected] of Object.entries(EXPECTED)) {
  const bytes = fs.readFileSync(path.join(DIR, file));
  for (const [label, url] of routes) {
    const before = await lessonCount(cid);
    const r = await postForm(url, { file: bytes, name: file });
    const added = (await lessonCount(cid)) - before;
    const accepted = expected.result === "accepted";
    const expectAdded = accepted && label.includes("classrooms") ? 1 : 0;
    const problems = [];
    if (accepted ? r.status !== 200 : !(r.body.code === expected.result && r.status >= 400 && r.status < 500)) {
      problems.push(`expected ${expected.result}; ${r.body.error ?? ""}`);
    }
    if (added !== expectAdded) problems.push(`lessons added: ${added}`);
    let stored = "";
    if (accepted && r.status === 200) {
      const id = r.body.id ?? r.body.lesson?.id;
      const text = (await (await fetch(`${BASE}/api/projects/${id}`)).json()).document_text ?? "";
      stored = `; stored ${text.length} chars`;
      if (!text.includes(expected.contains)) problems.push("stored text is missing the last page");
      if (expected.chars !== undefined && text.length !== expected.chars) problems.push(`stored ${text.length} chars, expected ${expected.chars}`);
    }
    check(problems.length === 0, `${label.padEnd(29)} ${file.padEnd(33)} → ${r.status} ${r.body.code ?? "ok"}`, `${r.ms} ms${stored}${problems.length ? `; ${problems.join("; ")}` : ""}`);
  }
}

// Pasted text, and file + text together.
const pasted = "Tide Pools of the Glass Coast. Barnacles, anemones and periwinkles live between the high and low water marks.";
for (const [label, url] of routes) {
  const r = await postForm(url, { text: pasted });
  check(r.status === 200, `${label.padEnd(29)} pasted text                        → ${r.status}`);
  const both = await postForm(url, { file: fs.readFileSync(path.join(DIR, "valid-lesson.txt")), name: "valid-lesson.txt", text: pasted });
  check(both.status === 400 && both.body.code === "file_and_text", `${label.padEnd(29)} file + pasted text                 → ${both.status} ${both.body.code}`);
}

// Size boundaries over real HTTP (only if generated on demand).
for (const [file, want] of [["generated/at-size-limit.docx", "accepted"], ["generated/oversized-lesson.txt", "file_too_large"]]) {
  const p = path.join(DIR, file);
  if (!fs.existsSync(p)) {
    console.log(`skip  ${file} (generate with npm run fixtures:documents -- ${file.includes("at-size") ? "--at-limit" : "--oversized"})`);
    continue;
  }
  const r = await postForm(routes[1][1], { file: fs.readFileSync(p), name: path.basename(file) });
  const ok = want === "accepted" ? r.status === 200 : r.body.code === want;
  check(ok, `${routes[1][0].padEnd(29)} ${file.padEnd(33)} → ${r.status} ${r.body.code ?? "ok"}`, `${fs.statSync(p).size} bytes, ${r.ms} ms`);
}
// A request far over the cap is refused from its declared size.
{
  const big = new Uint8Array(12 * 1024 * 1024).fill(0x61);
  const r = await postForm(routes[1][1], { file: big, name: "twelve-mib.txt" });
  check(r.status === 413 && r.body.code === "request_too_large", `${routes[1][0].padEnd(29)} 12 MiB request                     → ${r.status} ${r.body.code ?? r.body.error}`, `${r.ms} ms`);
}

console.log(`\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}`);
process.exit(failures === 0 ? 0 : 1);
