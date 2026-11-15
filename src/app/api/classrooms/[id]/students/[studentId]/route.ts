import { NextRequest, NextResponse } from "next/server";
import { buildStudentDetail } from "@/lib/platform";

export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string; studentId: string } }) {
  const detail = buildStudentDetail(params.id, params.studentId);
  if (!detail) return NextResponse.json({ error: "Student not found" }, { status: 404 });
  return NextResponse.json(detail);
}
