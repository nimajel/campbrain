import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { signIn, useSession } from "@/lib/auth-client";

/** Declarative gate: renders children when signed in, else fallback. UX only —
 *  the API's protectedProcedure is the real security boundary. */
export function AuthGate({ children, fallback }: { children: ReactNode; fallback?: ReactNode }) {
  const { data: session, isPending } = useSession();
  if (isPending) return null;
  return session ? <>{children}</> : <>{fallback ?? null}</>;
}

/** Full sign-in prompt used as the fallback for whole gated surfaces. */
export function SignInPrompt({ message }: { message?: string } = {}) {
  return (
    <div className="mx-auto max-w-sm space-y-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Welcome to CampBrain</h1>
      {message ? <p className="text-sm text-muted-foreground">{message}</p> : null}
      <Button onClick={() => signIn.social({ provider: "google" })}>Sign in with Google</Button>
    </div>
  );
}

/** Gate that shows a full sign-in prompt when unauthenticated (for /saved etc.). */
export function RequireAuth({ children, message }: { children: ReactNode; message?: string }) {
  return <AuthGate fallback={<SignInPrompt message={message} />}>{children}</AuthGate>;
}
