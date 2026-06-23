import { createFileRoute } from "@tanstack/react-router";
import { RequireAuth } from "@/features/auth/AuthGate";
import { SavedPage } from "@/features/saved/SavedPage";

export const Route = createFileRoute("/saved")({
  component: () => (
    <RequireAuth message="Sign in to save and manage your searches.">
      <SavedPage />
    </RequireAuth>
  ),
});
