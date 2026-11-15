"use client";

import { useEffect, useRef, useState } from "react";
import { ChatMessage } from "@/lib/types";

export default function ProfessorChat({ classroomId }: { classroomId: string }) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, sending]);

  async function send(q: string) {
    if (!q.trim() || sending) return;
    const history = messages;
    setMessages((m) => [...m, { role: "user", content: q }]);
    setInput("");
    setSending(true);
    try {
      const res = await fetch(`/api/classrooms/${classroomId}/chat`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history }),
      });
      const json = await res.json();
      setMessages((m) => [...m, { role: "assistant", content: json.answer || json.error || "Try again?" }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Couldn't reach the assistant — try again." }]);
    } finally {
      setSending(false);
    }
  }

  const suggestions = [
    "Which students are falling behind?",
    "What are students most confused about?",
    "What should I create next?",
    "Summarize how my class is doing",
  ];

  return (
    <div className="mx-auto flex h-[600px] max-w-3xl flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-r from-violet-600 to-fuchsia-600 p-4 text-white">
        <p className="font-bold">🤖 Teaching assistant</p>
        <p className="text-xs opacity-80">Ask about your class — grounded in live student activity</p>
      </div>

      <div ref={scrollRef} className="nice-scroll flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <div className="mt-6 text-center text-sm text-slate-400">
            <p>I know how your class is engaging with each lesson.</p>
            <p className="mt-1">Try a question below 👇</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
              m.role === "user" ? "bg-violet-600 text-white" : "bg-slate-100 text-slate-700"
            }`}>
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-2xl bg-slate-100 px-3.5 py-2.5">
              <span className="flex gap-1">
                <span className="h-2 w-2 animate-bounce rounded-full bg-slate-400" />
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
            <button key={s} onClick={() => send(s)} className="rounded-full border border-slate-200 px-2.5 py-1 text-xs text-slate-500 transition hover:border-violet-300 hover:text-violet-600">
              {s}
            </button>
          ))}
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="flex gap-2 border-t border-slate-100 p-3">
        <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask about your class…"
          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-violet-400" />
        <button type="submit" disabled={sending || !input.trim()}
          className="rounded-xl bg-violet-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:opacity-40">
          Send
        </button>
      </form>
    </div>
  );
}
