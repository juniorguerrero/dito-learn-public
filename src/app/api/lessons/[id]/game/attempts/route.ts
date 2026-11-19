import { NextRequest, NextResponse } from "next/server";
import { getGameResults, startGameAttempt } from "@/lib/gameAttempts";
import { NO_STORE, gameErrorResponse, readJsonBody } from "@/lib/gameApi";

export const dynamic = "force-dynamic";

// GET /api/lessons/[id]/game/attempts?student_id=
//   -> GameResultsSummary: latest finished result, finished count, best score per
//      game version, finished attempts (newest first). Unfinished attempts never count.
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    return NextResponse.json(getGameResults(req.nextUrl.searchParams.get("student_id"), params.id), { headers: NO_STORE });
  } catch (err) {
    return gameErrorResponse(err, "game results");
  }
}

// POST { student_id, attempt_id (UUID chosen by the browser), version } -> { attempt, created }
// Starts an attempt on the lesson's current game version. Idempotent per attempt_id.
// 409 game_changed if `version` is no longer the lesson's game; 422 if the game can't be played.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const read = await readJsonBody(req, 4 * 1024);
  if (!read.ok) return read.response;
  try {
    const r = startGameAttempt(read.body.student_id, params.id, read.body);
    return NextResponse.json(r, { status: r.created ? 201 : 200 });
  } catch (err) {
    return gameErrorResponse(err, "game start");
  }
}
