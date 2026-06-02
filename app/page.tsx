import { listProjects } from "@/lib/sources";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await listProjects();
  return <AppShell initialProjects={projects} />;
}
