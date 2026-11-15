// Raven-style memory-first agent harness, modeled on EverMind's Raven
// (github.com/EverMind-AI/Raven) and backed by EverOS cloud memory.
//
// Every agent turn runs the Raven loop:
//   1. RECALL  — pull long-term memories for this student / classroom
//   2. REASON  — answer with Claude, grounded in those memories
//   3. REMEMBER — write the exchange back so future turns (and the
//      professor's assistant) know everything that has happened over time.
//
// Degrades gracefully: no EVERMIND_API_KEY → skips recall/remember;
// no ANTHROPIC_API_KEY → uses the agent's mock responder.

import Anthropic from "@anthropic-ai/sdk";
import { hasClaudeKey } from "./claude";
import { ChatMessage } from "./types";
import { recall, remember } from "./evermind";

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";

export interface RavenAgentSpec {
  agent: string; // stable agent id, e.g. "dito-tutor"
  agentName: string; // how the agent is credited in memory, e.g. "Antclass Tutor"
  system: string; // base system prompt; the harness appends the memory block
  maxTokens?: number;
  mock: (memories: string) => string; // offline responder when no Claude key
}

export interface RavenTurn {
  input: string;
  history: ChatMessage[];
  recallQuery?: string; // defaults to the input
  student?: { id: string; name: string };
  classroomId?: string;
  sessionId?: string; // e.g. lesson id — groups related memories
}

export interface RavenResult {
  answer: string;
  memories: string; // what the harness recalled (for debugging/UI)
}

export async function ravenRun(spec: RavenAgentSpec, turn: RavenTurn): Promise<RavenResult> {
  // 1. RECALL
  const memories = await recall(turn.recallQuery || turn.input, {
    studentId: turn.student?.id,
    classroomId: turn.classroomId,
  });

  // 2. REASON
  let answer: string;
  if (!hasClaudeKey()) {
    answer = spec.mock(memories);
  } else {
    const system = memories
      ? `${spec.system}\n\nLONG-TERM MEMORY (recalled from EverMind — things you remember about this student/class from past sessions; use them naturally, don't recite them):\n${memories}`
      : spec.system;
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const messages: Anthropic.MessageParam[] = [
      ...turn.history.slice(-8).map((m) => ({ role: m.role, content: m.content } as Anthropic.MessageParam)),
      { role: "user", content: turn.input },
    ];
    const res = await client.messages.create({ model: MODEL, max_tokens: spec.maxTokens || 700, system, messages });
    const block = res.content.find((b) => b.type === "text");
    answer = block && block.type === "text" ? block.text : "Sorry, I didn't catch that — try again?";
  }

  // 3. REMEMBER (fire-and-forget)
  if (turn.classroomId || turn.student) {
    const classroomId = turn.classroomId || "unassigned";
    remember(
      [
        {
          classroomId,
          studentId: turn.student?.id,
          senderId: turn.student?.id || "professor",
          senderName: turn.student?.name || "Professor",
          role: "user",
          text: turn.input,
        },
        {
          classroomId,
          studentId: turn.student?.id,
          senderId: spec.agent,
          senderName: spec.agentName,
          role: "assistant",
          text: answer,
        },
      ],
      { flush: true, sessionId: turn.sessionId }
    );
  }

  return { answer, memories };
}
