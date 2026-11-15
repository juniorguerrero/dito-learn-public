import { notFound } from "next/navigation";
import { getProject, listProjects } from "@/lib/store";
import Dashboard from "@/components/Dashboard";

export const dynamic = process.env.STATIC_EXPORT === "1" ? "force-static" : "force-dynamic";

export function generateStaticParams() {
  return listProjects().map((p) => ({ id: p.id }));
}

export default function DashboardPage({ params }: { params: { id: string } }) {
  const project = getProject(params.id);
  if (!project) notFound();
  return <Dashboard initialProject={project} />;
}
