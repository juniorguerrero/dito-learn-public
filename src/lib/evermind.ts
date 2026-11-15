// EverMind (EverOS Cloud) memory layer — https://docs.evermind.ai
// Long-term memory for the platform: every teacher↔student message, tutor
// question, and learning event is written here, so the professor's AI can
// recall everything that has happened over time.
//
// Same zero-key philosophy as the rest of Antclass: without EVERMIND_API_KEY
// every call is a silent no-op and the app keeps working.

const BASE = process.env.EVERMIND_BASE_URL || "https://api.evermind.ai";

export const hasEverMind = () => Boolean(process.env.EVERMIND_API_KEY);

// Stable memory-space ids (EverMind persists these across sessions).
export const studentMemoryId = (studentId: string) => `dito-student-${studentId}`;
export const classroomMemoryId = (classroomId: string) => `dito-class-${classroomId}`;

async function everFetch(path: string, body: unknown, timeoutMs = 10000): Promise<Record<string, unknown> | null> {
  if (!hasEverMind()) return null;
  try {
    const res = await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.EVERMIND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as Record<string, unknown>;
  } catch {
    return null; // memory must never break the app
  }
}

// ---------- Write ----------

export interface MemoryEntry {
  classroomId: string;
  studentId?: string; // when set, also stored as the student's personal memory
  senderId: string; // "professor" | student id | agent id
  senderName: string;
  role: "user" | "assistant";
  text: string;
}

/**
 * Fire-and-forget write. Each entry lands in the classroom's group memory
 * (so the professor's assistant sees the whole class) and, when a student is
 * attached, in that student's personal memory (powers per-student profiles).
 */
export function remember(entries: MemoryEntry | MemoryEntry[], opts: { flush?: boolean; sessionId?: string } = {}): void {
  if (!hasEverMind()) return;
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  const now = Date.now();

  void (async () => {
    const groupId = classroomMemoryId(list[0].classroomId);
    await everFetch("/api/v1/memories/group", {
      group_id: groupId,
      messages: list.map((e, i) => ({
        sender_id: e.senderId,
        sender_name: e.senderName,
        role: e.role,
        timestamp: now + i,
        content: e.text,
      })),
      // Sync mode: the message is accumulated before we return, so the flush
      // below can't race the ingestion queue. remember() is fire-and-forget,
      // so the extra latency never blocks a request.
      async_mode: false,
    });

    const byStudent = new Map<string, MemoryEntry[]>();
    list.forEach((e) => {
      if (!e.studentId) return;
      const arr = byStudent.get(e.studentId) || [];
      arr.push(e);
      byStudent.set(e.studentId, arr);
    });
    await Promise.all(
      Array.from(byStudent.entries()).map(([studentId, msgs]) =>
        everFetch("/api/v1/memories", {
          user_id: studentMemoryId(studentId),
          session_id: opts.sessionId,
          // No sender_id here: personal memories require sender_id === user_id
          // for user-role messages, so we omit it and keep names in the content.
          messages: msgs.map((e, i) => ({
            role: e.role,
            timestamp: now + i,
            content: e.role === "assistant" ? e.text : `${e.senderName}: ${e.text}`,
          })),
          async_mode: false,
        })
      )
    );

    // Optional immediate extraction so the memory is recallable right away (demo-friendly).
    if (opts.flush) {
      await Promise.all([
        everFetch("/api/v1/memories/group/flush", { group_id: groupId }),
        // Flush must carry the same session_id the messages were added with,
        // or boundary detection reports no_extraction.
        ...Array.from(byStudent.keys()).map((studentId) =>
          everFetch("/api/v1/memories/flush", { user_id: studentMemoryId(studentId), session_id: opts.sessionId })
        ),
      ]);
    }
  })().catch(() => {});
}

// ---------- Read ----------

interface SearchHit {
  summary?: string | null;
  episode?: string | null;
  profile_data?: unknown;
  content?: unknown;
  score?: number;
}

function condense(data: Record<string, unknown> | null, cap: number): string[] {
  if (!data) return [];
  const d = (data.data || {}) as Record<string, unknown>;
  const lines: string[] = [];
  ((d.profiles as SearchHit[]) || []).slice(0, 3).forEach((p) => {
    if (p.profile_data) lines.push(`[profile] ${JSON.stringify(p.profile_data).slice(0, 500)}`);
  });
  ((d.episodes as SearchHit[]) || []).slice(0, 8).forEach((e) => {
    const t = e.summary || e.episode;
    if (t) lines.push(`[memory] ${String(t).slice(0, 400)}`);
  });
  ((d.raw_messages as SearchHit[]) || []).slice(0, 6).forEach((m) => {
    const t = typeof m.content === "string" ? m.content : m.content ? JSON.stringify(m.content) : "";
    if (t) lines.push(`[recent] ${t.slice(0, 300)}`);
  });
  let total = 0;
  return lines.filter((l) => (total += l.length) <= cap);
}

/**
 * Search long-term memory and return a condensed plain-text block for
 * prompt injection. Empty string when EverMind is off or nothing matches.
 */
export async function recall(
  query: string,
  scope: { studentId?: string; classroomId?: string },
  cap = 2600
): Promise<string> {
  if (!hasEverMind()) return "";
  const searches: Promise<Record<string, unknown> | null>[] = [];
  if (scope.studentId) {
    searches.push(
      everFetch("/api/v1/memories/search", {
        query,
        filters: { user_id: studentMemoryId(scope.studentId) },
        method: "hybrid",
        memory_types: ["episodic_memory", "profile"],
        top_k: 8,
      })
    );
  }
  if (scope.classroomId) {
    searches.push(
      everFetch("/api/v1/memories/search", {
        query,
        filters: { group_id: classroomMemoryId(scope.classroomId) },
        method: "hybrid",
        memory_types: ["episodic_memory", "profile"],
        top_k: 8,
      })
    );
  }
  const results = await Promise.all(searches);
  const seen = new Set<string>();
  const lines = results.flatMap((r) => condense(r, cap)).filter((l) => !seen.has(l) && seen.add(l));
  let total = 0;
  return lines.filter((l) => (total += l.length) <= cap).join("\n");
}
