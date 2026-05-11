import { listProjects } from "@/lib/session-loader";
import { AppShell } from "@/components/app-shell";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const projects = await listProjects();
  return <AppShell initialProjects={projects} />;
}
