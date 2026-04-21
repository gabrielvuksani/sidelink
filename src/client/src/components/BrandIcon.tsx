export function BrandIcon({ className = 'h-10 w-10', title = 'SideLink logo' }: { className?: string; title?: string }) {
  return <img alt={title} className={className} role="img" src="/brandmark.svg" />;
}