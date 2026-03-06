import { beforeEach, describe, expect, it, vi } from 'vitest';

type SourceRecord = {
  id: string;
  name: string;
  url: string;
  identifier: string | null;
  iconURL: string | null;
  enabled: boolean;
  isBuiltIn: boolean;
  cachedManifest: any;
  lastFetchedAt: string | null;
  createdAt: string;
};

function makeDb() {
  const sources: SourceRecord[] = [];

  return {
    listSources: vi.fn(() => sources),
    listSourcesWithManifest: vi.fn(() => sources),
    getSourceByUrl: vi.fn((url: string) => sources.find((s) => s.url === url) ?? null),
    getSource: vi.fn((id: string) => sources.find((s) => s.id === id) ?? null),
    upsertSource: vi.fn((source: SourceRecord) => {
      const idx = sources.findIndex((s) => s.id === source.id);
      if (idx >= 0) {
        sources[idx] = source;
      } else {
        sources.push(source);
      }
    }),
    deleteSource: vi.fn((id: string) => {
      const idx = sources.findIndex((s) => s.id === id);
      if (idx >= 0) sources.splice(idx, 1);
    }),
    getSetting: vi.fn(() => null),
    setSetting: vi.fn(),
  };
}

describe('SourceService', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('rejects duplicate source URLs', async () => {
    const db = makeDb();
    const { SourceService } = await import('../src/server/services/source-service');
    const service = new SourceService(db as any);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        name: 'Test Source',
        identifier: 'test.source',
        apps: [{ name: 'Demo', bundleIdentifier: 'com.demo.app', downloadURL: 'https://example.com/app.ipa' }],
      }),
    })));

    await service.add('https://example.com/source.json');
    await expect(service.add('https://example.com/source.json')).rejects.toMatchObject({
      code: 'SOURCE_EXISTS',
    });
  });

  it('validates manifest shape when adding a source', async () => {
    const db = makeDb();
    const { SourceService } = await import('../src/server/services/source-service');
    const service = new SourceService(db as any);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({ name: 'Broken Source' }),
    })));

    await expect(service.add('https://example.com/broken.json')).rejects.toMatchObject({
      code: 'SOURCE_INVALID_MANIFEST',
    });
  });
});
