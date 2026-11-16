import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import * as classProgressRoute from "@/app/api/classrooms/[id]/progress/route";
import * as progressRoute from "@/app/api/lessons/[id]/progress/route";
import * as completeRoute from "@/app/api/lessons/[id]/progress/complete/route";
import { flashcardDeckKey, OUTPUT_TYPES } from "@/lib/progressShared";
import { seedFixture, useTempDataDir } from "./fixtures";

useTempDataDir();
const BASE = "http://localhost";

async function classProgress(classroomId: string, studentId: string) {
  const res = await classProgressRoute.GET(new NextRequest(`${BASE}/x?student_id=${studentId}`), { params: { id: classroomId } });
  return { status: res.status, body: await res.json() };
}
const complete = (lessonId: string, studentId: string, modality: string) =>
  completeRoute.POST(new NextRequest(`${BASE}/x`, { method: "POST", body: JSON.stringify({ student_id: studentId, modality }) }), { params: { id: lessonId } });

describe("student's class page: progress per lesson", () => {
  it("reports formats done and flashcards per lesson, and a fully finished lesson", async () => {
    const { classroom, lessonA, lessonB, ada, ben } = seedFixture();
    for (const m of OUTPUT_TYPES) await complete(lessonA.id, ada.id, m); // lesson A: all 8 formats
    await complete(lessonB.id, ada.id, "song");
    await progressRoute.PUT(
      new NextRequest(`${BASE}/x`, { method: "PUT", body: JSON.stringify({ student_id: ada.id, rev: 1, flashcards: { deck_key: flashcardDeckKey(lessonB.outputs.flashcards), current_index: 2, known: [0, 1], review: [] } }) }),
      { params: { id: lessonB.id } }
    );

    const r = await classProgress(classroom.id, ada.id);
    expect(r.status).toBe(200);
    expect(r.body.total_formats).toBe(8);
    const [a, b] = r.body.lessons;
    expect(a).toMatchObject({ lesson_id: lessonA.id, completed: [...OUTPUT_TYPES] });
    expect(b).toMatchObject({ lesson_id: lessonB.id, completed: ["song"], flashcards: { known: 2, review: 0, total: lessonB.outputs.flashcards!.cards.length } });

    // Another student's page is unaffected.
    const other = await classProgress(classroom.id, ben.id);
    expect(other.body.lessons.map((l: { completed: string[] }) => l.completed)).toEqual([[], []]);
  });

  it("refuses unknown students, unknown classes and classes the student hasn't joined", async () => {
    const { classroom, otherClassroom, ada } = seedFixture();
    expect((await classProgress(classroom.id, "nobody")).status).toBe(404);
    expect((await classProgress("no-class", ada.id)).status).toBe(404);
    expect((await classProgress(otherClassroom.id, ada.id)).status).toBe(403);
  });
});
