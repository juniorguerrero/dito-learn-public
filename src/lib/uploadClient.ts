import { uploadError } from "./uploadRules";

// Browser helper shared by both uploaders: POST the form and turn any failure
// into a message a teacher can act on.
export async function postLessonMaterial<T>(url: string, form: FormData): Promise<{ ok: true; data: T } | { ok: false; message: string }> {
  let res: Response;
  try {
    res = await fetch(url, { method: "POST", body: form });
  } catch {
    return { ok: false, message: "Couldn't reach the server. Check your connection and try again." };
  }
  const json = (await res.json().catch(() => null)) as (T & { error?: string }) | null;
  if (res.ok && json) return { ok: true, data: json };
  if (json?.error) return { ok: false, message: json.error };
  if (res.status === 413) return { ok: false, message: uploadError("request_too_large").message };
  return { ok: false, message: `The upload failed (HTTP ${res.status}). Please try again.` };
}
