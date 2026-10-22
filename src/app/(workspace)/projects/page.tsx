import { requireUser } from "@/lib/auth";
import { ModuleTabs } from "@/components/module-tabs";
export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };
export default async function ProjectsPage() { const user = await requireUser("projects.view"); return <ModuleTabs user={user} tabs={["projects", "tasks"]} defaultTab="projects" title="Projects & delivery" eyebrow="Delivery command" description="Move from scoped engagement to verified launch with visible ownership, tasks, priorities, milestones and repository mappings." />; }
