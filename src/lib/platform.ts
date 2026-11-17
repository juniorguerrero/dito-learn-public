import { claudeJSON, hasClaudeKey } from "./claude";
import { getEvents, listStudentsInClassroom, getStudent, getClassroom } from "./db";
import { getProject } from "./store";
import { OutputType, Student, ChatMessage } from "./types";
import { ravenRun } from "./raven";
import { hasEverMind } from "./evermind";
import { uniqueCompletions } from "./progressShared";
import { LessonProgressSummary, summarizeStudentProgress } from "./progress";
import { classroomLessons } from "./lessons";

const MODALITY_LABELS: Record<OutputType, string> = {
  mindmap: "Mind Map",
  flashcards: "Flashcards",
  story_slides: "Story Slides",
  podcast: "Podcast",
  story_audio: "Story Audio",
  game: "Game",
  video: "Video",
  song: "Song",
};

// ---------- Student personalization ("vibe") ----------

export async function generateStudentVibe(
  name: string,
  interests: string[],
  subject: string
): Promise<NonNullable<Student["vibe"]>> {
  const modalities = Object.keys(MODALITY_LABELS) as OutputType[];
  if (!hasClaudeKey()) {
    const guess = interests.join(" ").match(/music|song|sing/i)
      ? "song"
      : interests.join(" ").match(/game|play|sport/i)
      ? "game"
      : interests.join(" ").match(/movie|film|video|youtube/i)
      ? "video"
      : "story_slides";
    return {
      greeting: `Hey ${name}! Ready to explore ${subject} your way?`,
      motivation: `Because you love ${interests.slice(0, 2).join(" and ") || "learning"}, we'll connect every idea to what excites you.`,
      hero_image_prompt: `vibrant inspiring illustration blending ${interests.slice(0, 3).join(", ") || "curiosity"} with ${subject}, uplifting, no text`,
      favorite_modality_guess: guess as OutputType,
    };
  }

  const prompt = `A student named "${name}" just joined a class on "${subject}". Their interests: ${interests.join(", ") || "not specified"}.

Create a warm, personalized welcome as JSON:
{
  "greeting": string (1 short energizing sentence that uses their name),
  "motivation": string (1-2 sentences connecting THEIR interests to why this subject is exciting for them specifically),
  "hero_image_prompt": string (an inspiring image-generation prompt that blends their interests with the subject, uplifting mood, no text),
  "favorite_modality_guess": one of ${JSON.stringify(modalities)} (guess which learning format they'll love most based on their interests)
}`;
  return claudeJSON<NonNullable<Student["vibe"]>>(
    "You are a motivating, encouraging tutor who makes every student feel the subject was made for them. Respond with JSON only.",
    prompt,
    1500
  );
}

// ---------- Lesson chat (grounded in the lesson's document + blueprint) ----------

export async function lessonChat(
  lessonId: string,
  history: ChatMessage[],
  question: string,
  ctx: { classroomId?: string; studentId?: string; studentName?: string } = {}
): Promise<string> {
  const project = getProject(lessonId);
  if (!project) return "I couldn't find that lesson.";
  const bp = project.blueprint;

  const system = `You are Antclass, a friendly AI tutor helping a ${bp.student_level} student${ctx.studentName ? ` named ${ctx.studentName}` : ""} with the lesson "${bp.title}" (${bp.subject}). Tone: ${bp.tone}.
Answer ONLY using the lesson material below. Be concise, encouraging, and use an example when it helps. If something isn't covered, say so and relate it back to what is.

LESSON BLUEPRINT:
${JSON.stringify(bp)}

SOURCE EXCERPT:
"""${project.document_text.slice(0, 12000)}"""`;

  const { answer } = await ravenRun(
    {
      agent: "dito-tutor",
      agentName: "Antclass Tutor",
      system,
      maxTokens: 700,
      mock: (memories) => {
        const hit = bp.key_concepts.find((k) => question.toLowerCase().includes(k.name.toLowerCase().split(" ")[0]));
        if (hit) return `(mock tutor) Great question! ${hit.name}: ${hit.definition} For example — ${hit.example}`;
        const memo = memories ? ` I also remember our past sessions (via EverMind).` : "";
        return `(mock tutor — add ANTHROPIC_API_KEY for real answers) This lesson is about ${bp.title}. Key ideas: ${bp.key_concepts
          .map((k) => k.name)
          .join(", ")}. Ask me about any of them!${memo}`;
      },
    },
    {
      input: question,
      history,
      classroomId: ctx.classroomId,
      student: ctx.studentId ? { id: ctx.studentId, name: ctx.studentName || "Student" } : undefined,
      sessionId: lessonId,
    }
  );
  return answer;
}

// ---------- Observability analytics ----------

export interface ClassroomAnalytics {
  student_count: number;
  total_events: number;
  modality_opens: { modality: OutputType; label: string; opens: number; completions: number }[];
  top_modality: { modality: OutputType; label: string } | null;
  headline: string;
  completions: number;
  questions: { text: string; student_name: string; lesson_title: string; at: string }[];
  question_count: number;
  per_student: { student_id: string; name: string; interests: string[]; opens: number; completions: number; questions: number; favorite: string }[];
  lesson_activity: { lesson_id: string; title: string; opens: number; archived: boolean }[];
}

export function buildClassroomAnalytics(classroomId: string): ClassroomAnalytics {
  const events = getEvents(classroomId);
  // Each student/lesson/format completion counts once, however many events exist.
  const done = uniqueCompletions(events);
  const students = listStudentsInClassroom(classroomId);
  const modalities = Object.keys(MODALITY_LABELS) as OutputType[];

  const opens: Record<string, number> = {};
  const completions: Record<string, number> = {};
  modalities.forEach((m) => { opens[m] = 0; completions[m] = 0; });

  events.forEach((e) => {
    if (e.type === "modality_open" && e.modality) opens[e.modality]++;
  });
  done.forEach((e) => {
    if (e.modality && e.modality in completions) completions[e.modality]++;
  });

  const modality_opens = modalities
    .map((m) => ({ modality: m, label: MODALITY_LABELS[m], opens: opens[m], completions: completions[m] }))
    .sort((a, b) => b.opens - a.opens);

  const totalOpens = modality_opens.reduce((s, m) => s + m.opens, 0);
  const top = modality_opens[0]?.opens > 0 ? modality_opens[0] : null;

  let headline = "No student activity yet — share your join code to get started.";
  if (top && totalOpens > 0) {
    const pct = Math.round((top.opens / totalOpens) * 100);
    headline = `${pct}% of learning activity is happening through ${top.label} — consider designing more ${top.label.toLowerCase()} content for this class.`;
  }

  const questions = events
    .filter((e) => e.type === "question" && e.text)
    .map((e) => ({
      text: e.text!,
      student_name: e.student_name,
      lesson_title: e.lesson_id ? getProject(e.lesson_id)?.blueprint.title || "Lesson" : "Lesson",
      at: e.created_at,
    }))
    .reverse();

  const per_student = students.map((s) => {
    const se = events.filter((e) => e.student_id === s.id);
    const byModality: Record<string, number> = {};
    se.filter((e) => e.type === "modality_open" && e.modality).forEach((e) => {
      byModality[e.modality!] = (byModality[e.modality!] || 0) + 1;
    });
    const fav = Object.entries(byModality).sort((a, b) => b[1] - a[1])[0];
    return {
      student_id: s.id,
      name: s.name,
      interests: s.interests,
      opens: se.filter((e) => e.type === "modality_open").length,
      completions: done.filter((e) => e.student_id === s.id).length,
      questions: se.filter((e) => e.type === "question").length,
      favorite: fav ? MODALITY_LABELS[fav[0] as OutputType] : "—",
    };
  });

  const lessonMap: Record<string, number> = {};
  events.filter((e) => e.type === "lesson_open" && e.lesson_id).forEach((e) => {
    lessonMap[e.lesson_id!] = (lessonMap[e.lesson_id!] || 0) + 1;
  });
  const lesson_activity = Object.entries(lessonMap)
    .map(([lesson_id, o]) => {
      const p = getProject(lesson_id);
      return { lesson_id, title: p?.blueprint.title || "Lesson", opens: o, archived: Boolean(p?.archived_at) };
    })
    .sort((a, b) => b.opens - a.opens);

  return {
    student_count: students.length,
    total_events: events.length,
    modality_opens,
    top_modality: top ? { modality: top.modality, label: top.label } : null,
    headline,
    completions: Object.values(completions).reduce((s, n) => s + n, 0),
    questions,
    question_count: questions.length,
    per_student,
    lesson_activity,
  };
}

// ---------- Per-student detail ----------

export interface StudentDetail {
  id: string;
  name: string;
  interests: string[];
  favorite_modality_guess?: OutputType;
  greeting?: string;
  totals: { opens: number; completions: number; questions: number; lessons_opened: number };
  actual_favorite: { modality: OutputType; label: string } | null;
  modality_breakdown: { modality: OutputType; label: string; opens: number; completions: number }[];
  questions: { text: string; lesson_title: string; at: string }[];
  lessons: { lesson_id: string; title: string; opens: number; completions: number; archived: boolean }[];
  // Saved progress per lesson of the classroom (same data the student sees).
  progress: LessonProgressSummary[];
  matches_guess: boolean | null;
}

export function buildStudentDetail(classroomId: string, studentId: string): StudentDetail | null {
  const student = getStudent(studentId);
  if (!student) return null;
  const classroom = getClassroom(classroomId);
  const classEvents = getEvents(classroomId);
  const events = classEvents.filter((e) => e.student_id === studentId);
  const done = uniqueCompletions(events);
  const modalities = Object.keys(MODALITY_LABELS) as OutputType[];

  const opens: Record<string, number> = {};
  const comps: Record<string, number> = {};
  modalities.forEach((m) => { opens[m] = 0; comps[m] = 0; });
  events.forEach((e) => {
    if (e.type === "modality_open" && e.modality) opens[e.modality]++;
  });
  done.forEach((e) => {
    if (e.modality && e.modality in comps) comps[e.modality]++;
  });

  const modality_breakdown = modalities
    .map((m) => ({ modality: m, label: MODALITY_LABELS[m], opens: opens[m], completions: comps[m] }))
    .filter((m) => m.opens > 0 || m.completions > 0)
    .sort((a, b) => b.opens - a.opens);

  const actual = modality_breakdown[0] || null;

  const questions = events
    .filter((e) => e.type === "question" && e.text)
    .map((e) => ({ text: e.text!, lesson_title: e.lesson_id ? getProject(e.lesson_id)?.blueprint.title || "Lesson" : "Lesson", at: e.created_at }))
    .reverse();

  const lessonMap: Record<string, { opens: number; comps: number }> = {};
  events.forEach((e) => {
    if (!e.lesson_id) return;
    lessonMap[e.lesson_id] = lessonMap[e.lesson_id] || { opens: 0, comps: 0 };
    if (e.type === "modality_open") lessonMap[e.lesson_id].opens++;
  });
  done.forEach((e) => {
    if (e.lesson_id) lessonMap[e.lesson_id].comps++;
  });
  const lessons = Object.entries(lessonMap)
    .map(([lesson_id, v]) => {
      const p = getProject(lesson_id);
      return { lesson_id, title: p?.blueprint.title || "Lesson", opens: v.opens, completions: v.comps, archived: Boolean(p?.archived_at) };
    })
    .sort((a, b) => b.opens - a.opens);

  return {
    id: student.id,
    name: student.name,
    interests: student.interests,
    favorite_modality_guess: student.vibe?.favorite_modality_guess,
    greeting: student.vibe?.greeting,
    totals: {
      opens: events.filter((e) => e.type === "modality_open").length,
      completions: done.length,
      questions: questions.length,
      lessons_opened: events.filter((e) => e.type === "lesson_open").length,
    },
    actual_favorite: actual ? { modality: actual.modality, label: actual.label } : null,
    modality_breakdown,
    questions,
    lessons,
    progress: classroom ? summarizeStudentProgress(student, classroom, classEvents) : [],
    matches_guess: actual && student.vibe?.favorite_modality_guess ? actual.modality === student.vibe.favorite_modality_guess : null,
  };
}

// ---------- Professor AI assistant (grounded in the whole class) ----------

export async function professorChat(classroomId: string, history: ChatMessage[], question: string): Promise<string> {
  const classroom = getClassroom(classroomId);
  if (!classroom) return "I couldn't find that classroom.";
  const analytics = buildClassroomAnalytics(classroomId);
  const { active: activeLessons, archived: archivedLessons } = classroomLessons(classroom);
  const lessons = activeLessons.map((p) => p.blueprint.title);
  const archivedTitles = archivedLessons.map((p) => p.blueprint.title);

  const system = `You are Antclass's teaching assistant for Professor ${classroom.professor_name}'s classroom "${classroom.name}" (${classroom.subject}).
Help the professor understand and act on how their class is learning. Be concise, specific, and practical — cite the data. Suggest concrete next steps (which format to build, which student to check on).
${hasEverMind() ? "You have long-term memory of everything that has happened in this classroom over time (tutor questions, teacher↔student messages, activity) via EverMind — use it to spot patterns across sessions." : ""}

CLASS DATA (live):
- Students: ${analytics.student_count}
- Lessons: ${lessons.join("; ") || "none"}${archivedTitles.length ? `\n- Archived lessons (hidden from students, history kept): ${archivedTitles.join("; ")}` : ""}
- Headline: ${analytics.headline}
- Modality engagement (opens/completions): ${analytics.modality_opens.map((m) => `${m.label} ${m.opens}/${m.completions}`).join(", ")}
- Total questions asked: ${analytics.question_count}
- Recent questions: ${analytics.questions.slice(0, 12).map((q) => `"${q.text}" (${q.student_name}, ${q.lesson_title})`).join(" | ") || "none"}
- Per-student: ${analytics.per_student.map((s) => `${s.name} — ${s.opens} opens, ${s.completions} done, ${s.questions} questions, favors ${s.favorite}, interests: ${s.interests.join("/") || "n/a"}`).join(" | ")}`;

  const { answer } = await ravenRun(
    {
      agent: "dito-professor-assistant",
      agentName: "Antclass Teaching Assistant",
      system,
      maxTokens: 800,
      mock: (memories) => {
        // Useful mock grounded in the real computed analytics.
        const q = question.toLowerCase();
        const memo = memories ? ` (EverMind remembers this class across sessions.)` : "";
        if (q.includes("struggl") || q.includes("behind") || q.includes("engage")) {
          const least = [...analytics.per_student].sort((a, b) => a.opens - b.opens)[0];
          return least
            ? `(mock assistant) ${least.name} has the least activity so far (${least.opens} opens, ${least.questions} questions). Consider a ${analytics.top_modality?.label || "song"}-based lesson — it's what this class engages with most.${memo}`
            : "(mock assistant) No student activity yet — share your join code to get started.";
        }
        if (q.includes("what") && (q.includes("teach") || q.includes("next") || q.includes("create") || q.includes("make"))) {
          return `(mock assistant) ${analytics.headline} Since ${analytics.top_modality?.label || "Song"} drives the most engagement, I'd build your next lesson around it. Students have asked ${analytics.question_count} questions — the recurring themes are a good place to focus.${memo}`;
        }
        if (q.includes("confus") || q.includes("ask")) {
          const qs = analytics.questions.slice(0, 3).map((x) => `“${x.text}” (${x.student_name})`).join("; ");
          return `(mock assistant) Recent questions: ${qs || "none yet"}. Add ANTHROPIC_API_KEY for full AI analysis.${memo}`;
        }
        return `(mock assistant) This class has ${analytics.student_count} students across ${lessons.length} lessons. ${analytics.headline} Ask me who's struggling, what students are confused about, or what to create next. (Add ANTHROPIC_API_KEY for real answers.)${memo}`;
      },
    },
    { input: question, history, classroomId, sessionId: "professor-assistant" }
  );
  return answer;
}

export { MODALITY_LABELS };
