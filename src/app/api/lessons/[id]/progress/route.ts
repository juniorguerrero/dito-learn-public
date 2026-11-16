import { NextRequest, NextResponse } from "next/server";
import { ProgressError, getLessonProgress, saveFlashcardProgress } from "@/lib/progress";

export const dynamic = "force-dynamic";

function fail(err: unknown) {
  if (err instanceof ProgressError) return NextResponse.json({ error: err.message }, { status: err.status });
  console.error("progress error", err);
  return NextResponse.json({ error: err instanceof Error ? err.message : "Progress request failed" }, { status: 500 });
}

// GET /api/lessons/[id]/progress?student_id=... -> { progress }
// Restores a student's saved progress for this lesson (empty record if none yet).
export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const progress = getLessonProgress(req.nextUrl.searchParams.get("student_id"), params.id);
    return NextResponse.json({ progress }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    return fail(err);
  }
}

// PUT { student_id, rev, flashcards: { deck_key, current_index, known[], review[] } } -> { progress, applied }
// Saves a full flashcard snapshot. `rev` is assigned by the client when the
// student acts; a snapshot older than (or equal to) the stored one is ignored,
// so requests that arrive out of order can never roll progress back.
export async function PUT(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { student_id?: unknown; rev?: unknown; flashcards?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const { progress, applied } = saveFlashcardProgress(body?.student_id, params.id, body?.flashcards, body?.rev);
    return NextResponse.json({ progress, applied });
  } catch (err) {
    return fail(err);
  }
}
