import { FlashcardProgress } from "./types";

// Browser-only flashcard progress for people without a student profile (the
// professor previewing/practising a lesson on /dashboard). Saved per lesson in
// localStorage. The deck fingerprint inside is checked on restore, so a
// regenerated deck starts fresh.

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const localFlashcardsKey = (lessonId: string) => `dito_local_flashcards:${lessonId}`;

export function loadLocalFlashcards(storage: KeyValueStorage | null | undefined, lessonId: string): FlashcardProgress | null {
  if (!storage) return null;
  try {
    const v = JSON.parse(storage.getItem(localFlashcardsKey(lessonId)) || "null") as FlashcardProgress | null;
    const ok =
      v &&
      typeof v.deck_key === "string" &&
      Number.isInteger(v.current_index) &&
      Array.isArray(v.known) &&
      Array.isArray(v.review);
    return ok ? v : null;
  } catch {
    return null; // corrupt value: start fresh
  }
}

/** Returns false if the browser refused to store it (private mode / quota). */
export function saveLocalFlashcards(storage: KeyValueStorage | null | undefined, lessonId: string, fc: FlashcardProgress): boolean {
  if (!storage) return false;
  try {
    storage.setItem(localFlashcardsKey(lessonId), JSON.stringify(fc));
    return true;
  } catch {
    return false;
  }
}

export function browserStorage(): KeyValueStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // access can throw when storage is disabled
  }
}
