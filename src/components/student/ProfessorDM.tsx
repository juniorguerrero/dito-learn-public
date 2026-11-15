"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { DirectMessage } from "@/lib/types";
import { LocalStudent } from "@/lib/studentClient";

const POLL_MS = 4000;

export default function ProfessorDM({
  classroomId,
  professorName,
  student,
}: {
  classroomId: string;
  professorName: string;
  student: LocalStudent | null;
}) {
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const countRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!student) return;
    try {
      const res = await fetch(`/api/classrooms/${classroomId}/students/${student.id}/messages`);
      const json = await res.json();
      setMessages(json.messages || []);
    } catch {
      /* keep last state */
    }
  }, [classroomId, student]);

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
    if (!text.trim() || sending || !student) return;
    setSending(true);
    setInput("");
    try {
      const res = await fetch(`/api/classrooms/${classroomId}/students/${student.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sender: "student", text }),
      });
      const json = await res.json();
      if (json.message) setMessages((m) => [...m, json.message]);
    } catch {
      /* ignore */
    } finally {
      setSending(false);
    }
  }

  if (!student) return null;

  return (
    <div className="mt-4 flex h-[380px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
      <div className="border-b border-slate-100 bg-gradient-to-r from-fuchsia-600 to-violet-600 p-4 text-white">
        <p className="font-bold">💬 Message {professorName}</p>
        <p className="text-xs opacity-80">Your professor sees this and replies here</p>
      </div>

      <div ref={scrollRef} className="nice-scroll flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="pt-6 text-center text-sm text-slate-400">
            Say hi, ask for help, or share how the class is going.
          </p>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.sender === "student" ? "justify-end" : "justify-start"}`}>
            <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2.5 text-sm ${
              m.sender === "student" ? "bg-fuchsia-600 text-white" : "bg-slate-100 text-slate-700"
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
          placeholder="Write a message…"
          className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm outline-none focus:border-fuchsia-400"
        />
        <button
          type="submit"
          disabled={sending || !input.trim()}
          className="rounded-xl bg-fuchsia-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-fuchsia-700 disabled:opacity-40"
        >
          Send
        </button>
      </form>
    </div>
  );
}
