import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { readLessonSubmission, uploadErrorResponse } from "@/lib/documentIntake";
import { createLearningBlueprint } from "@/lib/generators";
import { deleteProject, saveProject } from "@/lib/store";
import { getClassroom, updateClassroom } from "@/lib/db";
import { Project, StudentProfile } from "@/lib/types";

export const maxDuration = 120;

const field = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

// Professor uploads course material -> becomes a Lesson (Project) attached to the classroom.
// Same validation as /api/upload (src/lib/documentIntake.ts). A rejected upload
// creates nothing and leaves the classroom untouched.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const classroom = getClassroom(params.id);
  if (!classroom) return NextResponse.json({ error: "Classroom not found", code: "classroom_not_found" }, { status: 404 });

  try {
    const intake = await readLessonSubmission(req);
    if (!intake.ok) return uploadErrorResponse(intake.error);
    const { text, fileName, form } = intake.source;

    // The professor sets the *baseline* level for the class; students get personalized outputs on top.
    const profile: StudentProfile = {
      grade_level: field(form, "grade_level") || "High school",
      goal: field(form, "goal") || `Master ${classroom.subject}`,
      preferred_style: field(form, "preferred_style") || "colorful and engaging",
      study_time: field(form, "study_time") || "30 minutes",
    };

    let blueprint;
    try {
      blueprint = await createLearningBlueprint(text, profile);
    } catch (err) {
      console.error("lesson upload: blueprint failed", err);
      return NextResponse.json(
        { error: "Your material was read, but the Learning Blueprint couldn't be created. Please try again.", code: "blueprint_failed" },
        { status: 502 }
      );
    }

    const project: Project = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      source_name: fileName ?? "Pasted material",
      document_text: text,
      student_profile: profile,
      blueprint,
      outputs: {},
      classroom_id: classroom.id,
      professor_name: classroom.professor_name,
    };
    saveProject(project);

    // Re-read the class: other lessons may have been added while this one was being built.
    const attached = updateClassroom(classroom.id, (current) => {
      if (!current.lesson_ids.includes(project.id)) current.lesson_ids.push(project.id);
    });
    if (!attached) {
      // The classroom disappeared while the blueprint was being built: don't leave an orphan lesson.
      deleteProject(project.id);
      return NextResponse.json({ error: "Classroom not found", code: "classroom_not_found" }, { status: 404 });
    }

    return NextResponse.json({ lesson: { id: project.id, title: blueprint.title } });
  } catch (err) {
    console.error("lesson upload error", err);
    return NextResponse.json({ error: "The upload failed unexpectedly. Please try again.", code: "server_error" }, { status: 500 });
  }
}
