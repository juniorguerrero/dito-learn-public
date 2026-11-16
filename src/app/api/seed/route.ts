import { NextResponse } from "next/server";
import { randomUUID, randomInt } from "crypto";
import { saveProject } from "@/lib/store";
import { completionKey } from "@/lib/progressShared";
import { saveClassroom, saveStudent, makeJoinCode, logEvent, listClassrooms } from "@/lib/db";
import {
  generateMindMap,
  generateFlashcards,
  generateStorySlides,
  generatePodcastScript,
  generateStoryAudioScript,
  generateGameSpec,
  generateVideoStoryboard,
  generateSongSpec,
} from "@/lib/generators";
import { generateStudentVibe } from "@/lib/platform";
import { generateImage } from "@/lib/runpod";
import { SEED_LESSONS, SEED_STUDENTS, MODALITY_WEIGHTS, SEED_QUESTIONS } from "@/lib/seedData";
import { Project, Classroom, Student, OutputType, StudentProfile } from "@/lib/types";

export const maxDuration = 120;

// Build all 8 outputs for a lesson from its (rich) blueprint, attaching mock images.
async function generateAllOutputs(project: Project): Promise<void> {
  const bp = project.blueprint;
  const o = project.outputs;
  o.mindmap = await generateMindMap(bp);
  o.flashcards = await generateFlashcards(bp);
  o.podcast = await generatePodcastScript(bp);
  o.story_audio = await generateStoryAudioScript(bp);
  o.song = await generateSongSpec(bp);

  const slides = await generateStorySlides(bp);
  for (const s of slides.slides) s.image_url = (await generateImage(s.image_prompt, bp.visual_style)).image_url;
  o.story_slides = slides;

  const game = await generateGameSpec(bp);
  for (const l of game.levels) l.background_url = (await generateImage(l.background_prompt, bp.visual_style)).image_url;
  o.game = game;

  const video = await generateVideoStoryboard(bp);
  for (const sc of video.scenes) sc.image_url = (await generateImage(sc.image_prompt, bp.visual_style)).image_url;
  o.video = video;
}

const pastISO = (minsAgo: number) => new Date(Date.now() - minsAgo * 60000).toISOString();
const pick = <T,>(arr: T[]): T => arr[randomInt(arr.length)];

function weightedModality(): OutputType {
  const total = MODALITY_WEIGHTS.reduce((s, m) => s + m.weight, 0);
  let r = randomInt(total);
  for (const m of MODALITY_WEIGHTS) {
    if (r < m.weight) return m.modality;
    r -= m.weight;
  }
  return "song";
}

// Adds the demo classroom next to whatever already exists. It never deletes
// real classrooms, lessons, students or progress; if the demo was already
// loaded, that demo is returned as-is.
export async function POST() {
  try {
    const existing = listClassrooms().find((c) => c.is_demo);
    if (existing) {
      return NextResponse.json({ ok: true, existing: true, classroom_id: existing.id, join_code: existing.join_code, lessons: existing.lesson_ids.length });
    }

    // 1. Classroom
    const classroom: Classroom = {
      id: randomUUID(),
      name: "Ms. Chen's Science & History",
      subject: "Science & History",
      description: "A demo classroom preloaded with lessons, students, and live activity.",
      professor_name: "Ms. Chen",
      join_code: makeJoinCode(),
      created_at: pastISO(60 * 24 * 3),
      lesson_ids: [],
      is_demo: true,
    };

    // 2. Lessons (with all outputs generated)
    const baseProfile: StudentProfile = {
      grade_level: "High school",
      goal: "Master the material",
      preferred_style: "colorful and engaging",
      study_time: "30 minutes",
    };
    const lessonIds: string[] = [];
    for (const seed of SEED_LESSONS) {
      const project: Project = {
        id: randomUUID(),
        created_at: pastISO(60 * 24 * 2),
        source_name: seed.source_name,
        document_text: seed.document_text,
        student_profile: baseProfile,
        blueprint: seed.blueprint,
        outputs: {},
        classroom_id: classroom.id,
        professor_name: classroom.professor_name,
      };
      await generateAllOutputs(project);
      saveProject(project);
      lessonIds.push(project.id);
    }
    classroom.lesson_ids = lessonIds;
    saveClassroom(classroom);

    // 3. Students (with personalized vibes) enrolled in the classroom
    const students: Student[] = [];
    for (const s of SEED_STUDENTS) {
      const vibe = await generateStudentVibe(s.name, s.interests, classroom.subject);
      vibe.hero_image_url = (await generateImage(vibe.hero_image_prompt, "inspiring, warm")).image_url;
      const student: Student = {
        id: randomUUID(),
        name: s.name,
        interests: s.interests,
        vibe,
        classroom_ids: [classroom.id],
        created_at: pastISO(60 * 24),
      };
      saveStudent(student);
      students.push(student);
    }

    // 4. Realistic event log powering the observability dashboard
    let eventCount = 0;
    let qIndex = 0;
    // A format is completed at most once per student + lesson (same rule as live progress).
    const completedKeys = new Set<string>();
    for (const student of students) {
      const sessions = 3 + randomInt(4); // each student had several sessions
      for (let i = 0; i < sessions; i++) {
        const lessonId = pick(lessonIds);
        logEvent({ classroom_id: classroom.id, student_id: student.id, student_name: student.name, lesson_id: lessonId, type: "lesson_open" });
        eventCount++;
        const opens = 2 + randomInt(3);
        for (let k = 0; k < opens; k++) {
          const modality = weightedModality();
          logEvent({ classroom_id: classroom.id, student_id: student.id, student_name: student.name, lesson_id: lessonId, type: "modality_open", modality });
          eventCount++;
          const key = completionKey(student.id, lessonId, modality);
          if (randomInt(3) > 0 && !completedKeys.has(key)) {
            completedKeys.add(key);
            logEvent({ classroom_id: classroom.id, student_id: student.id, student_name: student.name, lesson_id: lessonId, type: "modality_complete", modality });
            eventCount++;
          }
        }
        // sometimes ask a question
        if (randomInt(2) === 0 && qIndex < SEED_QUESTIONS.length) {
          logEvent({ classroom_id: classroom.id, student_id: student.id, student_name: student.name, lesson_id: lessonId, type: "question", text: SEED_QUESTIONS[qIndex++] });
          eventCount++;
        }
      }
    }

    return NextResponse.json({
      ok: true,
      classroom_id: classroom.id,
      join_code: classroom.join_code,
      lessons: lessonIds.length,
      students: students.length,
      events: eventCount,
    });
  } catch (err) {
    console.error("seed error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Seed failed" }, { status: 500 });
  }
}
