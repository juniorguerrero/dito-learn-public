import { NextRequest, NextResponse } from "next/server";
import { getConversationSummaries } from "@/lib/db";

// Per-student conversation summaries for the professor's Messages tab.
export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  return NextResponse.json({ conversations: getConversationSummaries(params.id) });
}
