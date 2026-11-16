import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

// Root of the filesystem JSON store. Defaults to ./data (unchanged behavior);
// DITO_DATA_DIR lets tests point the store at an isolated temp directory.
// Resolved on every call so it can never be captured at import time.
export function dataRoot(): string {
  const override = process.env.DITO_DATA_DIR;
  return override ? path.resolve(override) : path.join(process.cwd(), "data");
}

/**
 * Write JSON so readers never see a half-written file (temp file + rename is
 * atomic on the same filesystem). Used for every record in the store.
 */
export function writeJsonAtomic(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}
