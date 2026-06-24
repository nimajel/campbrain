import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/features/auth/AuthGate";
import { DashboardPage } from "@/features/dashboard/DashboardPage";

export const Route = createFileRoute("/dashboard")({
  component: () => (
    <RequireAuth message="Sign in to see your alert results.">
      <DashboardPage />
    </RequireAuth>
  ),
});
