import { NextRequest, NextResponse } from "next/server";
import { finishGameAttempt } from "@/lib/gameAttempts";
import { rememberEvent } from "@/lib/eventMemory";
import { gameErrorResponse, readJsonBody } from "@/lib/gameApi";

export const dynamic = "force-dynamic";

// POST { student_id, transcript: TranscriptEntry[] } -> { attempt, duplicate, completed }
// The server replays the answers against the attempt's own game version and
// derives outcome + score; any score/outcome field in the body is ignored.
// Idempotent: repeating the same finish returns the stored result (duplicate: true).
// 422 invalid_transcript (illegal/incomplete answers), 409 already_finished (different answers).
export async function POST(req: NextRequest, { params }: { params: { id: string; attemptId: string } }) {
  const read = await readJsonBody(req, 256 * 1024);
  if (!read.ok) return read.response;
  try {
    const r = finishGameAttempt(read.body.student_id, params.id, params.attemptId, read.body.transcript);
    r.events.forEach(rememberEvent);
    return NextResponse.json({ attempt: r.attempt, duplicate: r.duplicate, completed: r.completed });
  } catch (err) {
    return gameErrorResponse(err, "game finish");
  }
}
