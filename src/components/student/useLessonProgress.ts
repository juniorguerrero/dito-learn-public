"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { FlashcardProgress, LessonProgress, OutputType } from "@/lib/types";
import { LocalStudent } from "@/lib/studentClient";
import { createLatestValueSaver, LatestValueSaver, SaveStatus } from "@/lib/progressSaver";
import { nextRev, parsePendingFlashcards, PendingFlashcards, reconcileFlashcards } from "@/lib/progressShared";

// "loading": restoring from the server
// "synced":  progress is restored and every change is persisted per student + lesson
// "local":   can't persist (no student identity, not enrolled, offline/static demo);
//            the lesson still works with in-memory state, as before
export type ProgressMode = "loading" | "synced" | "local";

async function errorText(res: Response, fallback: string): Promise<string> {
  try {
    const j = await res.json();
    return typeof j?.error === "string" ? j.error : fallback;
  } catch {
    return fallback;
  }
}

// Write-ahead copy of the newest unconfirmed flashcard snapshot (per student +
// lesson). Survives reloads / quick navigation that cancel an in-flight save.
const pendingKey = (studentId: string, lessonId: string) => `dito_progress_pending:${studentId}:${lessonId}`;

function readPending(key: string): PendingFlashcards | null {
  try {
    return parsePendingFlashcards(localStorage.getItem(key));
  } catch {
    return null;
  }
}
function writePending(key: string, v: PendingFlashcards): void {
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* storage full / disabled: the network save still happens */
  }
}
/** Forget the local copy once the server holds this revision or a newer one. */
function clearPendingUpTo(key: string, confirmedRev: number): void {
  try {
    const cur = readPending(key);
    if (!cur || cur.rev <= confirmedRev) localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

/**
 * @param student undefined while the local identity hasn't been read yet, null if there is none.
 */
export function useLessonProgress(lessonId: string, student: LocalStudent | null | undefined) {
  const studentId = student === undefined ? undefined : student?.id ?? null;

  const [mode, setMode] = useState<ProgressMode>("loading");
  const [completed, setCompleted] = useState<Set<OutputType>>(new Set());
  const [pending, setPending] = useState<Set<OutputType>>(new Set());
  const [flashcards, setFlashcards] = useState<FlashcardProgress | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [notice, setNotice] = useState<string | null>(null);

  const modeRef = useRef<ProgressMode>("loading");
  const pendingRef = useRef<Set<OutputType>>(new Set());
  const completedRef = useRef<Set<OutputType>>(new Set());
  const saverRef = useRef<LatestValueSaver<PendingFlashcards> | null>(null);
  const lastRevRef = useRef(0); // highest flashcard revision seen or issued

  const applyMode = (m: ProgressMode) => {
    modeRef.current = m;
    setMode(m);
  };
  const applyCompleted = (next: Set<OutputType>) => {
    completedRef.current = next;
    setCompleted(next);
  };

  // Restore on load + set up the ordered flashcard saver for this student/lesson.
  useEffect(() => {
    if (studentId === undefined) return;
    applyMode("loading");
    applyCompleted(new Set());
    setFlashcards(null);
    setSaveStatus("idle");
    setNotice(null);

    if (studentId === null) {
      applyMode("local");
      setNotice("Join a class as a student to save your progress.");
      return;
    }

    let cancelled = false;
    const base = `/api/lessons/${encodeURIComponent(lessonId)}/progress`;
    const localKey = pendingKey(studentId, lessonId);
    lastRevRef.current = 0;

    const saver = createLatestValueSaver<PendingFlashcards>({
      send: async ({ rev, flashcards: fc }, { keepalive }) => {
        const res = await fetch(base, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ student_id: studentId, rev, flashcards: fc }),
          keepalive,
        });
        if (res.ok) {
          // Applied, or ignored because the server already has this/newer revision.
          let confirmed = rev;
          try {
            const j = (await res.json()) as { progress?: LessonProgress };
            confirmed = Math.max(rev, j.progress?.flashcards_rev ?? 0);
          } catch {
            /* keepalive responses may be unreadable; rev is still confirmed */
          }
          lastRevRef.current = Math.max(lastRevRef.current, confirmed);
          clearPendingUpTo(localKey, confirmed);
          return "ok";
        }
        if (res.status >= 500) return "retry";
        clearPendingUpTo(localKey, rev); // permanently rejected (e.g. deck changed)
        return "drop";
      },
      onStatus: (s) => {
        if (!cancelled) setSaveStatus(s);
      },
    });
    saverRef.current = saver;

    fetch(`${base}?student_id=${encodeURIComponent(studentId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) throw new Error(await errorText(res, "Couldn't load your saved progress"));
        return ((await res.json()) as { progress: LessonProgress }).progress;
      })
      .then((p) => {
        if (cancelled) return;
        applyCompleted(new Set(Object.keys(p.completed || {}) as OutputType[]));
        // A newer unconfirmed local snapshot (e.g. the last clicks before a
        // reload) beats the server copy and is sent again.
        const r = reconcileFlashcards(
          { flashcards: p.flashcards ?? null, flashcards_rev: p.flashcards_rev ?? 0 },
          readPending(localKey)
        );
        if (r.clearLocal) clearPendingUpTo(localKey, r.rev);
        lastRevRef.current = Math.max(lastRevRef.current, r.rev);
        setFlashcards(r.flashcards);
        applyMode("synced");
        if (r.resend) saver.schedule(r.resend);
      })
      .catch((err) => {
        if (cancelled) return;
        applyMode("local");
        setNotice(`${err instanceof Error ? err.message : "Couldn't reach the server"} — progress won't be saved this session.`);
      });

    // Don't lose the last clicks when the tab is hidden or closed.
    const onHide = () => saver.flushOnExit();
    const onVisibility = () => {
      if (document.visibilityState === "hidden") saver.flushOnExit();
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onVisibility);
      saver.flushOnExit(); // leaving the lesson via in-app navigation
      saver.dispose();
      if (saverRef.current === saver) saverRef.current = null;
    };
  }, [lessonId, studentId]);

  const saveFlashcards = useCallback(
    (fc: FlashcardProgress) => {
      setFlashcards(fc); // the deck remounts from this when the student switches formats
      if (modeRef.current !== "synced" || !studentId || !saverRef.current) return;
      // The revision is fixed now, at click time, so the server can order
      // snapshots correctly however the requests travel.
      const snap: PendingFlashcards = { rev: nextRev(lastRevRef.current), flashcards: fc };
      lastRevRef.current = snap.rev;
      writePending(pendingKey(studentId, lessonId), snap);
      saverRef.current.schedule(snap);
    },
    [lessonId, studentId]
  );

  const complete = useCallback(
    async (modality: OutputType) => {
      if (completedRef.current.has(modality) || pendingRef.current.has(modality)) return;
      if (modeRef.current === "loading") return;
      if (modeRef.current === "local") {
        applyCompleted(new Set(completedRef.current).add(modality));
        return;
      }

      pendingRef.current = new Set(pendingRef.current).add(modality);
      setPending(pendingRef.current);
      try {
        const res = await fetch(`/api/lessons/${encodeURIComponent(lessonId)}/progress/complete`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ student_id: studentId, modality }),
        });
        if (!res.ok) throw new Error(await errorText(res, "Couldn't save"));
        const { progress } = (await res.json()) as { progress: LessonProgress };
        const next = new Set(completedRef.current);
        (Object.keys(progress.completed || {}) as OutputType[]).forEach((m) => next.add(m));
        applyCompleted(next);
        setNotice(null);
      } catch (err) {
        setNotice(`${err instanceof Error ? err.message : "Couldn't save"} — tap "I got this" again to retry.`);
      } finally {
        const rest = new Set(pendingRef.current);
        rest.delete(modality);
        pendingRef.current = rest;
        setPending(rest);
      }
    },
    [lessonId, studentId]
  );

  /** Formats the server reports as completed elsewhere (e.g. a saved game victory). */
  const mergeCompleted = useCallback((modalities: OutputType[]) => {
    if (modeRef.current !== "synced" || modalities.length === 0) return;
    const next = new Set(completedRef.current);
    modalities.forEach((m) => next.add(m));
    if (next.size !== completedRef.current.size) applyCompleted(next);
  }, []);

  return { mode, completed, pending, flashcards, saveStatus, notice, saveFlashcards, complete, mergeCompleted };
}
