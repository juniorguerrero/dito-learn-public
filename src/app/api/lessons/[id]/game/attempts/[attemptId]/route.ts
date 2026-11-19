import { NextRequest, NextResponse } from "next/server";
import { getGameAttempt } from "@/lib/gameAttempts";
import { NO_STORE, gameErrorResponse } from "@/lib/gameApi";

export const dynamic = "force-dynamic";

// GET /api/lessons/[id]/game/attempts/[attemptId]?student_id=
//   -> { attempt: AttemptDetail } one finished attempt with its review
//      (questions, answers, explanations as they were in that game version).
export async function GET(req: NextRequest, { params }: { params: { id: string; attemptId: string } }) {
  try {
    const attempt = getGameAttempt(req.nextUrl.searchParams.get("student_id"), params.id, params.attemptId);
    return NextResponse.json({ attempt }, { headers: NO_STORE });
  } catch (err) {
    return gameErrorResponse(err, "game attempt");
  }
}
