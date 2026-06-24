import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/features/auth/AuthGate";
import { TargetsPage } from "@/features/alerts/TargetsPage";

export const Route = createFileRoute("/alerts")({
  component: () => (
    <RequireAuth message="Sign in to manage your booking reminders.">
      <TargetsPage />
    </RequireAuth>
  ),
});
