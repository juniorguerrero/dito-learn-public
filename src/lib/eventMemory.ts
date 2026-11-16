import { getProject } from "./store";
import { remember } from "./evermind";
import { LearningEvent } from "./types";

export function describeEvent(e: LearningEvent): string {
  const lesson = e.lesson_id ? getProject(e.lesson_id)?.blueprint.title : undefined;
  const where = lesson ? ` in lesson "${lesson}"` : "";
  switch (e.type) {
    case "lesson_open":
      return `${e.student_name} opened${where || " a lesson"}.`;
    case "modality_open":
      return `${e.student_name} started learning through the ${e.modality?.replace("_", " ")} activity${where}.`;
    case "modality_complete":
      return `${e.student_name} completed the ${e.modality?.replace("_", " ")} activity${where}.`;
    case "question":
      return `${e.student_name} asked${where}: "${e.text}"`;
    case "game_result":
      return `${e.student_name} scored ${e.value ?? "?"} in the learning game${where}.`;
  }
}

// Long-term memory: the professor's AI can recall this activity forever.
// No-op without EVERMIND_API_KEY.
export function rememberEvent(event: LearningEvent): void {
  remember(
    {
      classroomId: event.classroom_id,
      studentId: event.student_id,
      senderId: event.student_id,
      senderName: event.student_name,
      role: "user",
      text: describeEvent(event),
    },
    { flush: event.type === "question" || event.type === "game_result", sessionId: event.lesson_id }
  );
}
