#!/usr/bin/env node
// Many students at once, against a running server, then verify every record.
//
//   MOCK_GENERATION_DELAY_MS=1500 npm start        # realistic AI latency in mock mode
//   npm run load-test -- 100                      # 100 students (default 60)
//   BASE_URL=http://localhost:3000 DATA_DIR=./data npm run load-test
//
// Creates its own classroom + lesson (nothing generated yet), then in bursts:
//   1. all students join with the code (typed in different ways)
//   2. all open the lesson and 3 random formats (formats generate on first open)
//   3. all study at once: flashcard saves delivered OUT OF ORDER, every
//      "I got this" sent 3x, tutor questions, messages to the professor
// and checks each student's records, the event log and the teacher totals.
// Uses synthetic students only; run it against a test/demo data directory.

import fs from "fs";
import path from "path";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DATA = path.resolve(process.env.DATA_DIR || process.env.DITO_DATA_DIR || "data");
const N = Number(process.argv[2]) || 60;
const FORMATS = ["mindmap", "flashcards", "story_slides", "podcast", "story_audio", "game", "video", "song"];

let seed = 42;
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const pick = (xs) => xs[Math.floor(rand() * xs.length)];
const sample = (xs, k) => [...xs].sort(() => rand() - 0.5).slice(0, k);
const shuffle = (xs) => xs.sort(() => rand() - 0.5);

const statuses = {};
let retries = 0;
const failures = [];
const expect = (ok, msg) => ok || failures.push(msg);

// Like the app (and a student tapping again): if the connection is refused
// because the server is swamped, try again. Retries are counted and reported;
// the verification below would catch anything recorded twice.
async function call(method, url, body) {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetch(BASE + url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      statuses[res.status] = (statuses[res.status] || 0) + 1;
      return { status: res.status, json: await res.json().catch(() => ({})) };
    } catch (err) {
      if (attempt >= 8) throw err;
      retries++;
      await new Promise((r) => setTimeout(r, 200 * (attempt + 1) + Math.random() * 300));
    }
  }
}

// Each student is a browser: at most 6 requests in flight per student (browser limit).
async function asBrowser(tasks, limit = 6) {
  const out = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, tasks.length) }, async () => {
      while (next < tasks.length) {
        const i = next++;
        out[i] = await tasks[i]();
      }
    })
  );
  return out;
}

// Same fingerprint as src/lib/progressShared.ts flashcardDeckKey.
function deckKey(cards) {
  const text = cards.map((c) => `${c.question}\u0000${c.answer}`).join("\u0001");
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${cards.length}-${h.toString(16).padStart(8, "0")}`;
}

const readLines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf-8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);

const t0 = Date.now();
// ---------- professor: a class and a lesson with nothing generated ----------
const { json: c } = await call("POST", "/api/classrooms", { name: "Load Test", subject: "Biology", professor_name: "Prof Load" });
const cid = c.classroom.id;
const code = c.classroom.join_code;
const form = new FormData();
form.append("text", fs.readFileSync(new URL("../sample-docs/photosynthesis.txt", import.meta.url), "utf-8"));
const lid = (await (await fetch(`${BASE}/api/classrooms/${cid}/lessons`, { method: "POST", body: form })).json()).lesson.id;
console.log(`class ${code}, lesson ${lid.slice(0, 8)}, ${N} students`);

// ---------- 1. everyone joins at once ----------
const typed = () => pick([code, code.toLowerCase(), ` ${code.slice(0, 3)} ${code.slice(3)} `, `${code.slice(0, 3)}-${code.slice(3)}`]);
const joins = await Promise.all(
  Array.from({ length: N }, (_, i) => call("POST", "/api/students", { name: `Student ${String(i).padStart(3, "0")}`, join_code: typed(), interests: ["Science"] }))
);
const students = joins.filter((r) => r.status === 200 && r.json.classroom_id === cid).map((r) => r.json.student);
expect(students.length === N, `only ${students.length}/${N} joined`);
console.log(`1. ${students.length}/${N} joined at the same time`);

// ---------- 2. everyone opens the lesson and 3 formats at once ----------
const opened = new Map(students.map((s) => [s.id, sample(FORMATS, 3)]));
const versions = {};
await Promise.all(
  students.flatMap((s) => [
    call("GET", `/api/lessons/${lid}/progress?student_id=${s.id}`).then((r) => expect(r.status === 200, `progress ${r.status}`)),
    call("POST", "/api/events", { classroom_id: cid, student_id: s.id, student_name: s.name, lesson_id: lid, type: "lesson_open" }),
    ...opened.get(s.id).map((f) =>
      call("POST", `/api/projects/${lid}/generate`, { type: f }).then((r) => {
        expect(r.status === 200, `generate ${f}: ${r.status} ${JSON.stringify(r.json)}`);
        (versions[f] ||= new Set()).add(JSON.stringify(r.json.data));
      })
    ),
  ])
);
let lesson = (await call("GET", `/api/projects/${lid}`)).json;
lesson = lesson.project || lesson;
const wanted = new Set([...opened.values()].flat());
const saved = new Set(Object.keys(lesson.outputs));
const lost = [...wanted].filter((f) => !saved.has(f));
expect(lost.length === 0, `formats lost: ${lost.join(", ")}`);
for (const [f, v] of Object.entries(versions)) expect(v.size === 1, `${f}: students received ${v.size} different versions`);
console.log(`2. formats opened ${wanted.size}, saved ${[...wanted].filter((f) => saved.has(f)).length}; one version per format: ${Object.values(versions).every((v) => v.size === 1)}`);

if (!lesson.outputs.flashcards) {
  await call("POST", `/api/projects/${lid}/generate`, { type: "flashcards" });
  lesson = (await call("GET", `/api/projects/${lid}`)).json;
  lesson = lesson.project || lesson;
}
const cards = lesson.outputs.flashcards.cards;
const dk = deckKey(cards);

// ---------- 3. everyone studies at once ----------
const expected = new Map();
const perStudent = new Map();
let tasks = [];
for (const s of students) {
  tasks = [];
  perStudent.set(s.id, tasks);
  const known = new Set();
  const review = new Set();
  const snaps = [];
  let idx = 0;
  const steps = 3 + Math.floor(rand() * 7);
  for (let k = 0; k < steps; k++) {
    if (rand() < 0.7) { known.add(idx); review.delete(idx); } else { review.add(idx); known.delete(idx); }
    idx = (idx + 1) % cards.length;
    snaps.push({ deck_key: dk, current_index: idx, known: [...known].sort((a, b) => a - b), review: [...review].sort((a, b) => a - b) });
  }
  const base = Date.now();
  shuffle(snaps.map((fc, k) => ({ rev: base + k, fc }))).forEach(({ rev, fc }) =>
    tasks.push(() => call("PUT", `/api/lessons/${lid}/progress`, { student_id: s.id, rev, flashcards: fc }))
  );
  const done = sample(FORMATS, 1 + Math.floor(rand() * 5));
  for (const f of done) for (let k = 0; k < 3; k++) tasks.push(() => call("POST", `/api/lessons/${lid}/progress/complete`, { student_id: s.id, modality: f }));
  const questions = Array.from({ length: Math.floor(rand() * 3) }, (_, k) => `${s.name}: what does chlorophyll do? #${k}`);
  for (const q of questions) tasks.push(() => call("POST", `/api/lessons/${lid}/chat`, { question: q, classroom_id: cid, student_id: s.id, student_name: s.name, history: [] }));
  const dm = `Hi professor, this is ${s.name}`;
  tasks.push(() => call("POST", `/api/classrooms/${cid}/students/${s.id}/messages`, { text: dm, sender: "student" }));
  expected.set(s.id, { fc: snaps[snaps.length - 1], done: new Set(done), questions, dm });
}
// All students at the same moment, each with its own requests in shuffled order.
const results = (await Promise.all([...perStudent.values()].map((ts) => asBrowser(shuffle(ts))))).flat();
results.forEach((r) => expect(r.status === 200, `study request ${r.status} ${JSON.stringify(r.json)}`));
console.log(`3. ${results.length} study requests, all students at once (saves out of order, each completion sent 3x, questions, messages)`);

// ---------- verify ----------
const events = readLines(path.join(DATA, "events.jsonl")).filter((e) => e.classroom_id === cid);
const messages = readLines(path.join(DATA, "messages.jsonl")).filter((m) => m.classroom_id === cid);
const analytics = (await call("GET", `/api/classrooms/${cid}/analytics`)).json;
const teacherView = new Map(analytics.per_student.map((p) => [p.student_id, p]));
const ok = { fc: 0, done: 0, q: 0, dm: 0 };
for (const s of students) {
  const e = expected.get(s.id);
  const p = (await call("GET", `/api/lessons/${lid}/progress?student_id=${s.id}`)).json.progress;
  const fc = p.flashcards && { deck_key: p.flashcards.deck_key, current_index: p.flashcards.current_index, known: p.flashcards.known, review: p.flashcards.review };
  if (JSON.stringify(fc) === JSON.stringify(e.fc)) ok.fc++;
  else failures.push(`${s.name}: flashcards ${JSON.stringify(fc)} != ${JSON.stringify(e.fc)}`);
  const logged = events.filter((x) => x.type === "modality_complete" && x.student_id === s.id).length;
  const sameSet = Object.keys(p.completed).length === e.done.size && Object.keys(p.completed).every((m) => e.done.has(m));
  if (sameSet && logged === e.done.size && teacherView.get(s.id)?.completions === e.done.size) ok.done++;
  else failures.push(`${s.name}: completed ${Object.keys(p.completed)} (log ${logged}) != ${[...e.done]}`);
  const asked = events.filter((x) => x.type === "question" && x.student_id === s.id).map((x) => x.text).sort();
  if (JSON.stringify(asked) === JSON.stringify([...e.questions].sort())) ok.q++;
  else failures.push(`${s.name}: questions mismatch`);
  if (JSON.stringify(messages.filter((m) => m.student_id === s.id).map((m) => m.text)) === JSON.stringify([e.dm])) ok.dm++;
  else failures.push(`${s.name}: message mismatch`);
}
const total = [...expected.values()].reduce((n, e) => n + e.done.size, 0);
expect(analytics.completions === total, `class completions ${analytics.completions} != ${total}`);

let broken = 0;
const walk = (dir) => {
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const fp = path.join(dir, f.name);
    if (f.isDirectory()) walk(fp);
    else if (f.name.endsWith(".tmp")) broken++;
    else if (f.name.endsWith(".json")) { try { JSON.parse(fs.readFileSync(fp, "utf-8")); } catch { broken++; } }
  }
};
walk(DATA);
expect(broken === 0, `${broken} corrupt/half-written files`);

console.log(`\nVerified ${students.length} students:`);
console.log(`  flashcard progress = latest answer ............. ${ok.fc}/${students.length}`);
console.log(`  completions recorded exactly once .............. ${ok.done}/${students.length}  (class total ${analytics.completions}, expected ${total})`);
console.log(`  tutor questions recorded ....................... ${ok.q}/${students.length}`);
console.log(`  messages to professor recorded ................. ${ok.dm}/${students.length}`);
console.log(`  corrupt or half-written files .................. ${broken}`);
console.log(`  HTTP statuses ${JSON.stringify(statuses)}, connection retries ${retries}, in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
console.log(failures.length ? `\nFAILED (${failures.length}):\n  ${failures.slice(0, 10).join("\n  ")}` : "\nALL RECORDS CORRECT");
process.exit(failures.length ? 1 : 0);
