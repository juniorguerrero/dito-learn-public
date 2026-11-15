"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DirectMessage } from "@/lib/types";

interface StudentLite {
  id: string;
  name: string;
  interests: string[];
}

interface ConversationSummary {
  student_id: string;
  last_text: string;
  last_sender: "professor" | "student";
  last_at: string;
  count: number;
}

const POLL_MS = 4000;

export default function MessagesPanel({ classroomId, students }: { classroomId: string; students: StudentLite[] }) {
  const [selected, setSelected] = useState<string | null>(students[0]?.id || null);
  const [summaries, setSummaries] = useState<Record<string, ConversationSummary>>({});
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const countRef = useRef(0);

  const refresh = useCallback(async () => {
    try {
      const [convRes, threadRes] = await Promise.all([
        fetch(`/api/classrooms/${classroomId}/messages`),
        selected ? fetch(`/api/classrooms/${classroomId}/students/${selected}/messages`) : Promise.resolve(null),
      ]);
      const conv = await convRes.json();
      const map: Record<string, ConversationSummary> = {};
      (conv.conversations || []).forEach((c: ConversationSummary) => (map[c.student_id] = c));
      setSummaries(map);
      if (threadRes) {
        const thread = await threadRes.json();
        setMessages(thread.messages || []);
      }
    } catch {
      /* keep last state */
    }
  }, [classroomId, selected]);

  useEffect(() => {
    refresh();
    const t = setInterval(refresh, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  useEffect(() => {
    if (messages.length !== countRef.current) {
      countRef.current = messages.length;
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
    }
  }, [messages]);

  async function send(text: string) {
    if (!text.trim() || sending || !selected) return;
    setSending(true);
    setInput("");
    try {
      const res = await fetch(`/api/classrooms/${classroomId}/students/${selected}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "professor", text }),
      });
      const json = await res.json();
      if (json.message) setMessages((m) => [...m, json.message]);
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }

  const current = students.find((s) => s.id === selected);

  if (students.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-slate-400">
        No students yet — once someone joins with your code, you can message them here.
      </p>
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[280px_1fr]">
      {/* Student threads */}
      <div className="space-y-2">
        {students.map((s) => {
          const sum = summaries[s.id];
          return (
            <button
              key={s.id}
              onClick={() => { setSelected(s.id); setMessages([]); countRef.current = 0; }}
              className={`w-full rounded-2xl border p-3 text-left transition ${
                selected === s.id ? "border-violet-400 bg-violet-50 shadow-sm" : "border-slate-200 bg-white hover:border-violet-200"
              }`}
            >
              <div className="flex items-center gap-2">
                <div className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-violet-100 text-sm font-bold text-violet-600">
                  {s.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{s.name}</p>
                  <p className="truncate text-xs text-slate-400">
                    {sum ? `${sum.last_sender === "professor" ? "You: " : ""}${sum.last_text}` : "No messages yet"}
                  </p>
                </div>
                {sum && sum.last_sender === "student" && (
                  <span className="h-2 w-2 shrink-0 rounded-full bg-fuchsia-500" title="Student sent the last message" />
                )}
              </div>
            </button>
          );
        })}
      </div>

      {/* Conversation */}
      <div className="flex h-[560px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 bg-gradient-to-r from-violet-600 to-fuchsia-600 p-4 text-white">
          <p className="font-bold">💬 {current?.name || "Messages"}</p>
          <p className="text-xs opacity-80">Direct messages · remembered by EverMind so your AI assistant knows the full story</p>
        </div>

        <div ref={scrollRef} className="nice-scroll flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="pt-8 text-center text-sm text-slate-400">
              Start the conversation with {current?.name || "this student"} — a nudge, praise, or a check-in.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`flex ${m.sender === "professor" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
                m.sender === "professor" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-700"
              }`}>
                {m.text}
              </div>
            </div>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-slate-100 p-3">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={`Message ${current?.name || "student"}…`}
            className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400"
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
