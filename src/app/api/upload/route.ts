import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { readLessonSubmission, uploadErrorResponse } from "@/lib/documentIntake";
import { createLearningBlueprint } from "@/lib/generators";
import { saveProject } from "@/lib/store";
import { Project, StudentProfile } from "@/lib/types";

export const maxDuration = 120;

const field = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v : "";
};

// Standalone upload: one file (PDF, DOCX, TXT, Markdown) *or* pasted text.
// Validation happens first (src/lib/documentIntake.ts); nothing is saved
// unless the material is accepted and the blueprint was built.
export async function POST(req: NextRequest) {
  try {
    const intake = await readLessonSubmission(req);
    if (!intake.ok) return uploadErrorResponse(intake.error);
    const { text, fileName, form } = intake.source;

    const profile: StudentProfile = {
      grade_level: field(form, "grade_level") || "Middle school",
      goal: field(form, "goal") || "Understand the material",
      preferred_style: field(form, "preferred_style") || "colorful and playful",
      study_time: field(form, "study_time") || "30 minutes",
    };

    let blueprint;
    try {
      blueprint = await createLearningBlueprint(text, profile);
    } catch (err) {
      console.error("upload: blueprint failed", err);
      return NextResponse.json(
        { error: "Your material was read, but the Learning Blueprint couldn't be created. Please try again.", code: "blueprint_failed" },
        { status: 502 }
      );
    }

    const project: Project = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      source_name: fileName ?? "Pasted text",
      document_text: text,
      student_profile: profile,
      blueprint,
      outputs: {},
    };
    saveProject(project);

    return NextResponse.json({ id: project.id, blueprint });
  } catch (err) {
    console.error("upload error", err);
    return NextResponse.json({ error: "The upload failed unexpectedly. Please try again.", code: "server_error" }, { status: 500 });
  }
}
