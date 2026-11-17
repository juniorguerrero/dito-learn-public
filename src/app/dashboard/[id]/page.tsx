import Link from "next/link";
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
  return (
    <>
      {project.archived_at && (
        <div role="status" data-testid="dashboard-archived-banner" className="mx-auto mt-4 max-w-7xl px-4">
          <p className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-800">
            🗄️ This lesson is archived: students don&apos;t see it.
            {project.classroom_id && (
              <>
                {" "}
                <Link href={`/teacher/${project.classroom_id}`} className="font-semibold underline">Restore it from the classroom page</Link>.
              </>
            )}
          </p>
        </div>
      )}
      <Dashboard initialProject={project} />
    </>
  );
}
