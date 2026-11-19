/**
 * Icons the kit doesn't have yet, drawn to its recipe: 24×24 strokes in currentColor, 2px wide,
 * round caps and joins, size-5 by default, decorative (the button around one names it).
 */
export function ShuffleIcon({ className = 'size-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5" />
    </svg>
  );
}
