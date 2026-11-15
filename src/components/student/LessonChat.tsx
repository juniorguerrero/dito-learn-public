"use client";

import { useEffect, useRef, useState } from "react";
import { ChatMessage } from "@/lib/types";
import { LocalStudent } from "@/lib/studentClient";

export default function LessonChat({
  lessonId,
  classroomId,
  student,
  lessonTitle,
}: {
  lessonId: string;
  classroomId: string;
  student: LocalStudent | null;
  lessonTitle: string;
}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send(question: string) {
    if (!question.trim() || sending) return;
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: question }]);
    setInput("");
    setSending(true);
    try {
      const res = await fetch(`/api/lessons/${lessonId}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question, history,
          classroom_id: classroomId,
          student_id: student?.id,
          student_name: student?.name,
        }),
      });
      const json = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: json.answer || json.error || "Hmm, try again?" }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "I couldn't reach the tutor — try again." }]);
    } finally {
      setSending(false);
    }
  }

  const suggestions = ["Explain this simply", "Give me an example", "Why does this matter?", "Quiz me"];

  return (
    <div className="flex h-full flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-r from-fuchsia-600 to-violet-600 p-4 text-white">
        <p className="font-bold">🤖 Ask Antclass</p>
        <p className="text-xs opacity-80">Your AI tutor for this lesson</p>
      </div>

      <div ref={scrollRef} className="nice-scroll flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="text-center text-sm text-slate-400">
            <p>Stuck on <span className="font-medium text-slate-500">{lessonTitle}</span>?</p>
            <p className="mt-1">Ask me anything — I only use this lesson&apos;s material.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
              m.role === "user" ? "bg-fuchsia-600 text-white" : "bg-slate-100 text-slate-700"
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-slate-100 px-3.5 py-2.5">
              <span className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "0ms" }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "150ms" }} />
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: "300ms" }} />
              </span>
            </div>
          </div>
        )}
      </div>

      {messages.length === 0 && (
        <div className="flex flex-wrap gap-1.5 px-4 pb-2">
          {suggestions.map((s) => (
            <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500 transition hover:border-fuchsia-300 hover:text-fuchsia-600">
              {s}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-slate-100 p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask a question…"
          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-fuchsia-400" />
        <button type="submit" disabled={sending || !input.trim()}
          className="rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-700 disabled:opacity-40">
          Send
        </button>
      </form>
    </div>
  );
}
