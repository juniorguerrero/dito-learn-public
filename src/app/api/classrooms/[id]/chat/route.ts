import { NextRequest, NextResponse } from "next/server";
import { professorChat } from "@/lib/platform";
import { ChatMessage } from "@/lib/types";

export const maxDuration = 60;

// Professor's AI assistant — grounded in the classroom's live analytics.
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const body = await req.json();
    const question: string = (body.question || "").trim();
    const history: ChatMessage[] = body.history || [];
    if (!question) return NextResponse.json({ error: "Empty question" }, { status: 400 });
    const answer = await professorChat(params.id, history, question);
    return NextResponse.json({ answer });
  } catch (err) {
    console.error("professor chat error", err);
    return NextResponse.json({ error: err instanceof Error ? err.message : "Chat failed" }, { status: 500 });
  }
}
