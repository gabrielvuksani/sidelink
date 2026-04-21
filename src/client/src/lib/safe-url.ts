/**
 * Utilities for handling URLs delivered by third-party source manifests.
 *
 * Source manifests can be published by anyone — the app consumer must not
 * render images that resolve to attacker-controlled schemes. `javascript:` is
 * the obvious risk, but `data:` URLs can also exfiltrate information in
 * subtle ways and `http:` leaks the image-fetch referrer over plaintext.
 * Only https is accepted; everything else returns null and the caller
 * should render a placeholder instead.
 */
export function safeHttpsUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = String(raw).trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return null;
    if (!parsed.host) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/** Props to spread onto an `<img>` rendering an attacker-controlled URL. */
export const untrustedImgProps = {
  referrerPolicy: 'no-referrer' as const,
  crossOrigin: 'anonymous' as const,
  loading: 'lazy' as const,
  decoding: 'async' as const,
};
