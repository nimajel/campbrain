import type { CSSProperties, ReactNode } from 'react';

export default function StatCard({
  label,
  value,
  valueStyle,
}: {
  label: string;
  value: ReactNode;
  valueStyle?: CSSProperties;
}) {
  return (
    <div className="card">
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={valueStyle}>{value}</div>
    </div>
  );
}
