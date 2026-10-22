import { requireUser } from "@/lib/auth";
import { ProjectDetail } from "@/components/project-detail";
export const dynamic = "force-dynamic";
export const metadata = { title: "Project" };
export default async function ProjectPage({ params }: { params: Promise<{ id: string }> }) { await requireUser("projects.view"); const { id } = await params; return <ProjectDetail projectId={id} />; }
