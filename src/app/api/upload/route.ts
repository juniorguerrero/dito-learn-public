import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { parseDocument } from "@/lib/parse";
import { createLearningBlueprint } from "@/lib/generators";
import { saveProject } from "@/lib/store";
import { Project, StudentProfile } from "@/lib/types";

export const maxDuration = 120;

export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const file = form.get("file") as File | null;
    const pastedText = (form.get("text") as string) || "";

    const profile: StudentProfile = {
      grade_level: (form.get("grade_level") as string) || "Middle school",
      goal: (form.get("goal") as string) || "Understand the material",
      preferred_style: (form.get("preferred_style") as string) || "colorful and playful",
      study_time: (form.get("study_time") as string) || "30 minutes",
    };

    let documentText = pastedText.trim();
    let sourceName = "Pasted text";

    if (file && file.size > 0) {
      const buffer = Buffer.from(await file.arrayBuffer());
      documentText = (await parseDocument(buffer, file.name)).trim();
      sourceName = file.name;
    }

    if (documentText.length < 50) {
      return NextResponse.json(
        { error: "Please provide a document or paste at least a paragraph of text." },
        { status: 400 }
      );
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
    };
    saveProject(project);

    return NextResponse.json({ id: project.id, blueprint });
  } catch (err) {
    console.error("upload error", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
