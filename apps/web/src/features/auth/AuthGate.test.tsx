import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const useSession = vi.fn();
vi.mock("@/lib/auth-client", () => ({
  useSession: () => useSession(),
  signIn: { social: vi.fn() },
  signOut: vi.fn(),
}));

import { AuthGate, RequireAuth } from "./AuthGate";

describe("AuthGate", () => {
  beforeEach(() => useSession.mockReset());

  it("renders children when a session exists", () => {
    useSession.mockReturnValue({ data: { user: { id: "u1" } }, isPending: false });
    render(<AuthGate fallback={<span>nope</span>}><span>secret</span></AuthGate>);
    expect(screen.getByText("secret")).toBeInTheDocument();
    expect(screen.queryByText("nope")).not.toBeInTheDocument();
  });

  it("renders the fallback when there is no session", () => {
    useSession.mockReturnValue({ data: null, isPending: false });
    render(<AuthGate fallback={<span>nope</span>}><span>secret</span></AuthGate>);
    expect(screen.getByText("nope")).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });

  it("renders nothing while the session is pending", () => {
    useSession.mockReturnValue({ data: null, isPending: true });
    const { container } = render(<AuthGate><span>secret</span></AuthGate>);
    expect(container).toBeEmptyDOMElement();
  });

  it("RequireAuth shows the sign-in prompt when signed out", () => {
    useSession.mockReturnValue({ data: null, isPending: false });
    render(<RequireAuth><span>secret</span></RequireAuth>);
    expect(screen.getByText(/sign in/i)).toBeInTheDocument();
    expect(screen.queryByText("secret")).not.toBeInTheDocument();
  });
});
