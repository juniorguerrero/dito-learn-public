"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ACCEPT_ATTRIBUTE, ACCEPTED_LABEL, MAX_UPLOAD_LABEL, formatBytes, precheckFile, uploadError } from "@/lib/uploadRules";

// One file picker for both uploaders (standalone /upload and the teacher's
// classroom). Supports drag-and-drop, the ordinary file dialog, and keyboard
// (the zone is a real <button>: Tab to it, Enter/Space opens the dialog).
// Files are pre-checked in the browser with the same rules the server uses.

const hasFiles = (e: DragEvent | React.DragEvent) => Array.from(e.dataTransfer?.types ?? []).includes("Files");

export default function FileDropZone({
  file,
  onFileChange,
  onError,
  disabled = false,
  compact = false,
}: {
  file: File | null;
  onFileChange: (file: File | null) => void;
  /** Validation message for a rejected file ("" clears it). */
  onError: (message: string) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const depth = useRef(0); // dragenter/dragleave fire for child elements too
  const [dragOver, setDragOver] = useState(false);
  const [checking, setChecking] = useState(false);
  const hintId = useId();

  // A file dropped just outside the zone must not make the browser open it
  // and navigate away from the form (losing what the teacher typed).
  useEffect(() => {
    const guard = (e: DragEvent) => {
      if (!hasFiles(e) || zone.current?.contains(e.target as Node)) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "none";
    };
    window.addEventListener("dragover", guard);
    window.addEventListener("drop", guard);
    return () => {
      window.removeEventListener("dragover", guard);
      window.removeEventListener("drop", guard);
    };
  }, []);

  async function accept(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (files.length > 1) {
      onError(uploadError("multiple_files").message);
      return;
    }
    const f = files[0];
    setChecking(true);
    try {
      const problem = await precheckFile(f);
      if (problem) {
        onFileChange(null);
        onError(problem.message);
      } else {
        onFileChange(f);
        onError("");
      }
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      ref={zone}
      data-testid="file-drop-zone"
      data-drag-over={dragOver || undefined}
      onDragEnter={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault();
        depth.current++;
        setDragOver(true);
      }}
      onDragOver={(e) => {
        if (disabled || !hasFiles(e)) return;
        e.preventDefault(); // marks this as a valid drop target
        e.dataTransfer.dropEffect = "copy";
      }}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragOver(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragOver(false);
        if (!disabled) void accept(e.dataTransfer.files);
      }}
      className={`relative rounded-2xl border-2 border-dashed text-center transition ${compact ? "p-4" : "p-8"} ${
        dragOver ? "border-violet-500 bg-violet-50" : "border-slate-300 bg-white hover:border-violet-300"
      } ${disabled ? "opacity-60" : ""}`}
    >
      <input
        ref={input}
        type="file"
        accept={ACCEPT_ATTRIBUTE}
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="file-input"
        onChange={(e) => {
          const files = e.target.files;
          void accept(files).finally(() => {
            // Reset so choosing the same file again (e.g. after fixing it, or after an error) fires "change".
            if (input.current) input.current.value = "";
          });
        }}
      />
      <button
        type="button"
        disabled={disabled || checking}
        onClick={() => input.current?.click()}
        aria-describedby={hintId}
        className="w-full rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-violet-500 focus-visible:ring-offset-2"
        data-testid="choose-file"
      >
        {file ? (
          <span className="block">
            <span className="block break-all font-medium text-violet-700">📄 {file.name}</span>
            <span className="mt-1 block text-xs text-slate-400">{formatBytes(file.size)} · click, press Enter or drop to replace</span>
          </span>
        ) : (
          <span className="block">
            <span className={`block font-medium ${compact ? "text-sm" : ""}`}>
              {dragOver ? "Drop the file to add it" : checking ? "Checking file…" : "Drop a file here, or click to choose"}
            </span>
          </span>
        )}
      </button>
      <p id={hintId} className="mt-1 text-xs text-slate-400">
        {ACCEPTED_LABEL} · up to {MAX_UPLOAD_LABEL}
      </p>
      {file && (
        <button
          type="button"
          onClick={() => {
            onFileChange(null);
            onError("");
          }}
          disabled={disabled}
          aria-label={`Remove ${file.name}`}
          data-testid="remove-file"
          className="mt-2 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 outline-none hover:bg-slate-100 hover:text-red-600 focus-visible:ring-2 focus-visible:ring-violet-500"
        >
          ✕ Remove file
        </button>
      )}
      <span className="sr-only" aria-live="polite">
        {checking ? "Checking file" : file ? `Selected ${file.name}` : ""}
      </span>
    </div>
  );
}
