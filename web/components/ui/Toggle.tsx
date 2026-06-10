'use client';

export default function Toggle({
  checked,
  onChange,
  label,
  disabled = false,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: string;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const control = (
    <>
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        aria-label={ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="toggle-slider" />
    </>
  );
  if (!label) return <label className="toggle">{control}</label>;
  return (
    <label className="label-inline" style={{ display: 'flex' }}>
      <span className="toggle">{control}</span>
      {label}
    </label>
  );
}
