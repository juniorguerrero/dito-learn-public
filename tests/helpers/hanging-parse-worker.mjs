// Test double for src/workers/parse-document.worker.mjs: a parser stuck in a
// CPU-bound loop that never yields. It appends a heartbeat byte to
// HANG_HEARTBEAT_FILE every ~20 ms so a test can prove the loop really stopped.
import fs from "node:fs";
const file = process.env.HANG_HEARTBEAT_FILE;
let last = 0;
for (;;) {
  const now = Date.now();
  if (file && now - last >= 20) {
    fs.appendFileSync(file, ".");
    last = now;
  }
}
