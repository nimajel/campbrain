import type { DashboardStats } from "@campbrain/types";

interface Props {
  stats: DashboardStats;
}

interface StatCardProps {
  label: string;
  value: number;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="text-3xl font-bold tabular-nums">{value}</div>
      <div className="mt-1 text-sm text-muted-foreground">{label}</div>
    </div>
  );
}

export function StatCards({ stats }: Props) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatCard label="Active alerts" value={stats.activeAlerts} />
      <StatCard label="Current matches" value={stats.currentMatches} />
      <StatCard label="Total openings seen" value={stats.totalHits} />
    </div>
  );
}
