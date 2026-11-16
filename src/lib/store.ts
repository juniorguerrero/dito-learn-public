import fs from "fs";
import path from "path";
import { Project } from "./types";
import { dataRoot, writeJsonAtomic } from "./dataDir";

// Simple filesystem JSON store — perfect for a hackathon MVP.
// Swap for Supabase later without touching the API surface.

const projectsDir = () => path.join(dataRoot(), "projects");

function ensureDir() {
  fs.mkdirSync(projectsDir(), { recursive: true });
}

export function saveProject(project: Project): void {
  ensureDir();
  writeJsonAtomic(path.join(projectsDir(), `${project.id}.json`), project);
}

/**
 * Safe read-modify-write for a lesson shared by many students. Re-reads the
 * current file and applies `mutate` to it, with no await in between, so
 * concurrent requests can't overwrite each other's changes with a stale copy.
 * Do slow work (AI generation) *before* calling this, never inside `mutate`.
 * Returns the saved project, or null if it doesn't exist.
 */
export function updateProject(id: string, mutate: (current: Project) => void): Project | null {
  const current = getProject(id);
  if (!current) return null;
  mutate(current);
  saveProject(current);
  return current;
}

export function getProject(id: string): Project | null {
  // Guard against path traversal in the id
  if (!/^[a-zA-Z0-9-]+$/.test(id)) return null;
  const file = path.join(projectsDir(), `${id}.json`);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, "utf-8")) as Project;
}

export function listProjects(): Project[] {
  ensureDir();
  return fs
    .readdirSync(projectsDir())
    .filter((f) => f.endsWith(".json"))
    .map((f) => JSON.parse(fs.readFileSync(path.join(projectsDir(), f), "utf-8")) as Project)
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
}
