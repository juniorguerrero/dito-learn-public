import { NextRequest, NextResponse } from "next/server";
import { getClassroom } from "@/lib/db";
import { buildClassroomAnalytics } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  const classroom = getClassroom(params.id);
  if (!classroom) return NextResponse.json({ error: "Classroom not found" }, { status: 404 });
  return NextResponse.json(buildClassroomAnalytics(classroom.id));
}
