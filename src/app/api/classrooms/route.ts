import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { listClassrooms, saveClassroom, makeJoinCode } from "@/lib/db";
import { Classroom } from "@/lib/types";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ classrooms: listClassrooms() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const name = (body.name || "").trim();
  if (!name) return NextResponse.json({ error: "Classroom name is required" }, { status: 400 });

  const classroom: Classroom = {
    id: randomUUID(),
    name,
    subject: (body.subject || "General").trim(),
    description: (body.description || "").trim(),
    professor_name: (body.professor_name || "Professor").trim(),
    join_code: makeJoinCode(),
    created_at: new Date().toISOString(),
    lesson_ids: [],
  };
  saveClassroom(classroom);
  return NextResponse.json({ classroom });
}
