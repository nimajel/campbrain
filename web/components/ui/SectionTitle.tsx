export default function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <>
      <div className="section-title">{title}</div>
      {desc && <p className="section-desc">{desc}</p>}
    </>
  );
}
