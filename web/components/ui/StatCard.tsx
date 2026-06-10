import type { CSSProperties, ReactNode } from 'react';
import Card from './Card';

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
    <Card>
      <div className="stat-label">{label}</div>
      <div className="stat-value" style={valueStyle}>{value}</div>
    </Card>
  );
}
