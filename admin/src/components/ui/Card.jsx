import React from 'react';

/**
 * Fluent Card — elevation at rest, lifts on hover when interactive.
 * Optional 3px accent bar on top for KPI / priority cards.
 *
 * <Card accent="primary" hover onClick={...}>
 *   <Card.Header title="AI Coaching Score" action={<Button size="compact">View</Button>} />
 *   <Card.Body>…</Card.Body>
 * </Card>
 */
const ACCENTS = {
  primary: 'before:bg-primary-500',
  accent: 'before:bg-accent-500',
  success: 'before:bg-success-500',
  danger: 'before:bg-danger-500',
};

export default function Card({ accent = null, hover = false, className = '', children, ...rest }) {
  return (
    <div
      className={`relative overflow-hidden bg-white border border-neutral-200 rounded-lg shadow-card
        transition-shadow duration-200 ease-fluent
        ${hover ? 'hover:shadow-hover cursor-pointer' : ''}
        ${accent ? `before:content-[''] before:absolute before:top-0 before:inset-x-0 before:h-[3px] ${ACCENTS[accent]}` : ''}
        ${className}`}
      {...rest}
    >
      {children}
    </div>
  );
}

Card.Header = function CardHeader({ title, subtitle, action }) {
  return (
    <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-neutral-100">
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        {subtitle && <p className="text-xs text-neutral-500 mt-0.5">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
};

Card.Body = function CardBody({ className = '', children }) {
  return <div className={`px-5 py-4 ${className}`}>{children}</div>;
};

Card.Footer = function CardFooter({ children }) {
  return <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-neutral-100">{children}</div>;
};
