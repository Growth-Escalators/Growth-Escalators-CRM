import React from 'react';

/**
 * Fluent Button — 5 variants, 3 sizes.
 * <Button variant="primary" icon={<Plus />}>Add Contact</Button>
 */
const VARIANTS = {
  primary: 'bg-primary-500 hover:bg-primary-600 active:bg-primary-700 text-white',
  accent: 'bg-accent-500 hover:bg-accent-600 active:bg-accent-700 text-white',
  standard: 'bg-neutral-100 hover:bg-neutral-200 text-neutral-700 border border-neutral-200',
  subtle: 'bg-transparent hover:bg-neutral-100 text-neutral-600',
  danger: 'bg-danger-500 hover:bg-danger-600 text-white',
};

const SIZES = {
  compact: 'h-8 px-3 text-xs',
  standard: 'h-9 px-4 text-sm',
  large: 'h-10 px-5 text-sm',
};

export default function Button({
  variant = 'standard',
  size = 'standard',
  icon = null,
  disabled = false,
  className = '',
  children,
  ...rest
}) {
  return (
    <button
      disabled={disabled}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md font-semibold
        transition-all duration-200 ease-fluent select-none
        disabled:opacity-50 disabled:pointer-events-none
        ${VARIANTS[variant] ?? VARIANTS.standard} ${SIZES[size] ?? SIZES.standard} ${className}`}
      {...rest}
    >
      {icon && <span className="w-4 h-4 [&>svg]:w-4 [&>svg]:h-4">{icon}</span>}
      {children}
    </button>
  );
}
