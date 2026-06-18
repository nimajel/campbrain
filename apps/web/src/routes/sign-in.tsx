import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { signIn } from "@/lib/auth-client";

export const Route = createFileRoute("/sign-in")({
  component: () => (
    <div className="mx-auto max-w-sm space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Sign in to CampBrain</h1>
      <Button onClick={() => signIn.social({ provider: "google" })}>Sign in with Google</Button>
    </div>
  ),
});
