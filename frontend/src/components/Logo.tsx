/**
 * Our own mark: one path today that splits into two futures. The gray branch
 * is the same path, the orange branch is the plan. Same drawing as app/icon.svg.
 */
export function Logo({ size = 28, className = "" }: { size?: number; className?: string }) {
  return (
    <svg viewBox="0 0 32 32" width={size} height={size} className={className} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#0b2545" />
      <path d="M16 26v-7.5" stroke="#ffffff" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 18.5c0-4-5-5-6.5-8.5" fill="none" stroke="#8792a2" strokeWidth="2.6" strokeLinecap="round" />
      <path d="M16 18.5c0-4 5-5 6.5-8.5" fill="none" stroke="#ef6a1a" strokeWidth="2.6" strokeLinecap="round" />
      <circle cx="9.5" cy="8.5" r="2.4" fill="#8792a2" />
      <circle cx="22.5" cy="8.5" r="2.8" fill="#ef6a1a" />
    </svg>
  );
}
