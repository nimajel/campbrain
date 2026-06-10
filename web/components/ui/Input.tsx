import type { InputHTMLAttributes } from 'react';

export default function Input({
  label,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label?: string }) {
  const input = (
    <input {...rest} className={['form-input', className].filter(Boolean).join(' ')} />
  );
  if (!label) return input;
  return (
    <label className="form-row">
      {label}
      {input}
    </label>
  );
}
