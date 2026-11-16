import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { getClassroomByCode, getClassroom, saveStudent, getStudent, normalizeJoinCode } from "@/lib/db";
import { generateStudentVibe } from "@/lib/platform";
import { generateImage } from "@/lib/runpod";
import { Student } from "@/lib/types";

export const maxDuration = 120;

// Onboard a student: join a classroom by code, capture interests, generate their personalized vibe.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const name = typeof body.name === "string" ? body.name.trim() : "";
    const interests: string[] = (Array.isArray(body.interests) ? body.interests : [])
      .filter((s: unknown): s is string => typeof s === "string" && s.trim() !== "")
      .map((s: string) => s.trim());
    const joinCode = normalizeJoinCode(body.join_code);

    if (!name) return NextResponse.json({ error: "Please enter your name" }, { status: 400 });

    const classroom = joinCode ? getClassroomByCode(joinCode) : null;
    if (joinCode && !classroom) {
      return NextResponse.json({ error: "No classroom found for that join code" }, { status: 404 });
    }

    const vibe = await generateStudentVibe(name, interests, classroom?.subject || "your studies");
    // Illustrate the personalized hero image (mock SVG locally, FLUX on RunPod)
    const img = await generateImage(vibe.hero_image_prompt, "inspiring, warm", "16:9");
    vibe.hero_image_url = img.image_url;

    const student: Student = {
      id: randomUUID(),
      name,
      interests,
      vibe,
      classroom_ids: classroom ? [classroom.id] : [],
      created_at: new Date().toISOString(),
    };
    saveStudent(student);

    return NextResponse.json({ student, classroom_id: classroom?.id || null });
  } catch (err) {
    console.error("student onboard error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Onboarding failed" }, { status: 500 });
  }
}

// Enroll an existing student into another classroom by code.
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const student = typeof body.student_id === "string" ? getStudent(body.student_id) : null;
  // `code` lets the client tell "this browser remembers a deleted student" apart from a bad join code.
  if (!student) return NextResponse.json({ error: "Student not found", code: "student_not_found" }, { status: 404 });
  const classroom = getClassroomByCode(normalizeJoinCode(body.join_code));
  if (!classroom) return NextResponse.json({ error: "No classroom found for that join code" }, { status: 404 });
  if (!student.classroom_ids.includes(classroom.id)) {
    student.classroom_ids.push(classroom.id);
    saveStudent(student);
  }
  return NextResponse.json({ student, classroom_id: classroom.id });
}

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const student = getStudent(id);
  if (!student) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  const classrooms = student.classroom_ids.map((cid) => getClassroom(cid)).filter(Boolean);
  return NextResponse.json({ student, classrooms });
}
