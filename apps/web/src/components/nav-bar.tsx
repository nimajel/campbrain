import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { signIn, signOut, useSession } from "@/lib/auth-client";

export function NavBar() {
  const { data: session } = useSession();
  return (
    <header className="flex items-center justify-between border-b px-4 py-2">
      <nav className="flex gap-4">
        <Link to="/">Map</Link>
        <Link to="/explore">Explore</Link>
        <Link to="/saved">Saved</Link>
        <Link to="/alerts">Alerts</Link>
      </nav>
      {session ? (
        <Button variant="ghost" onClick={() => signOut()}>Sign out</Button>
      ) : (
        <Button onClick={() => signIn.social({ provider: "google" })}>
          Sign in with Google
        </Button>
      )}
    </header>
  );
}
