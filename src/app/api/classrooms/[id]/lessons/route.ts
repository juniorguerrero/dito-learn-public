import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { parseDocument } from "@/lib/parse";
import { createLearningBlueprint } from "@/lib/generators";
import { saveProject } from "@/lib/store";
import { getClassroom, updateClassroom } from "@/lib/db";
import { Project, StudentProfile } from "@/lib/types";

export const maxDuration = 120;

// Professor uploads course material -> becomes a Lesson (Project) attached to the classroom.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  const classroom = getClassroom(params.id);
  if (!classroom) return NextResponse.json({ error: "Classroom not found" }, { status: 404 });

  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const pastedText = (form.get("text") as string) || "";

    // The professor sets the *baseline* level for the class; students get personalized outputs on top.
    const profile: StudentProfile = {
      grade_level: (form.get("grade_level") as string) || "High school",
      goal: (form.get("goal") as string) || `Master ${classroom.subject}`,
      preferred_style: (form.get("preferred_style") as string) || "colorful and engaging",
      study_time: (form.get("study_time") as string) || "30 minutes",
    };

    let documentText = pastedText.trim();
    let sourceName = "Pasted material";
    if (file && file.size > 0) {
      documentText = (await parseDocument(Buffer.from(await file.arrayBuffer()), file.name)).trim();
      sourceName = file.name;
    }
    if (documentText.length < 50) {
      return NextResponse.json({ error: "Add a document or paste at least a paragraph." }, { status: 400 });
    }

    const blueprint = await createLearningBlueprint(documentText, profile);
    const project: Project = {
      id: randomUUID(),
      created_at: new Date().toISOString(),
      source_name: sourceName,
      document_text: documentText,
      student_profile: profile,
      blueprint,
      outputs: {},
      classroom_id: classroom.id,
      professor_name: classroom.professor_name,
    };
    saveProject(project);

    // Re-read the class: other lessons may have been added while this one was being built.
    updateClassroom(classroom.id, (current) => {
      if (!current.lesson_ids.includes(project.id)) current.lesson_ids.push(project.id);
    });

    return NextResponse.json({ lesson: { id: project.id, title: blueprint.title } });
  } catch (err) {
    console.error("lesson upload error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Upload failed" }, { status: 500 });
  }
}
