import { useId } from 'react';

export function BrandIcon({ className = 'h-10 w-10', title = 'SideLink logo' }: { className?: string; title?: string }) {
  const gradientId = useId();

  return (
    <svg aria-label={title} className={className} viewBox="0 0 64 64" fill="none" role="img" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop stopColor="#1e1e2e" />
          <stop offset="1" stopColor="#0f0f17" />
        </linearGradient>
      </defs>
      <rect width="64" height="64" rx="16" fill={`url(#${gradientId})`} />
      <path
        d="M38.4 17.6c-2.7 0-5.2.8-7 2.4-2.2 1.9-3.4 4.8-3.4 8.2 0 2.4.6 4.2 1.8 5.6 1.1 1.3 2.7 2.3 4.8 3.2l4.2 1.8c1.4.6 2.4 1.2 3 2 .7.8 1 1.9 1 3.2 0 1.8-.6 3.2-1.7 4.2-1.1 1-2.6 1.4-4.5 1.4-1.6 0-3-.4-4.2-1.2-1.2-.8-2-2-2.4-3.4l-3.6 1.2c.6 2.2 1.9 4 3.8 5.2 1.9 1.2 4.1 1.8 6.6 1.8 3.2 0 5.7-.9 7.6-2.8 1.9-1.9 2.8-4.4 2.8-7.4 0-2.4-.6-4.4-1.9-5.8-1.2-1.4-3-2.6-5.2-3.4l-4-1.6c-1.4-.6-2.4-1.2-3-1.8-.6-.7-.9-1.6-.9-2.8 0-1.6.5-2.9 1.6-3.8 1-.9 2.4-1.4 4-1.4 1.3 0 2.4.3 3.4 1 1 .7 1.7 1.6 2.1 2.8l3.4-1.2c-.6-1.9-1.7-3.4-3.3-4.4-1.6-1.1-3.5-1.6-5.6-1.6h-.3Z"
        fill="white"
        fillOpacity="0.92"
      />
    </svg>
  );
}