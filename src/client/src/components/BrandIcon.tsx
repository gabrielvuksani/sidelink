import { useId } from 'react';

export function BrandIcon({ className = 'h-10 w-10', title = 'Sidelink logo' }: { className?: string; title?: string }) {
  const gradientId = useId();
  const highlightId = useId();

  return (
    <svg aria-label={title} className={className} viewBox="0 0 64 64" fill="none" role="img" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id={gradientId} x1="10" y1="8" x2="54" y2="58" gradientUnits="userSpaceOnUse">
          <stop stopColor="#305BFF" />
          <stop offset="1" stopColor="#8E40FF" />
        </linearGradient>
        <radialGradient id={highlightId} cx="0" cy="0" r="1" gradientTransform="matrix(0 21 -28 0 30 20)" gradientUnits="userSpaceOnUse">
          <stop stopColor="white" stopOpacity="0.36" />
          <stop offset="1" stopColor="white" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill={`url(#${gradientId})`} />
      <rect x="2" y="2" width="60" height="60" rx="14" fill={`url(#${highlightId})`} />
      <rect x="14" y="20" width="21" height="21" rx="8.5" stroke="rgba(255,255,255,0.94)" strokeWidth="3.8" />
      <rect x="30" y="23" width="21" height="21" rx="8.5" stroke="rgba(255,255,255,0.94)" strokeWidth="3.8" />
      <rect x="26.5" y="23" width="10.5" height="10" rx="4" fill={`url(#${gradientId})`} />
      <rect x="2.5" y="2.5" width="59" height="59" rx="13.5" stroke="rgba(255,255,255,0.22)" />
    </svg>
  );
}