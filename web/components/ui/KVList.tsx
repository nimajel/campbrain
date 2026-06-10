import type { ReactNode } from 'react';

export function KVRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="kv-row">
      <span className="kv-key">{label}</span>
      <span className="kv-val">{children}</span>
    </div>
  );
}

export default function KVList({ items }: { items: Array<{ key: string; value: ReactNode }> }) {
  return (
    <>
      {items.map((item) => (
        <KVRow key={item.key} label={item.key}>
          {item.value}
        </KVRow>
      ))}
    </>
  );
}
