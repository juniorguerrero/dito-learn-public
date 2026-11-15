import { redirect } from "next/navigation";

// Backward-compatible alias: /learn -> /student
export default function LearnRedirect() {
  redirect("/student");
}
