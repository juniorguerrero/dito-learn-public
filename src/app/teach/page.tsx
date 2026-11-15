import { redirect } from "next/navigation";

// Backward-compatible alias: /teach -> /teacher
export default function TeachRedirect() {
  redirect("/teacher");
}
