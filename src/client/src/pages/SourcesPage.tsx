import { useEffect, useMemo, useState } from 'react';
import { api, type TrustedSourceRecord } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { EmptyState, PageLoader } from '../components/Shared';
import type { SourceApp, SourceManifest, UserSource } from '../../../shared/types';

export default function SourcesPage() {
  const [sources, setSources] = useState<UserSource[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [addingUrl, setAddingUrl] = useState('');
  const [selfHostedText, setSelfHostedText] = useState('');
  const [selfHostedDirty, setSelfHostedDirty] = useState(false);
  const [selfHostedForm, setSelfHostedForm] = useState<SelfHostedFormState>(emptySelfHostedFormState());
  const [selfHostedAppDraft, setSelfHostedAppDraft] = useState<SelfHostedAppDraft>(emptySelfHostedAppDraft());
  const [combinedApps, setCombinedApps] = useState<SourceApp[]>([]);
  const [appSearch, setAppSearch] = useState('');
  const [trustedSources, setTrustedSources] = useState<TrustedSourceRecord[]>([]);

  const { toast } = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    document.title = 'Sources - Sidelink';
  }, []);

  const reload = async () => {
    setLoading(true);
    try {
      const [sourceRes, selfHostedRes] = await Promise.all([
        api.listSources(),
        api.getSelfHostedSource(),
      ]);
      const [combinedRes, trustedSourceRes] = await Promise.all([
        api.getCombinedSources(),
        api.listTrustedSources().catch(() => ({ data: [] as TrustedSourceRecord[] })),
      ]);
      const loadedManifest = selfHostedRes.data ?? emptySelfHostedManifest();
      setSources(sourceRes.data ?? []);
      setTrustedSources(trustedSourceRes.data ?? []);
      setSelfHostedText(JSON.stringify(loadedManifest, null, 2));
      setSelfHostedForm(manifestToFormState(loadedManifest));
      setSelfHostedDirty(false);
      setCombinedApps(combinedRes.data?.apps ?? []);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to load sources'));
    } finally {
      setLoading(false);
    }
  };

  usePageRefresh(reload);

  const enabledSources = useMemo(() => sources.filter((s) => s.enabled), [sources]);
  const totalApps = useMemo(() => enabledSources.reduce((sum, s) => sum + (s.appCount ?? 0), 0), [enabledSources]);
  const filteredApps = useMemo(() => {
    const q = appSearch.trim().toLowerCase();
    if (!q) return combinedApps;
    return combinedApps.filter((app) =>
      app.name.toLowerCase().includes(q)
      || app.bundleIdentifier.toLowerCase().includes(q)
      || (app.developerName ?? '').toLowerCase().includes(q),
    );
  }, [combinedApps, appSearch]);

  const onAdd = async () => {
    const trimmed = addingUrl.trim();
    if (!trimmed) {
      toast('warning', 'Enter a source URL first');
      return;
    }

    setBusy('add');
    try {
      await api.addSource(trimmed);
      setAddingUrl('');
      toast('success', 'Source added');
      await reload();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to add source'));
    } finally {
      setBusy(null);
    }
  };

  const onAddTrustedSource = async (trustedSource: TrustedSourceRecord) => {
    setBusy(`trusted:${trustedSource.id}`);
    try {
      await api.addSource(trustedSource.url);
      toast('success', `${trustedSource.name} added`);
      await reload();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to add trusted source'));
    } finally {
      setBusy(null);
    }
  };

  const onRefresh = async (source: UserSource) => {
    setBusy(`refresh:${source.id}`);
    try {
      await api.refreshSource(source.id);
      toast('success', `Refreshed ${source.name}`);
      await reload();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to refresh source'));
    } finally {
      setBusy(null);
    }
  };

  const onRemove = async (source: UserSource) => {
    if (source.isBuiltIn) {
      toast('warning', 'Built-in source cannot be removed');
      return;
    }

    const ok = await confirm({
      title: 'Remove Source',
      message: `Remove source "${source.name}"?`,
      confirmLabel: 'Remove',
      danger: true,
    });
    if (!ok) return;

    setBusy(`remove:${source.id}`);
    try {
      await api.deleteSource(source.id);
      toast('success', 'Source removed');
      await reload();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to remove source'));
    } finally {
      setBusy(null);
    }
  };

  const onSaveSelfHosted = async () => {
    let parsed: SourceManifest;
    try {
      parsed = JSON.parse(selfHostedText) as SourceManifest;
    } catch {
      toast('error', 'Self-hosted manifest must be valid JSON');
      return;
    }

    setBusy('self-hosted');
    try {
      await api.updateSelfHostedSource(parsed);
      setSelfHostedDirty(false);
      toast('success', 'Self-hosted source updated');
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to save self-hosted source'));
    } finally {
      setBusy(null);
    }
  };

  const applyFormToManifest = () => {
    const current = parseManifestText(selfHostedText);
    const next = {
      ...(current ?? emptySelfHostedManifest()),
      ...formStateToManifestPatch(selfHostedForm),
    };
    setSelfHostedText(JSON.stringify(next, null, 2));
    setSelfHostedDirty(true);
    toast('info', 'Form fields applied to manifest JSON');
  };

  const loadFormFromManifest = () => {
    const current = parseManifestText(selfHostedText);
    if (!current) {
      toast('error', 'Cannot load form: manifest JSON is invalid');
      return;
    }
    setSelfHostedForm(manifestToFormState(current));
    toast('success', 'Form synchronized from current JSON');
  };

  const exportSelfHostedManifest = () => {
    const parsed = parseManifestText(selfHostedText);
    if (!parsed) {
      toast('error', 'Manifest must be valid JSON before export');
      return;
    }

    const blob = new Blob([JSON.stringify(parsed, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'self-hosted-source.json';
    anchor.click();
    URL.revokeObjectURL(url);
    toast('success', 'Exported self-hosted manifest');
  };

  const addDraftAppToManifest = () => {
    if (!selfHostedAppDraft.name.trim() || !selfHostedAppDraft.bundleIdentifier.trim() || !selfHostedAppDraft.downloadURL.trim()) {
      toast('warning', 'App name, bundle ID, and download URL are required');
      return;
    }

    const current = parseManifestText(selfHostedText) ?? emptySelfHostedManifest();
    const app = {
      name: selfHostedAppDraft.name.trim(),
      bundleIdentifier: selfHostedAppDraft.bundleIdentifier.trim(),
      developerName: selfHostedAppDraft.developerName.trim() || undefined,
      localizedDescription: selfHostedAppDraft.localizedDescription.trim() || undefined,
      iconURL: selfHostedAppDraft.iconURL.trim() || undefined,
      version: selfHostedAppDraft.version.trim() || undefined,
      downloadURL: selfHostedAppDraft.downloadURL.trim(),
      versions: [{
        version: selfHostedAppDraft.version.trim() || '1.0.0',
        downloadURL: selfHostedAppDraft.downloadURL.trim(),
      }],
    };

    const exists = current.apps.some((candidate) => candidate.bundleIdentifier === app.bundleIdentifier);
    const nextApps = exists
      ? current.apps.map((candidate) => (candidate.bundleIdentifier === app.bundleIdentifier ? app : candidate))
      : [...current.apps, app];

    setSelfHostedText(JSON.stringify({ ...current, apps: nextApps }, null, 2));
    setSelfHostedDirty(true);
    setSelfHostedAppDraft(emptySelfHostedAppDraft());
    toast('success', exists ? 'App updated in manifest' : 'App added to manifest');
  };

  const onImportSourceApp = async (app: SourceApp) => {
    const downloadUrl = getDownloadUrl(app);
    if (!downloadUrl) {
      toast('warning', 'This source app does not include a download URL');
      return;
    }

    setBusy(`import:${app.bundleIdentifier}`);
    try {
      const imported = await api.importIpaFromUrl(downloadUrl);
      toast('success', `Imported ${imported.data?.bundleName ?? app.name}`);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to import source app'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-[var(--sl-text)]">Sources</h2>
          <p className="mt-0.5 text-[13px] text-[var(--sl-muted)]">Manage AltStore-compatible feeds and your self-hosted source.</p>
        </div>
        <div className="rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface)] px-3 py-2 text-xs text-[var(--sl-muted)]">
          <span className="mr-3">Enabled: {enabledSources.length}</span>
          <span>Visible apps: {totalApps}</span>
        </div>
      </div>

      <section className="sl-card p-4">
        <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">Add Source</h3>
        <p className="mt-1 text-[12px] text-[var(--sl-muted)]">Paste any HTTP/HTTPS source manifest URL.</p>
        <div className="mt-3 flex flex-col gap-2 md:flex-row">
          <input
            aria-label="Source URL"
            value={addingUrl}
            onChange={(e) => setAddingUrl(e.target.value)}
            placeholder="https://example.com/source.json"
            className="sl-input"
          />
          <button
            onClick={onAdd}
            disabled={busy === 'add'}
            className="sl-btn-primary whitespace-nowrap"
          >
            {busy === 'add' ? 'Adding...' : 'Add Source'}
          </button>
        </div>
      </section>

      <section className="sl-card p-4">
        <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">Trusted Sources</h3>
        <p className="mt-1 text-[12px] text-[var(--sl-muted)]">One-click import for curated AltStore-compatible feeds.</p>

        <div className="mt-3 space-y-2">
          {trustedSources.length === 0 ? (
            <p className="text-[12px] text-[var(--sl-muted)]">No trusted sources published yet.</p>
          ) : trustedSources.map((source) => {
            const alreadyAdded = sources.some((candidate) => candidate.url === source.url);
            return (
              <div key={source.id} className="sl-card-soft flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-[var(--sl-text)]">{source.name}</p>
                  {source.description && (
                    <p className="mt-0.5 text-[11px] text-[var(--sl-muted)]">{source.description}</p>
                  )}
                  <p className="mt-1 truncate text-[11px] text-[var(--sl-muted)]">{source.url}</p>
                </div>
                <button
                  onClick={() => void onAddTrustedSource(source)}
                  disabled={alreadyAdded || busy === `trusted:${source.id}`}
                  className="sl-btn-primary !px-3 !py-1.5 !text-[12px] disabled:opacity-40"
                >
                  {alreadyAdded ? 'Added' : busy === `trusted:${source.id}` ? 'Adding...' : 'Add Source'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      <section className="sl-card p-4">
        <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">Browse Source Apps</h3>
        <p className="mt-1 text-[12px] text-[var(--sl-muted)]">Combined apps from all enabled sources. Import adds the IPA to your local library.</p>
        <div className="mt-3">
          <input
            aria-label="Search source apps"
            value={appSearch}
            onChange={(e) => setAppSearch(e.target.value)}
            placeholder="Search by app name, bundle ID, or developer"
            className="sl-input"
          />
        </div>

        <div className="mt-3">
          {loading ? (
            <PageLoader message="Loading source apps..." />
          ) : filteredApps.length === 0 ? (
            <EmptyState title="No source apps" description="Try adding/enabling more sources or adjust your search." />
          ) : (
            <div className="space-y-2">
              {filteredApps.slice(0, 120).map((app) => {
                const downloadUrl = getDownloadUrl(app);
                const version = app.versions?.[0]?.version ?? app.version ?? 'Unknown';
                return (
                  <div key={app.bundleIdentifier} className="sl-card-soft flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-[var(--sl-text)]">{app.name}</p>
                      <p className="truncate text-[11px] text-[var(--sl-muted)]">{app.bundleIdentifier}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--sl-muted)]">
                        {(app.developerName ?? 'Unknown developer')} • v{version}
                      </p>
                    </div>
                    <button
                      onClick={() => void onImportSourceApp(app)}
                      disabled={!downloadUrl || busy === `import:${app.bundleIdentifier}`}
                      className="sl-btn-primary !px-3 !py-1.5 !text-[12px] disabled:opacity-40"
                    >
                      {busy === `import:${app.bundleIdentifier}` ? 'Importing...' : 'Import IPA'}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>

      <section className="sl-card p-4">
        <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">Configured Sources</h3>
        <p className="mt-1 text-[12px] text-[var(--sl-muted)]">Built-in and custom feeds currently tracked by Sidelink.</p>

        <div className="mt-3">
          {loading ? (
            <PageLoader message="Loading sources..." />
          ) : sources.length === 0 ? (
            <EmptyState title="No sources configured" description="Add your first source URL above." />
          ) : (
            <div className="space-y-2">
              {sources.map((source) => (
                <div key={source.id} className="sl-card-soft flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--sl-text)]">{source.name}</p>
                      {source.isBuiltIn && <span className="rounded-md border border-[var(--sl-border)] px-1.5 py-0.5 text-[10px] text-[var(--sl-muted)]">Built-in</span>}
                    </div>
                    <p className="truncate text-[11px] text-[var(--sl-muted)]">{source.url}</p>
                    <p className="mt-0.5 text-[11px] text-[var(--sl-muted)]">{source.appCount} app{source.appCount === 1 ? '' : 's'} • {source.enabled ? 'Enabled' : 'Disabled'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => void onRefresh(source)}
                      disabled={busy === `refresh:${source.id}`}
                      className="sl-btn-ghost !px-3 !py-1.5 !text-[12px]"
                    >
                      {busy === `refresh:${source.id}` ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                      onClick={() => void onRemove(source)}
                      disabled={source.isBuiltIn || busy === `remove:${source.id}`}
                      className="sl-btn-danger !px-3 !py-1.5 !text-[12px] disabled:opacity-40"
                    >
                      {busy === `remove:${source.id}` ? 'Removing...' : 'Remove'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      <section className="sl-card p-4">
        <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">Self-Hosted Source Editor</h3>
        <p className="mt-1 text-[12px] text-[var(--sl-muted)]">Edit the manifest served by <code>/api/sources/self-hosted</code>.</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          <input
            value={selfHostedForm.name}
            onChange={(e) => setSelfHostedForm((prev) => ({ ...prev, name: e.target.value }))}
            aria-label="Source name"
            placeholder="Source name"
            className="sl-input"
          />
          <input
            value={selfHostedForm.identifier}
            onChange={(e) => setSelfHostedForm((prev) => ({ ...prev, identifier: e.target.value }))}
            aria-label="Source identifier"
            placeholder="Identifier (e.g. com.example.repo)"
            className="sl-input"
          />
          <input
            value={selfHostedForm.subtitle}
            onChange={(e) => setSelfHostedForm((prev) => ({ ...prev, subtitle: e.target.value }))}
            aria-label="Source subtitle"
            placeholder="Subtitle"
            className="sl-input"
          />
          <input
            value={selfHostedForm.website}
            onChange={(e) => setSelfHostedForm((prev) => ({ ...prev, website: e.target.value }))}
            aria-label="Source website URL"
            placeholder="Website URL"
            className="sl-input"
          />
          <input
            value={selfHostedForm.iconURL}
            onChange={(e) => setSelfHostedForm((prev) => ({ ...prev, iconURL: e.target.value }))}
            aria-label="Source icon URL"
            placeholder="Icon URL"
            className="sl-input"
          />
          <input
            value={selfHostedForm.headerURL}
            onChange={(e) => setSelfHostedForm((prev) => ({ ...prev, headerURL: e.target.value }))}
            aria-label="Source header URL"
            placeholder="Header URL"
            className="sl-input"
          />
          <input
            value={selfHostedForm.tintColor}
            onChange={(e) => setSelfHostedForm((prev) => ({ ...prev, tintColor: e.target.value }))}
            aria-label="Source tint color"
            placeholder="Tint color (#RRGGBB)"
            className="sl-input"
          />
          <input
            value={selfHostedForm.sourceURL}
            onChange={(e) => setSelfHostedForm((prev) => ({ ...prev, sourceURL: e.target.value }))}
            aria-label="Source URL"
            placeholder="Source URL"
            className="sl-input"
          />
        </div>
        <textarea
          value={selfHostedForm.description}
          onChange={(e) => setSelfHostedForm((prev) => ({ ...prev, description: e.target.value }))}
          aria-label="Source description"
          placeholder="Source description"
          className="sl-input mt-2 min-h-[90px]"
        />
        <div className="mt-2 flex flex-wrap gap-2">
          <button onClick={applyFormToManifest} className="sl-btn-ghost !text-[12px]">Apply Form to JSON</button>
          <button onClick={loadFormFromManifest} className="sl-btn-ghost !text-[12px]">Load Form from JSON</button>
          <button onClick={exportSelfHostedManifest} className="sl-btn-ghost !text-[12px]">Export JSON</button>
        </div>

        <div className="mt-4 rounded-xl border border-[var(--sl-border)] bg-[var(--sl-surface-soft)] p-3">
          <p className="text-[12px] font-semibold text-[var(--sl-text)]">Add App Entry</p>
          <p className="mt-0.5 text-[11px] text-[var(--sl-muted)]">Quickly append or replace an app by bundle ID.</p>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input value={selfHostedAppDraft.name} onChange={(e) => setSelfHostedAppDraft((prev) => ({ ...prev, name: e.target.value }))} placeholder="App name" aria-label="App name" className="sl-input" />
            <input value={selfHostedAppDraft.bundleIdentifier} onChange={(e) => setSelfHostedAppDraft((prev) => ({ ...prev, bundleIdentifier: e.target.value }))} placeholder="Bundle ID" aria-label="Bundle ID" className="sl-input" />
            <input value={selfHostedAppDraft.developerName} onChange={(e) => setSelfHostedAppDraft((prev) => ({ ...prev, developerName: e.target.value }))} placeholder="Developer" aria-label="Developer name" className="sl-input" />
            <input value={selfHostedAppDraft.version} onChange={(e) => setSelfHostedAppDraft((prev) => ({ ...prev, version: e.target.value }))} placeholder="Version" aria-label="App version" className="sl-input" />
            <input value={selfHostedAppDraft.downloadURL} onChange={(e) => setSelfHostedAppDraft((prev) => ({ ...prev, downloadURL: e.target.value }))} placeholder="Download URL" aria-label="Download URL" className="sl-input sm:col-span-2" />
            <input value={selfHostedAppDraft.iconURL} onChange={(e) => setSelfHostedAppDraft((prev) => ({ ...prev, iconURL: e.target.value }))} placeholder="Icon URL" aria-label="Icon URL" className="sl-input sm:col-span-2" />
          </div>
          <textarea
            value={selfHostedAppDraft.localizedDescription}
            onChange={(e) => setSelfHostedAppDraft((prev) => ({ ...prev, localizedDescription: e.target.value }))}
            placeholder="App description"
            aria-label="App description"
            className="sl-input mt-2 min-h-[72px]"
          />
          <button onClick={addDraftAppToManifest} className="sl-btn-primary mt-2 !text-[12px]">Add/Update App</button>
        </div>

        <textarea
          value={selfHostedText}
          onChange={(e) => {
            setSelfHostedText(e.target.value);
            setSelfHostedDirty(true);
          }}
          spellCheck={false}
          aria-label="Source manifest JSON"
          className="sl-input mt-3 min-h-[260px] font-mono text-[11px]"
        />
        <div className="mt-3 flex items-center gap-2">
          <button
            onClick={() => void onSaveSelfHosted()}
            disabled={!selfHostedDirty || busy === 'self-hosted'}
            className="sl-btn-primary"
          >
            {busy === 'self-hosted' ? 'Saving...' : 'Save Self-Hosted Manifest'}
          </button>
          <button onClick={() => void reload()} className="sl-btn-ghost">Reload</button>
        </div>
      </section>
    </div>
  );
}

function getDownloadUrl(app: SourceApp): string | null {
  const versionUrl = app.versions?.[0]?.downloadURL;
  if (versionUrl && versionUrl.length > 0) return versionUrl;
  if (app.downloadURL && app.downloadURL.length > 0) return app.downloadURL;
  return null;
}

function emptySelfHostedManifest(): SourceManifest {
  return {
    name: 'Sidelink Self Hosted',
    identifier: 'com.sidelink.self-hosted',
    sourceURL: '/api/sources/self-hosted',
    apps: [],
  };
}

interface SelfHostedFormState {
  name: string;
  identifier: string;
  subtitle: string;
  description: string;
  website: string;
  iconURL: string;
  headerURL: string;
  tintColor: string;
  sourceURL: string;
}

interface SelfHostedAppDraft {
  name: string;
  bundleIdentifier: string;
  developerName: string;
  version: string;
  downloadURL: string;
  iconURL: string;
  localizedDescription: string;
}

function emptySelfHostedFormState(): SelfHostedFormState {
  return {
    name: 'Sidelink Self Hosted',
    identifier: 'com.sidelink.self-hosted',
    subtitle: '',
    description: '',
    website: '',
    iconURL: '',
    headerURL: '',
    tintColor: '',
    sourceURL: '/api/sources/self-hosted',
  };
}

function emptySelfHostedAppDraft(): SelfHostedAppDraft {
  return {
    name: '',
    bundleIdentifier: '',
    developerName: '',
    version: '1.0.0',
    downloadURL: '',
    iconURL: '',
    localizedDescription: '',
  };
}

function parseManifestText(raw: string): SourceManifest | null {
  try {
    return JSON.parse(raw) as SourceManifest;
  } catch {
    return null;
  }
}

function manifestToFormState(manifest: SourceManifest): SelfHostedFormState {
  return {
    name: manifest.name ?? '',
    identifier: manifest.identifier ?? '',
    subtitle: manifest.subtitle ?? '',
    description: manifest.description ?? '',
    website: manifest.website ?? '',
    iconURL: manifest.iconURL ?? '',
    headerURL: manifest.headerURL ?? '',
    tintColor: manifest.tintColor ?? '',
    sourceURL: manifest.sourceURL ?? '/api/sources/self-hosted',
  };
}

function formStateToManifestPatch(form: SelfHostedFormState): Omit<SourceManifest, 'apps'> {
  return {
    name: form.name.trim() || 'Sidelink Self Hosted',
    identifier: form.identifier.trim() || undefined,
    subtitle: form.subtitle.trim() || undefined,
    description: form.description.trim() || undefined,
    website: form.website.trim() || undefined,
    iconURL: form.iconURL.trim() || undefined,
    headerURL: form.headerURL.trim() || undefined,
    tintColor: form.tintColor.trim() || undefined,
    sourceURL: form.sourceURL.trim() || '/api/sources/self-hosted',
  };
}
