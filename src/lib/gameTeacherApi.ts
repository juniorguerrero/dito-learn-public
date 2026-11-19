import { NextResponse } from "next/server";
import { TeacherGameError } from "./gameTeacher";

export const NO_STORE = { "Cache-Control": "no-store" };

export function teacherGameRoute<T>(label: string, build: () => T): NextResponse {
  try {
    return NextResponse.json(build(), { headers: NO_STORE });
  } catch (err) {
    if (err instanceof TeacherGameError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status });
    console.error(`${label} error`, err);
    return NextResponse.json({ error: "Couldn't load game results" }, { status: 500 });
  }
}
