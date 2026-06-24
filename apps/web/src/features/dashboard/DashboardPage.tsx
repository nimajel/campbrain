import { Link } from "@tanstack/react-router";
import { useDashboard } from "./hooks/use-dashboard";
import { StatCards } from "./components/StatCards";
import { RecentOpeningsTable } from "./components/RecentOpeningsTable";

function formatScanTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function DashboardPage() {
  const { stats, openings, lastScan, isLoading, isError } = useDashboard();

  if (isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12 text-center text-sm text-muted-foreground">
        Loading&hellip;
      </div>
    );
  }

  if (isError) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="mb-6 text-xl font-semibold">Dashboard</h1>
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
          Couldn&apos;t load your dashboard. Please refresh or sign in again.
        </div>
      </div>
    );
  }

  const hasStats = stats !== undefined;
  const hasOpenings = openings !== undefined;

  const showEmptyState =
    hasStats &&
    hasOpenings &&
    stats.activeAlerts === 0 &&
    openings.length === 0;

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <h1 className="mb-6 text-xl font-semibold">Dashboard</h1>

      {hasStats && <StatCards stats={stats} />}

      <div className="mt-3 text-[12px] text-muted-foreground">
        {lastScan === undefined ? null : lastScan === null ? (
          "Not scanned yet"
        ) : (
          <>Last checked: {formatScanTime(lastScan.finishedAt)}</>
        )}
      </div>

      {showEmptyState ? (
        <div className="mt-8 rounded-xl border bg-muted/40 p-6 text-center text-sm text-muted-foreground">
          No alerts yet &mdash; enable alerts on a{" "}
          <Link to="/saved" className="underline hover:text-foreground">
            saved search
          </Link>
          .
        </div>
      ) : (
        hasOpenings && openings.length > 0 && (
          <div className="mt-6">
            <h2 className="mb-3 text-sm font-semibold">Recent openings</h2>
            <RecentOpeningsTable openings={openings} />
          </div>
        )
      )}
    </div>
  );
}
