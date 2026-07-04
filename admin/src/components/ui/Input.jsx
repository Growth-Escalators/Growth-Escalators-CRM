import React, { useId } from 'react';

/**
 * Fluent Input — 4px radius, primary focus glow, label + helper text.
 *
 * <Input label="First name" required placeholder="Meera" />
 * <Input label="Email" type="email" error="Enter a valid address" />
 */
export default function Input({
  label,
  required = false,
  error = '',
  help = '',
  className = '',
  ...rest
}) {
  const id = useId();
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block text-[13px] font-semibold text-neutral-700 mb-1">
          {label}
          {required && <span className="text-danger-500 ml-0.5">*</span>}
        </label>
      )}
      <input
        id={id}
        aria-invalid={!!error}
        className={`w-full h-9 rounded-sm px-3 text-sm bg-white transition-all duration-200
          placeholder:text-neutral-400
          focus:outline-none focus:ring-2
          ${error
            ? 'border border-danger-500 focus:border-danger-500 focus:ring-danger-500/20'
            : 'border border-neutral-300 focus:border-primary-500 focus:ring-primary-200'}`}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-danger-600 mt-1">{error}</p>
      ) : help ? (
        <p className="text-xs text-neutral-400 mt-1">{help}</p>
      ) : null}
    </div>
  );
}
