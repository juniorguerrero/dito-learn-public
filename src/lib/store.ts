import fs from "fs";
import path from "path";
import { Project } from "./types";

// Simple filesystem JSON store — perfect for a hackathon MVP.
// Swap for Supabase later without touching the API surface.

const DATA_DIR = path.join(process.cwd(), "data", "projects");

function ensureDir() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export function saveProject(project: Project): void {
  ensureDir();
  fs.writeFileSync(
    path.join(DATA_DIR, `${project.id}.json`),
    JSON.stringify(project, null, 2)
  );
}

export function getProject(id: string): Project | null {
  // Guard against path traversal in the id
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  const file = path.join(DATA_DIR, `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Project;
}

export function listProjects(): Project[] {
  ensureDir();
  return fs
    .readdirSync(DATA_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(DATA_DIR, f), "utf-8")) as Project)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
