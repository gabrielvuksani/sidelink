import { v4 as uuid } from 'uuid';
import dns from 'node:dns/promises';
import semver from 'semver';
import type { SourceApp, SourceManifest, UserSource, UserSourceWithManifest } from '../../shared/types';
import type { Database } from '../state/database';
import { AppError } from '../utils/errors';
import { fetchJsonWithLimit } from '../utils/fetch';
import { isLocalNetworkHost } from '../utils/network';

const OFFICIAL_SOURCE_URL = 'https://raw.githubusercontent.com/gabrielvuksani/sidelink/main/docs/source/source.json';

export class SourceService {
  constructor(private readonly db: Database) {
    this.seedBuiltInSource();
  }

  list(): UserSource[] {
    return this.db.listSources();
  }

  listWithManifest(): UserSourceWithManifest[] {
    return this.db.listSourcesWithManifest();
  }

  async add(url: string): Promise<UserSource> {
    const normalized = normalizeSourceUrl(url);
    const existing = this.db.getSourceByUrl(normalized);
    if (existing) {
      throw new AppError('SOURCE_EXISTS', 'Source already exists', 409);
    }

    const manifest = await this.fetchManifest(normalized);
    const now = new Date().toISOString();
    const id = uuid();
    this.db.upsertSource({
      id,
      name: manifest.name,
      url: normalized,
      identifier: manifest.identifier ?? null,
      iconURL: manifest.iconURL ?? null,
      enabled: true,
      isBuiltIn: false,
      cachedManifest: manifest,
      lastFetchedAt: now,
      createdAt: now,
    });

    const source = this.db.getSource(id);
    if (!source) {
      throw new AppError('SOURCE_CREATE_FAILED', 'Failed to create source', 500);
    }
    return source;
  }

  async refresh(id: string): Promise<UserSourceWithManifest> {
    const source = this.db.getSource(id);
    if (!source) {
      throw new AppError('SOURCE_NOT_FOUND', 'Source not found', 404);
    }

    const manifest = await this.fetchManifest(source.url);
    const now = new Date().toISOString();
    this.db.upsertSource({
      id: source.id,
      name: manifest.name,
      url: source.url,
      identifier: manifest.identifier ?? null,
      iconURL: manifest.iconURL ?? null,
      enabled: source.enabled,
      isBuiltIn: source.isBuiltIn,
      cachedManifest: manifest,
      lastFetchedAt: now,
      createdAt: source.createdAt,
    });

    const updated = this.db.getSource(id);
    if (!updated) {
      throw new AppError('SOURCE_REFRESH_FAILED', 'Failed to refresh source', 500);
    }
    return updated;
  }

  remove(id: string): void {
    const source = this.db.getSource(id);
    if (!source) {
      throw new AppError('SOURCE_NOT_FOUND', 'Source not found', 404);
    }
    if (source.isBuiltIn) {
      throw new AppError('SOURCE_BUILTIN', 'Built-in sources cannot be removed', 400);
    }
    this.db.deleteSource(id);
  }

  appsForSource(id: string): SourceApp[] {
    const source = this.db.getSource(id);
    if (!source) {
      throw new AppError('SOURCE_NOT_FOUND', 'Source not found', 404);
    }
    return source.cachedManifest?.apps ?? [];
  }

  combined(): SourceManifest {
    const sources = this.db.listSourcesWithManifest().filter((source) => source.enabled);
    const appsByBundle = new Map<string, SourceApp>();

    for (const source of sources) {
      const apps = source.cachedManifest?.apps ?? [];
      for (const app of apps) {
        const existing = appsByBundle.get(app.bundleIdentifier);
        if (!existing) {
          appsByBundle.set(app.bundleIdentifier, app);
          continue;
        }
        // Prefer the entry with the highest semver so first-wins doesn't mask a
        // newer version published in a later-ordered source. Coerce tolerantly
        // so manifests like "1.4.2-beta" or "2025.04" still compare.
        if (compareAppVersions(app, existing) > 0) {
          appsByBundle.set(app.bundleIdentifier, app);
        }
      }
    }

    return {
      name: 'SideLink Combined Sources',
      identifier: 'com.sidelink.sources.combined',
      sourceURL: '/api/sources/combined',
      apps: Array.from(appsByBundle.values()),
    };
  }

  getManifest(id: string): SourceManifest {
    const source = this.db.getSource(id);
    if (!source) {
      throw new AppError('SOURCE_NOT_FOUND', 'Source not found', 404);
    }
    if (!source.cachedManifest) {
      throw new AppError('SOURCE_MANIFEST_MISSING', 'Source manifest not available', 404);
    }
    return source.cachedManifest;
  }

  getSelfHostedManifest(): SourceManifest | null {
    const raw = this.db.getSetting('self_hosted_source_manifest');
    if (!raw) return null;
    try {
      return validateManifestShape(JSON.parse(raw));
    } catch {
      return null;
    }
  }

  setSelfHostedManifest(manifest: SourceManifest): void {
    this.db.setSetting('self_hosted_source_manifest', JSON.stringify(manifest));
  }

  private seedBuiltInSource(): void {
    const existing = this.db.getSourceByUrl(OFFICIAL_SOURCE_URL);
    if (existing) return;

    const now = new Date().toISOString();
    const fallback: SourceManifest = {
      name: 'SideLink Official',
      identifier: 'com.sidelink.official',
      sourceURL: OFFICIAL_SOURCE_URL,
      apps: [],
    };

    this.db.upsertSource({
      id: uuid(),
      name: fallback.name,
      url: OFFICIAL_SOURCE_URL,
      identifier: fallback.identifier ?? null,
      iconURL: fallback.iconURL ?? null,
      enabled: true,
      isBuiltIn: true,
      cachedManifest: fallback,
      lastFetchedAt: null,
      createdAt: now,
    });
  }

  private async fetchManifest(url: string): Promise<SourceManifest> {
    // Resolve the hostname once and verify the resulting IPs are not private
    // for https sources. normalizeSourceUrl already rejects http → public, but
    // an attacker-controlled https hostname could still resolve to a private
    // IP (DNS rebinding / inside-the-LAN redirect). Reject before fetching.
    const parsed = new URL(url);
    if (parsed.protocol === 'https:') {
      await assertHostResolvesToPublicAddress(parsed.hostname);
    }

    const payload = await fetchJsonWithLimit<unknown>(url, {
      contextLabel: 'Source manifest',
      timeoutMs: 20_000,
      maxBytes: 2 * 1024 * 1024,
      errorStatusCode: 400,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'SideLink/desktop-source-fetch',
      },
    });
    return validateManifestShape(payload);
  }
}

function topVersionOf(app: SourceApp): string | null {
  if (app.version) return app.version;
  const first = app.versions?.[0]?.version;
  return first ?? null;
}

function compareAppVersions(a: SourceApp, b: SourceApp): number {
  const av = topVersionOf(a);
  const bv = topVersionOf(b);
  if (!av && !bv) return 0;
  if (!av) return -1;
  if (!bv) return 1;

  const coercedA = semver.coerce(av);
  const coercedB = semver.coerce(bv);
  if (coercedA && coercedB) {
    return semver.compare(coercedA, coercedB);
  }
  return av.localeCompare(bv);
}

async function assertHostResolvesToPublicAddress(hostname: string): Promise<void> {
  // Literal IPs are caught by the loopback/private check directly.
  if (isLocalNetworkHost(hostname)) {
    throw new AppError('SOURCE_PRIVATE_HOST', 'Source manifest host resolves to a private address', 400);
  }

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(hostname, { all: true });
  } catch {
    // DNS failure surfaces later as a REMOTE_REQUEST_FAILED; don't double-fail.
    return;
  }

  for (const record of records) {
    if (isLocalNetworkHost(record.address)) {
      throw new AppError('SOURCE_PRIVATE_HOST', 'Source manifest host resolves to a private address', 400);
    }
  }
}

function normalizeSourceUrl(url: string): string {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new AppError('SOURCE_INVALID_URL', 'Invalid source URL', 400);
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new AppError('SOURCE_INVALID_PROTOCOL', 'Only http/https source URLs are supported', 400);
  }

  if (parsed.protocol === 'http:' && !isLocalNetworkHost(parsed.hostname)) {
    throw new AppError('SOURCE_HTTP_NONLOCAL', 'HTTP sources are only allowed for local-network hosts', 400);
  }

  return parsed.toString();
}

function validateManifestShape(payload: unknown): SourceManifest {
  if (!payload || typeof payload !== 'object') {
    throw new AppError('SOURCE_INVALID_MANIFEST', 'Source manifest must be an object', 400);
  }

  const asManifest = payload as Record<string, unknown>;
  const name = asManifest.name;
  const apps = asManifest.apps;

  if (typeof name !== 'string' || name.trim().length === 0) {
    throw new AppError('SOURCE_INVALID_MANIFEST', 'Source manifest is missing a valid name', 400);
  }

  if (!Array.isArray(apps)) {
    throw new AppError('SOURCE_INVALID_MANIFEST', 'Source manifest must include an apps array', 400);
  }

  for (const app of apps) {
    if (!app || typeof app !== 'object') {
      throw new AppError('SOURCE_INVALID_APP', 'Source app entries must be objects', 400);
    }
    const item = app as Record<string, unknown>;
    if (typeof item.name !== 'string' || item.name.trim().length === 0) {
      throw new AppError('SOURCE_INVALID_APP', 'Source apps must include a name', 400);
    }
    if (typeof item.bundleIdentifier !== 'string' || item.bundleIdentifier.trim().length === 0) {
      throw new AppError('SOURCE_INVALID_APP', 'Source apps must include bundleIdentifier', 400);
    }

    const hasVersions = Array.isArray(item.versions) && item.versions.length > 0;
    const hasLegacyDownload = typeof item.downloadURL === 'string' && item.downloadURL.length > 0;
    if (!hasVersions && !hasLegacyDownload) {
      throw new AppError('SOURCE_INVALID_APP', 'Source apps must include versions[] or downloadURL', 400);
    }
  }

  return asManifest as unknown as SourceManifest;
}
