import type { AnchorHTMLAttributes, ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonVariant = 'primary' | 'ghost' | 'slate' | 'danger' | 'success';

interface BaseProps {
  variant?: ButtonVariant;
  size?: 'sm';
  children: ReactNode;
}

type AsButton = BaseProps & ButtonHTMLAttributes<HTMLButtonElement> & { href?: undefined };
type AsAnchor = BaseProps & AnchorHTMLAttributes<HTMLAnchorElement> & { href: string };

export type ButtonProps = AsButton | AsAnchor;

function btnClasses(variant?: ButtonVariant, size?: 'sm', className?: string): string {
  return ['btn', variant && `btn-${variant}`, size && `btn-${size}`, className]
    .filter(Boolean)
    .join(' ');
}

export default function Button(props: ButtonProps) {
  if (props.href !== undefined) {
    const { variant, size, className, children, href, ...rest } = props;
    return (
      <a href={href} className={btnClasses(variant, size, className)} {...rest}>
        {children}
      </a>
    );
  }
  const { variant, size, className, children, type, ...rest } = props;
  return (
    <button type={type ?? 'button'} className={btnClasses(variant, size, className)} {...rest}>
      {children}
    </button>
  );
}
