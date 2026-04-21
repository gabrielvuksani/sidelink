import { useEffect, useMemo, useState } from 'react';
import { api, type TrustedSourceRecord, type CommunitySourceRecord } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { EmptyState, PageHeader, SearchInput, SectionHeading } from '../components/Shared';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import { safeHttpsUrl, untrustedImgProps } from '../lib/safe-url';
import type { SourceApp, SourceManifest, SourceScreenshot, UserSource } from '../../../shared/types';
import {
  SelfHostedEditor,
  emptySelfHostedFormState,
  emptySelfHostedManifest,
  manifestToFormState,
  type SelfHostedFormState,
} from './SelfHostedEditor';

type SourcesPageSnapshot = {
  sources: UserSource[];
  selfHostedText: string;
  selfHostedForm: SelfHostedFormState;
  combinedApps: SourceApp[];
  trustedSources: TrustedSourceRecord[];
};

export default function SourcesPage() {
  const warmSnapshot = getUiSnapshot<SourcesPageSnapshot>('page:sources');
  const [sources, setSources] = useState<UserSource[]>(warmSnapshot?.data.sources ?? []);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [addingUrl, setAddingUrl] = useState('');
  const [selfHostedText, setSelfHostedText] = useState(warmSnapshot?.data.selfHostedText ?? '');
  const [selfHostedDirty, setSelfHostedDirty] = useState(false);
  const [selfHostedForm, setSelfHostedForm] = useState<SelfHostedFormState>(warmSnapshot?.data.selfHostedForm ?? emptySelfHostedFormState());
  const [combinedApps, setCombinedApps] = useState<SourceApp[]>(warmSnapshot?.data.combinedApps ?? []);
  const [appSearch, setAppSearch] = useState('');
  const [trustedSources, setTrustedSources] = useState<TrustedSourceRecord[]>(warmSnapshot?.data.trustedSources ?? []);
  const [communitySources, setCommunitySources] = useState<CommunitySourceRecord[]>([]);

  const [expandedApp, setExpandedApp] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'browse' | 'configured' | 'self-hosted'>('browse');
  const [sourceSearch, setSourceSearch] = useState('');
  const { toast } = useToast();
  const confirm = useConfirm();

  useEffect(() => {
    document.title = 'Sources - SideLink';
  }, []);

  const syncSnapshot = (next: SourcesPageSnapshot) => {
    setSources(next.sources);
    setTrustedSources(next.trustedSources);
    setSelfHostedText(next.selfHostedText);
    setSelfHostedForm(next.selfHostedForm);
    setCombinedApps(next.combinedApps);
    setUiSnapshot('page:sources', next);
  };

  const reload = async (force = false) => {
    if (!sources.length && !selfHostedText) {
      setLoading(true);
    }
    try {
      const [sourceRes, selfHostedRes] = await Promise.all([
        api.listSources({ bypassCache: force }),
        api.getSelfHostedSource(),
      ]);
      const loadedManifest = selfHostedRes.data ?? emptySelfHostedManifest();
      syncSnapshot({
        sources: sourceRes.data ?? [],
        trustedSources,
        selfHostedText: JSON.stringify(loadedManifest, null, 2),
        selfHostedForm: manifestToFormState(loadedManifest),
        combinedApps,
      });
      setSelfHostedDirty(false);
      setLoading(false);
      setLoadingCatalog(true);

      const [combinedRes, trustedSourceRes, communitySourceRes] = await Promise.all([
        api.getCombinedSources({ bypassCache: force }),
        api.listTrustedSources({ bypassCache: force }).catch(() => ({ data: [] as TrustedSourceRecord[] })),
        api.listCommunitySources({ bypassCache: force }).catch(() => ({ data: [] as CommunitySourceRecord[] })),
      ]);

      setCommunitySources(communitySourceRes.data ?? []);

      syncSnapshot({
        sources: sourceRes.data ?? [],
        trustedSources: trustedSourceRes.data ?? [],
        selfHostedText: JSON.stringify(loadedManifest, null, 2),
        selfHostedForm: manifestToFormState(loadedManifest),
        combinedApps: combinedRes.data?.apps ?? [],
      });
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to load sources'));
    } finally {
      setLoading(false);
      setLoadingCatalog(false);
    }
  };

  usePageRefresh(reload, { initialForce: !warmSnapshot, minIntervalMs: 20_000 });

  const enabledSources = useMemo(() => sources.filter((s) => s.enabled), [sources]);
  const totalApps = useMemo(() => enabledSources.reduce((sum, s) => sum + (s.appCount ?? 0), 0), [enabledSources]);
  const filteredSources = useMemo(() => {
    const q = sourceSearch.trim().toLowerCase();
    if (!q) return sources;
    return sources.filter((s) =>
      s.name.toLowerCase().includes(q)
      || s.url.toLowerCase().includes(q),
    );
  }, [sources, sourceSearch]);
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

  const onAddCommunitySource = async (communitySource: CommunitySourceRecord) => {
    setBusy(`community:${communitySource.id}`);
    try {
      await api.addSource(communitySource.url);
      toast('success', `${communitySource.name} added`);
      await reload();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to add community source'));
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
    <div className="sl-page animate-fadeIn">
      <PageHeader
        eyebrow="Sources"
        title="App Sources"
        description="AltStore-compatible feeds, trusted sources, and self-hosted manifests."
        stats={[
          { label: 'Enabled Sources', value: enabledSources.length, tone: 'teal' },
          { label: 'Visible Apps', value: totalApps, tone: 'sky' },
          { label: 'Trusted Feeds', value: trustedSources.length, tone: 'amber' },
        ]}
      />

      {loadingCatalog && (
        <div className="sl-card px-4 py-2 text-[12px] text-[var(--sl-muted)]">Refreshing combined source catalog...</div>
      )}

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

      <div className="sl-card p-1 rounded-xl flex gap-0.5">
        {(['browse', 'configured', 'self-hosted'] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`flex-1 rounded-lg px-4 py-2.5 text-[13px] font-medium transition-all ${
              activeTab === tab
                ? 'bg-[var(--sl-accent)] text-white shadow-sm'
                : 'text-[var(--sl-muted)] hover:text-[var(--sl-text)] hover:bg-[var(--sl-surface-soft)]'
            }`}
          >
            {tab === 'browse' ? 'Browse & Discover' : tab === 'configured' ? 'Configured Sources' : 'Self-Hosted Editor'}
          </button>
        ))}
      </div>

      {activeTab === 'browse' && (
        <>
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
                <div className="flex items-center gap-3 min-w-0">
                  {safeHttpsUrl(source.iconURL) ? (
                    <img {...untrustedImgProps} src={safeHttpsUrl(source.iconURL) ?? undefined} alt="" className="w-9 h-9 rounded-xl shrink-0 bg-[var(--sl-surface-soft)]" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                  ) : (
                    <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--sl-accent)]/10 shrink-0">
                      <svg className="w-4 h-4 text-[var(--sl-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" /></svg>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-[var(--sl-text)]">{source.name}</p>
                    {source.description && (
                      <p className="mt-0.5 text-[11px] text-[var(--sl-muted)]">{source.description}</p>
                    )}
                    <p className="mt-1 truncate text-[11px] text-[var(--sl-muted)] font-mono">{source.url}</p>
                  </div>
                </div>
                <button
                  onClick={() => void onAddTrustedSource(source)}
                  disabled={alreadyAdded || busy === `trusted:${source.id}`}
                  className="sl-btn-primary sl-btn-sm disabled:opacity-40"
                  aria-label={alreadyAdded ? `${source.name} already added` : `Add ${source.name} source`}
                >
                  {alreadyAdded ? 'Added' : busy === `trusted:${source.id}` ? 'Adding...' : 'Add Source'}
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {communitySources.length > 0 && (
      <section className="sl-card p-4">
        <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">Community Sources</h3>
        <p className="mt-1 text-[12px] text-[var(--sl-muted)]">Popular community-maintained sources. Add them with one click to discover more apps.</p>

        <div className="mt-3 space-y-2">
          {communitySources.map((cs) => {
            const alreadyAdded = sources.some((candidate) => candidate.url === cs.url);
            return (
              <div key={cs.id} className="sl-card-soft flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/10 shrink-0">
                    <svg className="w-4 h-4 text-sky-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M18 18.72a9.094 9.094 0 003.741-.479 3 3 0 00-4.682-2.72m.94 3.198l.001.031c0 .225-.012.447-.037.666A11.944 11.944 0 0112 21c-2.17 0-4.207-.576-5.963-1.584A6.062 6.062 0 016 18.719m12 0a5.971 5.971 0 00-.941-3.197m0 0A5.995 5.995 0 0012 12.75a5.995 5.995 0 00-5.058 2.772m0 0a3 3 0 00-4.681 2.72 8.986 8.986 0 003.74.477m.94-3.197a5.971 5.971 0 00-.94 3.197M15 6.75a3 3 0 11-6 0 3 3 0 016 0zm6 3a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0zm-13.5 0a2.25 2.25 0 11-4.5 0 2.25 2.25 0 014.5 0z" /></svg>
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-semibold text-[var(--sl-text)]">{cs.name}</p>
                      {cs.category && (
                        <span className="rounded-md border border-[var(--sl-border)] px-1.5 py-0.5 text-[10px] text-[var(--sl-muted)]">{cs.category}</span>
                      )}
                    </div>
                    {cs.description && (
                      <p className="mt-0.5 text-[11px] text-[var(--sl-muted)]">{cs.description}</p>
                    )}
                    <p className="mt-1 truncate text-[11px] text-[var(--sl-muted)] font-mono">{cs.url}</p>
                  </div>
                </div>
                <button
                  onClick={() => void onAddCommunitySource(cs)}
                  disabled={alreadyAdded || busy === `community:${cs.id}`}
                  className="sl-btn-primary sl-btn-sm disabled:opacity-40"
                  aria-label={alreadyAdded ? `${cs.name} already added` : `Add ${cs.name} source`}
                >
                  {alreadyAdded ? 'Added' : busy === `community:${cs.id}` ? 'Adding...' : 'Add Source'}
                </button>
              </div>
            );
          })}
        </div>
      </section>
      )}

      <section className="sl-card p-4">
        <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">Browse Source Apps</h3>
        <p className="mt-1 text-[12px] text-[var(--sl-muted)]">Combined apps from all enabled sources. Import adds the IPA to your local library.</p>
        <div className="mt-3">
          <SearchInput
            value={appSearch}
            onChange={setAppSearch}
            placeholder="Search by app name, bundle ID, or developer..."
          />
        </div>

        <div className="mt-3">
          {loading && filteredApps.length === 0 ? (
            <div className="animate-fadeIn space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="sl-card-soft flex items-center justify-between p-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="sl-skeleton h-9 w-9 rounded-xl shrink-0" />
                    <div className="space-y-2">
                      <div className="sl-skeleton h-4 w-32" />
                      <div className="sl-skeleton h-3 w-48" />
                      <div className="flex gap-2">
                        <div className="sl-skeleton h-2.5 w-20" />
                        <div className="sl-skeleton h-2.5 w-14" />
                      </div>
                    </div>
                  </div>
                  <div className="sl-skeleton h-7 w-16 rounded-lg shrink-0" />
                </div>
              ))}
            </div>
          ) : filteredApps.length === 0 ? (
            <EmptyState title="No source apps" description="Try adding/enabling more sources or adjust your search." />
          ) : (
            <div className="space-y-2">
              {filteredApps.slice(0, 120).map((app) => {
                const downloadUrl = getDownloadUrl(app);
                const version = app.versions?.[0]?.version ?? app.version ?? 'Unknown';
                const isExpanded = expandedApp === app.bundleIdentifier;
                return (
                  <div key={app.bundleIdentifier}>
                    <div
                      className="sl-card-soft flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between cursor-pointer hover:bg-[var(--sl-surface-soft)]"
                      onClick={() => setExpandedApp(isExpanded ? null : app.bundleIdentifier)}
                      role="button"
                      tabIndex={0}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpandedApp(isExpanded ? null : app.bundleIdentifier); } }}
                      aria-expanded={isExpanded}
                      aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${app.name} details`}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        {safeHttpsUrl(app.iconURL) ? (
                          <img {...untrustedImgProps} src={safeHttpsUrl(app.iconURL) ?? undefined} alt="" className="w-10 h-10 rounded-xl shrink-0 bg-[var(--sl-surface-soft)]" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                        ) : (
                          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sl-surface-soft)] shrink-0">
                            <svg className="w-4 h-4 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-[var(--sl-text)]">{app.name}</p>
                          <p className="truncate text-[11px] text-[var(--sl-muted)]">{app.bundleIdentifier}</p>
                          <p className="mt-0.5 text-[11px] text-[var(--sl-muted)]">
                            {(app.developerName ?? 'Unknown developer')} -- v{version}
                          </p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); void onImportSourceApp(app); }}
                          disabled={!downloadUrl || busy === `import:${app.bundleIdentifier}`}
                          className="sl-btn-primary sl-btn-sm disabled:opacity-40"
                          aria-label={`Import ${app.name}`}
                        >
                          {busy === `import:${app.bundleIdentifier}` ? 'Importing...' : 'Import IPA'}
                        </button>
                        <svg
                          className={`w-4 h-4 text-[var(--sl-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
                          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                        </svg>
                      </div>
                    </div>
                    {isExpanded && (
                      <SourceAppDetail
                        app={app}
                        busy={busy}
                        onImport={() => void onImportSourceApp(app)}
                        downloadUrl={downloadUrl}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </section>
        </>
      )}

      {activeTab === 'configured' && (
      <section className="sl-card p-4">
        <h3 className="text-[13px] font-semibold text-[var(--sl-text)]">Configured Sources</h3>
        <p className="mt-1 text-[12px] text-[var(--sl-muted)]">Built-in and custom feeds currently tracked by SideLink.</p>

        {sources.length > 3 && (
          <div className="mt-3">
            <SearchInput
              value={sourceSearch}
              onChange={setSourceSearch}
              placeholder="Filter sources by name or URL..."
            />
          </div>
        )}

        <div className="mt-3">
          {loading ? (
            <div className="animate-fadeIn space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="sl-card-soft flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="sl-skeleton h-9 w-9 rounded-xl shrink-0" />
                    <div className="space-y-2 flex-1">
                      <div className="sl-skeleton h-4 w-36" />
                      <div className="sl-skeleton h-3 w-56" />
                    </div>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <div className="sl-skeleton h-7 w-18 rounded-lg" />
                    <div className="sl-skeleton h-7 w-18 rounded-lg" />
                  </div>
                </div>
              ))}
            </div>
          ) : sources.length === 0 ? (
            <>
              <EmptyState title="No sources configured" description="Add your first source URL above or try a popular source below." />
              <PopularSourcesSuggestion onAddUrl={(url) => { setAddingUrl(url); setActiveTab('configured'); }} />
            </>
          ) : (
            <div className="space-y-2">
              {filteredSources.length === 0 && sourceSearch ? (
                <div className="sl-card-soft px-4 py-6 text-center">
                  <p className="text-[13px] text-[var(--sl-muted)]">No sources matching &ldquo;{sourceSearch}&rdquo;</p>
                </div>
              ) : filteredSources.map((source) => (
                <div key={source.id} className="sl-card-soft flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    {source.iconURL ? (
                      <img src={source.iconURL} alt="" className="w-9 h-9 rounded-xl shrink-0 bg-[var(--sl-surface-soft)]" onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }} />
                    ) : (
                      <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--sl-surface-soft)] shrink-0">
                        <svg className="w-4 h-4 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" /></svg>
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-semibold text-[var(--sl-text)]">{source.name}</p>
                        {source.isBuiltIn && <span className="rounded-md border border-[var(--sl-border)] px-1.5 py-0.5 text-[10px] text-[var(--sl-muted)]">Built-in</span>}
                        <span className={`rounded-md px-1.5 py-0.5 text-[10px] font-semibold ${source.enabled ? 'bg-emerald-500/10 text-emerald-400' : 'bg-[var(--sl-surface-soft)] text-[var(--sl-muted)]'}`}>
                          {source.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-[var(--sl-muted)]">{source.url}</p>
                      <p className="mt-0.5 text-[11px] text-[var(--sl-muted)]">
                        <span className="font-semibold text-[var(--sl-text)]">{source.appCount ?? 0}</span> app{(source.appCount ?? 0) === 1 ? '' : 's'} available
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <button
                      onClick={() => void onRefresh(source)}
                      disabled={busy === `refresh:${source.id}`}
                      className="sl-btn-ghost sl-btn-sm"
                      aria-label={`Refresh ${source.name}`}
                    >
                      {busy === `refresh:${source.id}` ? 'Refreshing...' : 'Refresh'}
                    </button>
                    <button
                      onClick={() => void onRemove(source)}
                      disabled={source.isBuiltIn || busy === `remove:${source.id}`}
                      className="sl-btn-danger sl-btn-sm disabled:opacity-40"
                      aria-label={`Remove ${source.name}`}
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
      )}

      {activeTab === 'self-hosted' && (
        <SelfHostedEditor
          selfHostedText={selfHostedText}
          setSelfHostedText={setSelfHostedText}
          selfHostedDirty={selfHostedDirty}
          setSelfHostedDirty={setSelfHostedDirty}
          selfHostedForm={selfHostedForm}
          setSelfHostedForm={setSelfHostedForm}
          busy={busy}
          onSave={onSaveSelfHosted}
          onReload={() => void reload()}
        />
      )}
    </div>
  );
}

const POPULAR_SOURCES = [
  {
    name: 'AltStore',
    url: 'https://cdn.altstore.io/file/altstore/apps.json',
    description: 'The official AltStore source with AltStore, Delta, and Clip.',
  },
  {
    name: 'SideStore',
    url: 'https://raw.githubusercontent.com/SideStore/SideStore/main/SideStore.json',
    description: 'Community-driven alternative with additional apps and utilities.',
  },
];

function PopularSourcesSuggestion({ onAddUrl }: { onAddUrl: (url: string) => void }) {
  return (
    <div className="mt-4 sl-card p-4">
      <SectionHeading eyebrow="Get Started" title="Popular Sources" />
      <p className="text-[12px] text-[var(--sl-muted)] mb-3">Try adding one of these well-known AltStore-compatible sources to get started.</p>
      <div className="space-y-2">
        {POPULAR_SOURCES.map((source) => (
          <div key={source.url} className="sl-card-soft flex flex-col gap-3 p-3 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 min-w-0">
              <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[var(--sl-accent)]/10 shrink-0">
                <svg className="w-4 h-4 text-[var(--sl-accent)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" /></svg>
              </div>
              <div className="min-w-0">
                <p className="text-sm font-semibold text-[var(--sl-text)]">{source.name}</p>
                <p className="text-[11px] text-[var(--sl-muted)]">{source.description}</p>
                <p className="truncate text-[10px] text-[var(--sl-muted)] mt-0.5 font-mono">{source.url}</p>
              </div>
            </div>
            <button
              onClick={() => onAddUrl(source.url)}
              className="sl-btn-primary sl-btn-sm whitespace-nowrap"
              aria-label={`Add ${source.name} source`}
            >
              Add Source
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Collect all screenshot URLs from the various SourceApp formats. */
function collectScreenshots(app: SourceApp): string[] {
  const urls: string[] = [];

  // Structured screenshots (v2 format)
  if (app.screenshots) {
    const addStructured = (items?: SourceScreenshot[]) => {
      if (items) {
        for (const s of items) {
          if (s.imageURL) urls.push(s.imageURL);
        }
      }
    };
    addStructured(app.screenshots.iphone);
    addStructured(app.screenshots.ipad);
  }

  // Legacy flat array
  if (app.screenshotURLs) {
    for (const u of app.screenshotURLs) {
      if (u && !urls.includes(u)) urls.push(u);
    }
  }

  return urls;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SourceAppDetail({ app, busy, onImport, downloadUrl }: {
  app: SourceApp;
  busy: string | null;
  onImport: () => void;
  downloadUrl: string | null;
}) {
  const screenshots = collectScreenshots(app);
  const latestVersion = app.versions?.[0];
  const version = latestVersion?.version ?? app.version ?? 'Unknown';
  const size = latestVersion?.size ?? app.size;
  const description = app.localizedDescription ?? app.subtitle ?? latestVersion?.localizedDescription ?? null;
  const versionDate = latestVersion?.date ?? app.versionDate ?? null;
  const minOS = latestVersion?.minOSVersion ?? null;

  return (
    <div className="sl-card mt-1 p-4 animate-fadeIn">
      <div className="flex flex-col gap-4 md:flex-row">
        {/* Left column: icon and metadata */}
        <div className="flex flex-col items-center gap-3 md:w-48 shrink-0">
          {safeHttpsUrl(app.iconURL) ? (
            <img
              {...untrustedImgProps}
              src={safeHttpsUrl(app.iconURL) ?? undefined}
              alt={`${app.name} icon`}
              className="w-20 h-20 rounded-2xl bg-[var(--sl-surface-soft)]"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="flex h-20 w-20 items-center justify-center rounded-2xl bg-[var(--sl-surface-soft)]">
              <svg className="w-8 h-8 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}><path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" /></svg>
            </div>
          )}

          <div className="text-center space-y-1">
            <p className="text-[12px] text-[var(--sl-muted)]">
              <span className="font-semibold text-[var(--sl-text)]">Version</span> {version}
            </p>
            {size != null && (
              <p className="text-[12px] text-[var(--sl-muted)]">
                <span className="font-semibold text-[var(--sl-text)]">Size</span> {formatBytes(size)}
              </p>
            )}
            {app.developerName && (
              <p className="text-[12px] text-[var(--sl-muted)]">
                <span className="font-semibold text-[var(--sl-text)]">Developer</span> {app.developerName}
              </p>
            )}
            {versionDate && (
              <p className="text-[12px] text-[var(--sl-muted)]">
                <span className="font-semibold text-[var(--sl-text)]">Released</span> {new Date(versionDate).toLocaleDateString()}
              </p>
            )}
            {minOS && (
              <p className="text-[12px] text-[var(--sl-muted)]">
                <span className="font-semibold text-[var(--sl-text)]">Min iOS</span> {minOS}
              </p>
            )}
            {app.category && (
              <p className="text-[12px] text-[var(--sl-muted)]">
                <span className="font-semibold text-[var(--sl-text)]">Category</span> {app.category}
              </p>
            )}
          </div>

          <button
            onClick={onImport}
            disabled={!downloadUrl || busy === `import:${app.bundleIdentifier}`}
            className="sl-btn-primary w-full disabled:opacity-40"
            aria-label={`Import ${app.name}`}
          >
            {busy === `import:${app.bundleIdentifier}` ? 'Importing...' : 'Import IPA'}
          </button>
        </div>

        {/* Right column: description + screenshots */}
        <div className="flex-1 min-w-0 space-y-4">
          {description && (
            <div>
              <h4 className="text-[12px] font-semibold text-[var(--sl-text)] mb-1">Description</h4>
              <p className="text-[12px] text-[var(--sl-muted)] leading-relaxed whitespace-pre-line">{description}</p>
            </div>
          )}

          {screenshots.length > 0 && (
            <div>
              <h4 className="text-[12px] font-semibold text-[var(--sl-text)] mb-2">Screenshots</h4>
              <div className="flex gap-3 overflow-x-auto pb-2" style={{ scrollbarWidth: 'thin' }}>
                {screenshots.map((url, i) => (
                  <img
                    key={i}
                    src={url}
                    alt={`${app.name} screenshot ${i + 1}`}
                    className="h-64 w-auto rounded-lg bg-[var(--sl-surface-soft)] shrink-0 object-contain"
                    loading="lazy"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ))}
              </div>
            </div>
          )}

          {app.appPermissions?.entitlements && app.appPermissions.entitlements.length > 0 && (
            <div>
              <h4 className="text-[12px] font-semibold text-[var(--sl-text)] mb-1">Entitlements</h4>
              <div className="flex flex-wrap gap-1">
                {app.appPermissions.entitlements.map((ent, i) => (
                  <span key={i} className="rounded-md bg-[var(--sl-surface-soft)] px-2 py-0.5 text-[10px] text-[var(--sl-muted)] font-mono">
                    {ent}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getDownloadUrl(app: SourceApp): string | null {
  const versionUrl = app.versions?.[0]?.downloadURL;
  if (versionUrl && versionUrl.length > 0) return versionUrl;
  if (app.downloadURL && app.downloadURL.length > 0) return app.downloadURL;
  return null;
}
