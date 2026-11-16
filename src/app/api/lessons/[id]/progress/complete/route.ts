import { NextRequest, NextResponse } from "next/server";
import { ProgressError, recordCompletion } from "@/lib/progress";
import { rememberEvent } from "@/lib/eventMemory";

// POST { student_id, modality } -> { progress, newly_completed }
// Idempotent: the first call counts the completion; repeats are no-ops.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  let body: { student_id?: unknown; modality?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  try {
    const result = recordCompletion(body?.student_id, params.id, body?.modality);
    if (result.event) rememberEvent(result.event);
    return NextResponse.json({ progress: result.progress, newly_completed: result.newly_completed });
  } catch (err) {
    if (err instanceof ProgressError) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("completion error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save completion" }, { status: 500 });
  }
}
