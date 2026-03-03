const badgeSizeClasses = {
  sm: 'px-2 py-0.5 text-[10px]',
  md: 'px-2.5 py-1 text-xs',
}

export default function ProBadge({ label = 'Pro Forever', size = 'sm', className = '' }) {
  const sizeClasses = badgeSizeClasses[size] ?? badgeSizeClasses.sm

  return (
    <span
      role="status"
      aria-label={`${label} subscription`}
      className={[
        'inline-flex select-none items-center gap-1 rounded-full border border-amber-200/70',
        'bg-gradient-to-r from-amber-100 via-orange-100 to-rose-100 text-amber-900',
        'font-semibold tracking-wide shadow-[0_1px_6px_rgba(245,158,11,0.26)]',
        sizeClasses,
        className,
      ].join(' ')}
    >
      <span aria-hidden="true" className="text-[11px] leading-none">{'\u2728'}</span>
      <span className="leading-none">{label}</span>
    </span>
  )
}
