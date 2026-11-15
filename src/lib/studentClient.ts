"use client";

import { OutputType } from "./types";

// Lightweight client-side student identity (no passwords for the MVP).
const KEY = "dito_student";

export interface LocalStudent {
  id: string;
  name: string;
}

export function getLocalStudent(): LocalStudent | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as LocalStudent) : null;
  } catch {
    return null;
  }
}

export function setLocalStudent(s: LocalStudent): void {
  localStorage.setItem(KEY, JSON.stringify(s));
}

export function clearLocalStudent(): void {
  localStorage.removeItem(KEY);
}

// Fire-and-forget event logging that feeds the professor's observability dashboard.
export function track(params: {
  classroom_id: string;
  student_id: string;
  student_name: string;
  type: "lesson_open" | "modality_open" | "modality_complete" | "question" | "game_result";
  lesson_id?: string;
  modality?: OutputType;
  value?: number;
  text?: string;
}): void {
  try {
    fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(params),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}
