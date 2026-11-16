// Client-side "join a class with a code" flow, kept free of React so it can be tested.
//
// - A student this browser already knows is enrolled into the class (same
//   identity, so their saved progress follows them).
// - If the server no longer knows that student (e.g. data was reset), the stale
//   identity must not block joining: a fresh student is created instead.

export interface RememberedStudent {
  id: string;
  name: string;
}

export interface JoinRequest {
  remembered: RememberedStudent | null;
  name: string;
  joinCode: string;
  interests: string[];
}

export interface JoinResult {
  student: RememberedStudent;
  classroom_id: string;
  /** true when the remembered identity was stale and a new student was created */
  recreated: boolean;
}

type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export class JoinError extends Error {}

async function call(fetchImpl: FetchLike, method: "POST" | "PATCH", body: unknown) {
  let res: Response;
  try {
    res = await fetchImpl("/api/students", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new JoinError("Couldn't reach the server. Check your connection and try again.");
  }
  let json: Record<string, unknown> = {};
  try {
    json = await res.json();
  } catch {
    if (res.ok) throw new JoinError("The server sent an unexpected response. Please try again.");
  }
  return { res, json };
}

export async function joinClass(req: JoinRequest, fetchImpl: FetchLike = fetch): Promise<JoinResult> {
  const joinCode = req.joinCode.trim();
  if (!joinCode) throw new JoinError("Enter the class join code from your professor.");

  let recreated = false;
  if (req.remembered) {
    const { res, json } = await call(fetchImpl, "PATCH", { student_id: req.remembered.id, join_code: joinCode });
    if (res.ok) {
      const out = json as unknown as { student: RememberedStudent; classroom_id: string };
      return { student: { id: out.student.id, name: out.student.name }, classroom_id: out.classroom_id, recreated: false };
    }
    if (json.code !== "student_not_found") throw new JoinError(String(json.error || "Couldn't join the class"));
    recreated = true; // fall through: create a new student
  }

  const name = req.name.trim() || req.remembered?.name || "";
  if (!name) throw new JoinError("What's your name?");
  const { res, json } = await call(fetchImpl, "POST", { name, join_code: joinCode, interests: req.interests });
  if (!res.ok) throw new JoinError(String(json.error || "Couldn't join the class"));
  const out = json as unknown as { student: RememberedStudent; classroom_id: string | null };
  if (!out.classroom_id) throw new JoinError("No classroom found for that join code");
  return { student: { id: out.student.id, name: out.student.name }, classroom_id: out.classroom_id, recreated };
}
