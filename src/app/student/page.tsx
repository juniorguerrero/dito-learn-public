import StudentOnboarding from "@/components/student/StudentOnboarding";

export const dynamic = process.env.STATIC_EXPORT === "1" ? "force-static" : "force-dynamic";

export default function LearnPage() {
  return <StudentOnboarding />;
}
