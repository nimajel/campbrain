import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/request-access")({
  component: () => (
    <div className="mx-auto max-w-md py-16 text-center">
      <h1 className="text-xl font-semibold">Request access</h1>
      <p className="text-muted-foreground">CampBrain is invite-only right now. Ask the owner to add your email.</p>
    </div>
  ),
});
