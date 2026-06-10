export type DotTone = 'green' | 'red' | 'gray' | 'yellow';

export default function StatusDot({ tone }: { tone: DotTone }) {
  return <span className={`dot dot-${tone}`} aria-hidden="true" />;
}
