import os from 'node:os';
import type { NetworkInterfaceInfo } from 'node:os';
import type { Request } from 'express';

const LOOPBACK_HOSTS = new Set(['localhost', '::1', '[::1]', '0.0.0.0', '::', '[::]']);

export interface ResolvedBackendContext {
  protocol: string;
  host: string;
  port: number;
  origin: string;
  apiBasePath: string;
  backendUrl: string;
  candidateAddresses: string[];
}

type NetworkAddress = {
  address: string;
  family: 'IPv4' | 'IPv6';
  isPrivate: boolean;
  isLinkLocal: boolean;
};

export function resolveHelperBackendContext(req: Request, terminalPath: string): ResolvedBackendContext {
  const protocol = getRequestProtocol(req);
  const forwardedHost = (req.headers['x-forwarded-host'] as string | undefined)?.split(',')[0]?.trim();
  const hostHeader = forwardedHost || req.get('host') || req.hostname || '';
  const [rawHost, rawPort] = splitHostPort(hostHeader);

  const candidateAddresses = getReachableAddresses();
  const host = shouldReplaceHost(rawHost)
    ? (candidateAddresses[0] || rawHost || 'localhost')
    : rawHost;

  const port = rawPort ?? req.socket.localPort ?? 4010;
  const origin = buildOrigin(protocol, host, port);
  const apiBasePath = deriveApiBasePath(req.originalUrl, terminalPath);

  return {
    protocol,
    host,
    port,
    origin,
    apiBasePath,
    backendUrl: `${origin}${apiBasePath}`,
    candidateAddresses,
  };
}

export function splitHostPort(hostHeader: string): [string, number | null] {
  const trimmed = hostHeader.trim();
  if (!trimmed) {
    return ['', null];
  }

  if (trimmed.startsWith('[')) {
    const closing = trimmed.indexOf(']');
    if (closing >= 0) {
      const host = trimmed.slice(1, closing);
      const port = Number.parseInt(trimmed.slice(closing + 1).replace(/^:/, ''), 10);
      return [host, Number.isFinite(port) ? port : null];
    }
  }

  const parts = trimmed.split(':');
  const last = parts[parts.length - 1] ?? '';
  if (parts.length > 1 && /^\d+$/.test(last)) {
    const port = Number.parseInt(last, 10);
    return [parts.slice(0, -1).join(':'), Number.isFinite(port) ? port : null];
  }

  return [trimmed, null];
}

export function formatHostForUrl(host: string): string {
  if (!host) return 'localhost';
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export function buildOrigin(protocol: string, host: string, port: number): string {
  const normalizedProtocol = protocol === 'https' ? 'https' : 'http';
  const formattedHost = formatHostForUrl(host);
  const includePort = !((normalizedProtocol === 'http' && port === 80) || (normalizedProtocol === 'https' && port === 443));
  return `${normalizedProtocol}://${formattedHost}${includePort ? `:${port}` : ''}`;
}

export function isLocalNetworkHost(host: string): boolean {
  const normalized = host.trim().toLowerCase().replace(/^\[(.*)\]$/, '$1');
  if (!normalized) return false;
  if (normalized.endsWith('.local')) return true;
  if (LOOPBACK_HOSTS.has(normalized) || normalized.startsWith('127.')) return true;
  if (normalized === '::ffff:127.0.0.1') return true;
  if (normalized.includes(':')) return isPrivateIPv6(normalized);
  return isPrivateIPv4(normalized);
}

export function deriveApiBasePath(originalUrl: string, terminalPath: string): string {
  const cleanOriginal = originalUrl.split('?')[0] ?? '';
  const cleanTerminal = terminalPath.startsWith('/') ? terminalPath : `/${terminalPath}`;
  const idx = cleanOriginal.lastIndexOf(cleanTerminal);
  const rawBase = idx >= 0 ? cleanOriginal.slice(0, idx) : '';
  if (!rawBase || rawBase === '/') {
    return '';
  }
  const normalized = rawBase.endsWith('/') ? rawBase.slice(0, -1) : rawBase;
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

function getRequestProtocol(req: Request): string {
  const forwardedProto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim().toLowerCase();
  if (forwardedProto === 'https' || forwardedProto === 'http') {
    return forwardedProto;
  }
  return req.protocol === 'https' ? 'https' : 'http';
}

function shouldReplaceHost(host: string): boolean {
  const lower = host.trim().toLowerCase();
  if (!lower) return true;
  if (LOOPBACK_HOSTS.has(lower)) return true;
  if (lower.startsWith('127.')) return true;
  return lower === '::ffff:127.0.0.1';
}

function getReachableAddresses(): string[] {
  const all = Object.values(os.networkInterfaces())
    .flatMap((entries) => entries ?? [])
    .filter((entry): entry is NetworkInterfaceInfo => !!entry)
    .filter((entry) => !entry.internal && (entry.family === 'IPv4' || entry.family === 'IPv6'))
    .map<NetworkAddress>((entry) => ({
      address: entry.address,
      family: entry.family,
      isPrivate: entry.family === 'IPv4' ? isPrivateIPv4(entry.address) : isPrivateIPv6(entry.address),
      isLinkLocal: entry.family === 'IPv4' ? entry.address.startsWith('169.254.') : entry.address.toLowerCase().startsWith('fe80:'),
    }));

  all.sort((left, right) => scoreAddress(right) - scoreAddress(left));
  return [...new Set(all.map((entry) => entry.address))];
}

function scoreAddress(address: NetworkAddress): number {
  let score = 0;
  if (address.family === 'IPv4') score += 4;
  if (address.isPrivate) score += 3;
  if (!address.isLinkLocal) score += 2;
  return score;
}

function isPrivateIPv4(address: string): boolean {
  const parts = address.split('.').map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part))) return false;
  const [a, b] = parts;
  if (a === 10 || a === 127) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  return a === 169 && b === 254;
}

function isPrivateIPv6(address: string): boolean {
  const lower = address.toLowerCase();
  return lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:');
}
