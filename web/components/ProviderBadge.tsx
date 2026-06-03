import { PROVIDER_BADGES } from '../lib/providers';

interface Props {
  providerId: string;
  style?: React.CSSProperties;
}

export default function ProviderBadge({ providerId, style }: Props) {
  const config = PROVIDER_BADGES[providerId];
  if (!config) return null;

  const colorClass = `badge-${config.color}`;
  return (
    <span
      className={`badge ${colorClass}`}
      style={{ fontSize: 10, ...style }}
    >
      {config.label}
    </span>
  );
}
