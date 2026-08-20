import { createFileRoute } from "@tanstack/react-router";
import { AppShell } from "@/components/ahanu/AppShell";

export const Route = createFileRoute("/")({ component: Bridge });

function Bridge() {
  return <AppShell />;
}
