"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { v4 as uuidv4 } from "uuid";
import { LocalStudent } from "@/lib/studentClient";
import { OutputType } from "@/lib/types";
import { PendingFinish, TranscriptEntry, addPendingFinish, parsePendingFinishes } from "@/lib/gameEngine";
import { AttemptDetail, AttemptSummary, GameResultsSummary } from "@/lib/gameResults";

// Saved Concept Quest results for one student + lesson.
//
// - "loading": reading saved results; "synced": results are saved on the server;
//   "local": can't save (no student identity, not enrolled, server unreachable) —
//   the game still plays, but nothing is recorded.
// - Starting an attempt uses an id chosen here; a retried start reuses it, so a
//   double click or a lost response never creates two attempts.
// - A finished game's answers are first written to localStorage, then sent.
//   Until the server confirms, the result is shown as "not saved yet" and is
//   re-sent with the same attempt id (automatic backoff, "Retry now", when the
//   browser comes back online, and on the next visit after a refresh).
// - "unavailable": the server can't read this student's saved results right now
//   (storage problem, server down, offline). Finished results waiting here are
//   kept and sent once the results load again ("Try again", back online, next visit).
// - A result the server can't match to a started attempt (404/403) is "held":
//   kept on this device, not retried automatically, retried on "Try again" and
//   on the next visit. Only answers the server can never score (400/409/413/422)
//   are dropped, and the student is told.

export type ResultsMode = "loading" | "synced" | "local" | "unavailable";

export type SaveState =
  | { status: "saving" }
  | { status: "retrying"; message: string }
  | { status: "saved"; attempt: AttemptSummary }
  | { status: "held"; message: string }
  | { status: "failed"; message: string };

export interface RejectedFinish {
  attempt_id: string;
  finished_at: string;
  message: string;
}

export type StartOutcome =
  | { ok: true; attemptId: string }
  | { ok: false; code: string; message: string; retryable: boolean };

export interface GameResultsApi {
  mode: ResultsMode;
  notice: string | null;
  summary: GameResultsSummary | null;
  pending: PendingFinish[];
  saves: Record<string, SaveState>;
  start: (version: string) => Promise<StartOutcome>;
  finish: (attemptId: string, transcript: TranscriptEntry[]) => void;
  retryNow: () => void;
  reloadResults: () => void;
  rejected: RejectedFinish[];
  dismissRejected: (attemptId: string) => void;
  loadAttempt: (attemptId: string) => Promise<AttemptDetail>;
}

const pendingKey = (studentId: string, lessonId: string) => `dito_game_pending:${studentId}:${lessonId}`;

function readPending(key: string): PendingFinish[] {
  try {
    return parsePendingFinishes(localStorage.getItem(key));
  } catch {
    return [];
  }
}
function writePending(key: string, list: PendingFinish[]): void {
  try {
    if (list.length) localStorage.setItem(key, JSON.stringify(list));
    else localStorage.removeItem(key);
  } catch {
    /* storage disabled/full: the network save still happens */
  }
}

async function errorOf(res: Response, fallback: string): Promise<{ message: string; code: string }> {
  try {
    const j = await res.json();
    return { message: typeof j?.error === "string" ? j.error : fallback, code: typeof j?.code === "string" ? j.code : "" };
  } catch {
    return { message: fallback, code: "" };
  }
}

const transient = (status: number) => status >= 500 || status === 408 || status === 429;
// The server can't find the attempt/student/enrollment: keep the result, don't loop.
const held = (status: number) => status === 403 || status === 404;
const MAX_BACKOFF_MS = 30000;

export function useGameResults(
  lessonId: string,
  student: LocalStudent | null | undefined,
  opts: { onCompleted?: (completed: OutputType[]) => void } = {}
): GameResultsApi {
  const studentId = student === undefined ? undefined : student?.id ?? null;
  const [mode, setMode] = useState<ResultsMode>("loading");
  const [notice, setNotice] = useState<string | null>(null);
  const [summary, setSummary] = useState<GameResultsSummary | null>(null);
  const [pending, setPending] = useState<PendingFinish[]>([]);
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [rejected, setRejected] = useState<RejectedFinish[]>([]);
  const [loadKey, setLoadKey] = useState(0);

  const modeRef = useRef<ResultsMode>("loading");
  const startIdRef = useRef<string | null>(null); // reused until a start is answered
  const inflight = useRef<Set<string>>(new Set());
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const failures = useRef<Map<string, number>>(new Map());
  const aliveRef = useRef(true);
  const onCompletedRef = useRef(opts.onCompleted);
  onCompletedRef.current = opts.onCompleted;

  const base = `/api/lessons/${encodeURIComponent(lessonId)}/game/attempts`;
  const key = studentId ? pendingKey(studentId, lessonId) : null;

  const setSave = (id: string, s: SaveState) => setSaves((m) => ({ ...m, [id]: s }));
  const applyMode = (m: ResultsMode) => {
    modeRef.current = m;
    setMode(m);
  };

  const refresh = useCallback(async () => {
    if (!studentId) return;
    try {
      const res = await fetch(`${base}?student_id=${encodeURIComponent(studentId)}`, { cache: "no-store" });
      if (res.ok && aliveRef.current) setSummary((await res.json()) as GameResultsSummary);
    } catch {
      /* keep what we have */
    }
  }, [base, studentId]);

  const removePending = useCallback(
    (attemptId: string) => {
      if (!key) return;
      const next = readPending(key).filter((p) => p.attempt_id !== attemptId);
      writePending(key, next);
      if (aliveRef.current) setPending(next);
    },
    [key]
  );

  const send = useCallback(
    async (p: PendingFinish) => {
      if (!studentId || inflight.current.has(p.attempt_id)) return;
      const t = timers.current.get(p.attempt_id);
      if (t) clearTimeout(t);
      timers.current.delete(p.attempt_id);
      inflight.current.add(p.attempt_id);
      setSave(p.attempt_id, { status: "saving" });
      let retryMessage = "Couldn't reach the server.";
      try {
        const res = await fetch(`${base}/${encodeURIComponent(p.attempt_id)}/finish`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ student_id: studentId, transcript: p.transcript }),
        });
        if (res.ok) {
          const j = (await res.json()) as { attempt: AttemptSummary; completed: OutputType[] };
          failures.current.delete(p.attempt_id);
          removePending(p.attempt_id);
          if (!aliveRef.current) return;
          setSave(p.attempt_id, { status: "saved", attempt: j.attempt });
          onCompletedRef.current?.(j.completed || []);
          void refresh();
          return;
        }
        const err = await errorOf(res, `Couldn't save (HTTP ${res.status})`);
        if (held(res.status)) {
          if (aliveRef.current) setSave(p.attempt_id, { status: "held", message: err.message });
          return;
        }
        if (!transient(res.status)) {
          // Answers the server can never score: stop retrying, and say so.
          removePending(p.attempt_id);
          if (aliveRef.current) {
            setSave(p.attempt_id, { status: "failed", message: err.message });
            setRejected((r) => (r.some((x) => x.attempt_id === p.attempt_id) ? r : [...r, { attempt_id: p.attempt_id, finished_at: p.finished_at, message: err.message }]));
          }
          return;
        }
        retryMessage = err.message;
      } catch {
        /* network error: retry below */
      } finally {
        inflight.current.delete(p.attempt_id);
      }
      if (!aliveRef.current) return;
      const n = (failures.current.get(p.attempt_id) || 0) + 1;
      failures.current.set(p.attempt_id, n);
      setSave(p.attempt_id, { status: "retrying", message: retryMessage });
      timers.current.set(
        p.attempt_id,
        setTimeout(() => void send(p), Math.min(MAX_BACKOFF_MS, 2000 * 2 ** (n - 1)))
      );
    },
    [base, studentId, removePending, refresh]
  );

  // Load saved results, then re-send anything finished but not yet confirmed.
  useEffect(() => {
    aliveRef.current = true;
    if (studentId === undefined) return;
    applyMode("loading");
    setSummary(null);
    setNotice(null);
    setSaves({});
    startIdRef.current = null;
    if (studentId === null) {
      applyMode("local");
      setNotice("Join the class as a student to save your game results.");
      return;
    }
    let cancelled = false;
    const k = pendingKey(studentId, lessonId);
    const stored = readPending(k);
    setPending(stored);
    fetch(`${base}?student_id=${encodeURIComponent(studentId)}`, { cache: "no-store" })
      .then(async (res) => {
        if (!res.ok) {
          const e = await errorOf(res, "Couldn't load your game results");
          throw Object.assign(new Error(e.message), { status: res.status });
        }
        return (await res.json()) as GameResultsSummary;
      })
      .then((s) => {
        if (cancelled) return;
        setSummary(s);
        applyMode("synced");
        stored.forEach((p) => void send(p));
      })
      .catch((err) => {
        if (cancelled) return;
        const status = (err as { status?: number })?.status;
        const message = err instanceof Error && status !== undefined ? err.message : "Couldn't reach the server.";
        if (status === undefined || transient(status)) {
          // Temporary: keep everything, offer "Try again", retry when back online.
          applyMode("unavailable");
          setNotice(message);
        } else {
          applyMode("local");
          setNotice(`${message} — game results won't be saved this session.`);
        }
      });

    const online = () => {
      if (modeRef.current === "unavailable") setLoadKey((n) => n + 1);
      else readPending(k).forEach((p) => void send(p));
    };
    window.addEventListener("online", online);
    const timerMap = timers.current;
    return () => {
      cancelled = true;
      aliveRef.current = false;
      window.removeEventListener("online", online);
      timerMap.forEach((t) => clearTimeout(t));
      timerMap.clear();
    };
  }, [base, lessonId, studentId, send, loadKey]);

  const start = useCallback(
    async (version: string): Promise<StartOutcome> => {
      if (modeRef.current !== "synced" || !studentId) {
        return { ok: false, code: "not_saving", message: "Results can't be saved right now.", retryable: false };
      }
      const attemptId = startIdRef.current ?? uuidv4();
      startIdRef.current = attemptId;
      try {
        const res = await fetch(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ student_id: studentId, attempt_id: attemptId, version }),
        });
        if (res.ok) {
          const j = (await res.json()) as { attempt: { id: string; version: string } };
          startIdRef.current = null;
          if (j.attempt.version !== version) {
            return { ok: false, code: "game_changed", message: "This game has been updated since you opened it.", retryable: false };
          }
          return { ok: true, attemptId };
        }
        const err = await errorOf(res, `Couldn't start (HTTP ${res.status})`);
        if (!transient(res.status)) startIdRef.current = null;
        return { ok: false, code: err.code, message: err.message, retryable: transient(res.status) };
      } catch {
        // Keep the id: if the start did reach the server, retrying names the same attempt.
        return { ok: false, code: "network", message: "Couldn't reach the server.", retryable: true };
      }
    },
    [base, studentId]
  );

  const finish = useCallback(
    (attemptId: string, transcript: TranscriptEntry[]) => {
      if (!key) return;
      const p: PendingFinish = { attempt_id: attemptId, transcript: [...transcript], finished_at: new Date().toISOString() };
      // Write-ahead: the finished answers survive a refresh before the server confirms.
      const next = addPendingFinish(readPending(key), p);
      writePending(key, next);
      setPending(next);
      void send(p);
    },
    [key, send]
  );

  const retryNow = useCallback(() => {
    if (!key) return;
    if (modeRef.current === "unavailable") {
      setLoadKey((n) => n + 1);
      return;
    }
    readPending(key).forEach((p) => void send(p));
  }, [key, send]);

  const reloadResults = useCallback(() => setLoadKey((n) => n + 1), []);
  const dismissRejected = useCallback((attemptId: string) => setRejected((r) => r.filter((x) => x.attempt_id !== attemptId)), []);

  const loadAttempt = useCallback(
    async (attemptId: string): Promise<AttemptDetail> => {
      const res = await fetch(`${base}/${encodeURIComponent(attemptId)}?student_id=${encodeURIComponent(studentId || "")}`, { cache: "no-store" });
      if (!res.ok) throw new Error((await errorOf(res, "Couldn't load that attempt")).message);
      return ((await res.json()) as { attempt: AttemptDetail }).attempt;
    },
    [base, studentId]
  );

  return { mode, notice, summary, pending, saves, start, finish, retryNow, reloadResults, rejected, dismissRejected, loadAttempt };
}
