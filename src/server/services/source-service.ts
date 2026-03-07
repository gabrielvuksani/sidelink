import { v4 as uuid } from 'uuid';
import type { SourceApp, SourceManifest, UserSource, UserSourceWithManifest } from '../../shared/types';
import type { Database } from '../state/database';
import { AppError } from '../utils/errors';

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
        if (!appsByBundle.has(app.bundleIdentifier)) {
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
    let response: Response;
    try {
      response = await fetch(url);
    } catch {
      throw new AppError('SOURCE_UNREACHABLE', 'Unable to reach source URL', 400);
    }

    if (!response.ok) {
      throw new AppError('SOURCE_HTTP_ERROR', `Source responded with HTTP ${response.status}`, 400);
    }

    let payload: unknown;
    try {
      payload = await response.json();
    } catch {
      throw new AppError('SOURCE_INVALID_JSON', 'Source did not return valid JSON', 400);
    }

    return validateManifestShape(payload);
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
