import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { useInstallModal } from '../components/InstallModal';
import { PageHeader, EmptyState, SectionHeading, SearchInput, DropZone } from '../components/Shared';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import { formatFileSize } from '../lib/format';
import type { IpaArtifact } from '../../../shared/types';
import { UI_LIMITS } from '../../../shared/constants';

const MAX_FILE_SIZE = UI_LIMITS.maxIpaFileSizeBytes;

export default function AppsPage() {
  const warmSnapshot = getUiSnapshot<IpaArtifact[]>('page:ipas');
  const [ipas, setIpas] = useState<IpaArtifact[]>(warmSnapshot?.data ?? []);
  const [loading, setLoading] = useState(!warmSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const ipasRef = useRef<IpaArtifact[]>(warmSnapshot?.data ?? []);
  const [searchQuery, setSearchQuery] = useState('');
  const [importUrl, setImportUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [showUrlImport, setShowUrlImport] = useState(false);
  const [expandedIpa, setExpandedIpa] = useState<string | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);
  const { toast } = useToast();
  const confirm = useConfirm();
  const { openInstall } = useInstallModal();

  const filteredIpas = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return ipas;
    return ipas.filter((ipa) =>
      (ipa.bundleName ?? ipa.originalName).toLowerCase().includes(q)
      || ipa.bundleId.toLowerCase().includes(q)
      || (ipa.bundleShortVersion ?? '').toLowerCase().includes(q),
    );
  }, [ipas, searchQuery]);

  useEffect(() => { document.title = 'IPAs — SideLink'; }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('import') === 'url') {
      setShowUrlImport(true);
      window.history.replaceState({}, '', '/apps');
    }
  }, []);

  useEffect(() => {
    ipasRef.current = ipas;
  }, [ipas]);

  const reload = useCallback((force = false) => {
    if (!ipasRef.current.length) {
      setLoading(true);
    } else {
      setRefreshing(true);
    }

    api.listIpas({ bypassCache: force })
      .then((response) => {
        const nextIpas = response.data ?? [];
        setIpas(nextIpas);
        setUiSnapshot('page:ipas', nextIpas);
      })
      .finally(() => {
        setLoading(false);
        setRefreshing(false);
      });
  }, []);

  usePageRefresh(reload, { initialForce: !warmSnapshot, minIntervalMs: 20_000 });

  const upload = async (file: File) => {
    if (uploading) return;
    if (file.size > MAX_FILE_SIZE) {
      toast('error', 'File too large — maximum 4 GB');
      return;
    }
    setUploading(true);
    setUploadPct(0);
    try {
      const res = await api.uploadIpa(file, setUploadPct);
      const ipa = res.data;
      if (ipa?.previousVersion) {
        toast('success', `Updated from v${ipa.previousVersion.version} (${formatFileSize(ipa.previousVersion.fileSize)}) → v${ipa.bundleShortVersion} (${formatFileSize(ipa.fileSize)})`);
      } else {
        toast('success', `Uploaded ${file.name}`);
      }
      setSelectedFile(null);
      void reload(true);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Upload failed'));
    } finally {
      setUploading(false);
      setUploadPct(0);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleFiles = (files: FileList | null) => {
    if (!files?.length || uploading) return;
    const f = files[0];
    if (!f.name.endsWith('.ipa')) {
      toast('warning', 'Please select an .ipa file');
      return;
    }
    setSelectedFile(f);
    upload(f);
  };

  const handleClick = () => {
    if (uploading) return;
    fileRef.current?.click();
  };

  const onDropFiles = (files: FileList) => {
    handleFiles(files);
  };

  const handleImportUrl = async () => {
    if (!importUrl.trim() || importing) return;
    setImporting(true);
    try {
      const res = await api.importIpaFromUrl(importUrl.trim());
      const ipa = res.data;
      if (ipa?.previousVersion) {
        toast('success', `Updated from v${ipa.previousVersion.version} (${formatFileSize(ipa.previousVersion.fileSize)}) → v${ipa.bundleShortVersion} (${formatFileSize(ipa.fileSize)})`);
      } else {
        toast('success', `Imported ${ipa?.bundleName ?? 'IPA'}`);
      }
      setImportUrl('');
      setShowUrlImport(false);
      reload(true);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Import failed'));
    } finally {
      setImporting(false);
    }
  };

  const remove = async (ipa: IpaArtifact) => {
    const ok = await confirm({
      title: 'Delete IPA',
      message: `Delete "${ipa.bundleName ?? ipa.originalName}"? This cannot be undone.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    try {
      await api.deleteIpa(ipa.id);
      toast('success', 'IPA deleted');
      void reload(true);
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to delete IPA'));
    }
  };

  const toggleSelection = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exitSelectionMode = () => {
    setSelectionMode(false);
    setSelectedIds(new Set());
  };

  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    const ok = await confirm({
      title: 'Delete Selected IPAs',
      message: `Delete ${selectedIds.size} selected IPA${selectedIds.size !== 1 ? 's' : ''}? This cannot be undone.`,
      confirmLabel: `Delete ${selectedIds.size}`,
      danger: true,
    });
    if (!ok) return;
    setBulkDeleting(true);
    let deleted = 0;
    for (const id of selectedIds) {
      try {
        await api.deleteIpa(id);
        deleted++;
      } catch {
        /* continue with remaining */
      }
    }
    toast('success', `Deleted ${deleted} IPA${deleted !== 1 ? 's' : ''}`);
    exitSelectionMode();
    setBulkDeleting(false);
    void reload(true);
  };

  return (
    <div className="sl-page animate-fadeIn">
      <PageHeader
        eyebrow="Library"
        title="IPA Library"
        description="Upload, manage, and install apps from your local IPA collection."
        stats={[
          { label: 'Library Size', value: ipas.length, tone: 'teal' },
          { label: 'Upload State', value: uploading ? `${uploadPct}%` : 'Idle', tone: uploading ? 'amber' : 'slate' },
          { label: 'Max File Size', value: '4 GB', tone: 'sky' },
        ]}
      />

      <SectionHeading
        eyebrow="Upload"
        title="Add new IPA"
      />

      {refreshing && !uploading && (
        <div className="sl-card px-4 py-2 text-[12px] text-[var(--sl-muted)]">Refreshing IPA library...</div>
      )}

      {/* Upload zone */}
      <DropZone onDrop={onDropFiles} accept=".ipa" className="cursor-pointer">
        <div
          onClick={() => !uploading && handleClick()}
          className={`relative p-8 text-center transition-all ${
            uploading ? 'cursor-wait' : 'cursor-pointer'
          }`}
          role="button"
          tabIndex={0}
          aria-label="Upload IPA file. Click or drag and drop an .ipa file here."
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(); } }}
        >
          <input
            ref={fileRef}
            type="file"
            accept=".ipa"
            onChange={(e) => handleFiles(e.target.files)}
            className="hidden"
            aria-hidden="true"
          />
          {uploading ? (
            <div className="space-y-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sl-accent)]/10 mx-auto">
                <svg className="w-6 h-6 text-[var(--sl-accent)] animate-pulse" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="text-[var(--sl-accent)] text-[14px] font-semibold">Uploading... {uploadPct}%</p>
              {selectedFile && (
                <p className="text-[12px] text-[var(--sl-muted)]">{selectedFile.name} ({formatFileSize(selectedFile.size)})</p>
              )}
              <div className="max-w-xs mx-auto h-2 bg-[var(--sl-surface-soft)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--sl-accent)] rounded-full transition-all duration-200"
                  style={{ width: `${uploadPct}%` }}
                  role="progressbar"
                  aria-valuenow={uploadPct}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label="Upload progress"
                />
              </div>
            </div>
          ) : (
            <>
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--sl-surface-soft)] mx-auto mb-3 border-2 border-dashed border-[var(--sl-border)]">
                <svg className="w-6 h-6 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
                </svg>
              </div>
              <p className="text-[14px] font-semibold text-[var(--sl-text)]">Drop an .ipa file here or click to browse</p>
              <p className="text-[12px] text-[var(--sl-muted)] mt-1">Accepts .ipa files up to 4 GB</p>
            </>
          )}
        </div>
      </DropZone>

      {!showUrlImport && (
        <button
          onClick={() => setShowUrlImport(true)}
          className="mt-2 flex items-center gap-1.5 text-[12px] text-[var(--sl-muted)] hover:text-[var(--sl-accent)] transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.54a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.34 8.798" />
          </svg>
          Import from URL
        </button>
      )}

      {showUrlImport && (
        <div className="sl-card p-4 mt-2 animate-fadeInUp">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-[var(--sl-text)]">Import from URL</h3>
            <button onClick={() => setShowUrlImport(false)} className="text-[var(--sl-muted)] hover:text-[var(--sl-text)]">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
          <div className="flex gap-2">
            <input
              type="url"
              value={importUrl}
              onChange={e => setImportUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleImportUrl()}
              placeholder="https://example.com/app.ipa"
              className="sl-input flex-1"
              autoFocus
            />
            <button onClick={handleImportUrl} disabled={!importUrl.trim() || importing} className="sl-btn-primary sl-btn-sm">
              {importing ? 'Importing...' : 'Import'}
            </button>
          </div>
          <p className="text-[11px] text-[var(--sl-muted)] mt-2">Paste a direct download URL to an .ipa file.</p>
        </div>
      )}

      {/* IPA list */}
      {loading ? (
        <div className="animate-fadeIn space-y-2">
          <SectionHeading eyebrow="Shelf" title="Ready to install" />
          {[1, 2, 3].map((i) => (
            <div key={i} className="sl-card flex items-center justify-between p-3.5">
              <div className="flex items-center gap-3 min-w-0">
                <div className="sl-skeleton h-10 w-10 rounded-xl shrink-0" />
                <div className="space-y-2">
                  <div className="sl-skeleton h-4 w-36" />
                  <div className="flex gap-2">
                    <div className="sl-skeleton h-3 w-28" />
                    <div className="sl-skeleton h-3 w-12" />
                    <div className="sl-skeleton h-3 w-16" />
                  </div>
                </div>
              </div>
              <div className="flex gap-1.5 shrink-0 ml-3">
                <div className="sl-skeleton h-7 w-16 rounded-lg" />
                <div className="sl-skeleton h-7 w-16 rounded-lg" />
              </div>
            </div>
          ))}
        </div>
      ) : ipas.length === 0 ? (
        <EmptyState
          title="No IPAs yet"
          description="Upload your first IPA to get started with sideloading apps to your device."
          icon={
            <svg className="w-10 h-10" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
            </svg>
          }
          action={
            <button onClick={handleClick} className="sl-btn-primary flex items-center gap-2" aria-label="Upload your first IPA file">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
              Upload your first IPA
            </button>
          }
        />
      ) : (
        <div className="space-y-2 stagger-children">
          <SectionHeading
            eyebrow="Shelf"
            title="Ready to install"
            action={
              <div className="flex items-center gap-2">
                <button
                  onClick={() => selectionMode ? exitSelectionMode() : setSelectionMode(true)}
                  className={selectionMode ? 'sl-btn-ghost sl-btn-sm border border-[var(--sl-accent)] text-[var(--sl-accent)]' : 'sl-btn-ghost sl-btn-sm'}
                  aria-label={selectionMode ? 'Cancel selection' : 'Select IPAs'}
                >
                  {selectionMode ? 'Cancel' : 'Select'}
                </button>
                <button onClick={() => openInstall()} className="sl-btn-primary sl-btn-sm" aria-label="Install an app from library">Install App</button>
              </div>
            }
          />
          {ipas.length > 3 && (
            <SearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Search by name, bundle ID, or version..."
            />
          )}
          {filteredIpas.length === 0 && searchQuery ? (
            <div className="sl-card px-4 py-8 text-center">
              <p className="text-[13px] text-[var(--sl-muted)]">No IPAs matching &ldquo;{searchQuery}&rdquo;</p>
            </div>
          ) : filteredIpas.map(ipa => (
            <div key={ipa.id} className={`sl-card sl-card-interactive group p-3.5 animate-fadeInUp ${selectionMode && selectedIds.has(ipa.id) ? 'ring-1 ring-[var(--sl-accent)]' : ''}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3 min-w-0">
                  {selectionMode && (
                    <input
                      type="checkbox"
                      checked={selectedIds.has(ipa.id)}
                      onChange={() => toggleSelection(ipa.id)}
                      className="h-4 w-4 shrink-0 rounded border-[var(--sl-border)] bg-transparent text-[var(--sl-accent)] focus:ring-[var(--sl-accent)]"
                      aria-label={`Select ${ipa.bundleName ?? ipa.originalName}`}
                    />
                  )}
                  {ipa.iconData ? (
                    <img src={`data:image/png;base64,${ipa.iconData}`} alt={`${ipa.bundleName ?? ipa.originalName} icon`} className="w-10 h-10 rounded-xl shrink-0" />
                  ) : (
                    <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-[var(--sl-accent)]/20 to-[var(--sl-accent-2)]/20 shrink-0">
                      <svg className="w-5 h-5 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5M10 11.25h4M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
                      </svg>
                    </div>
                  )}
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-[var(--sl-text)] truncate">{ipa.bundleName ?? ipa.originalName}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {ipa.bundleId && <span className="text-[11px] font-mono text-[var(--sl-muted)] truncate max-w-[180px]">{ipa.bundleId}</span>}
                      {ipa.bundleShortVersion && <span className="text-[11px] text-[var(--sl-muted)]">v{ipa.bundleShortVersion}</span>}
                      <span className="text-[11px] text-[var(--sl-muted)]">{formatFileSize(ipa.fileSize)}</span>
                      {(ipa.extensions?.length ?? 0) > 0 && (
                        <span className="text-[11px] text-[var(--sl-accent)]">{ipa.extensions.length} ext{ipa.extensions.length > 1 ? 's' : ''}</span>
                      )}
                    </div>
                  </div>
                </div>
                {!selectionMode && (
                  <div className="flex items-center gap-1.5 shrink-0 ml-3">
                    <button
                      onClick={() => setExpandedIpa(expandedIpa === ipa.id ? null : ipa.id)}
                      className="text-[var(--sl-muted)] hover:text-[var(--sl-text)] transition-colors p-1"
                      aria-label={expandedIpa === ipa.id ? 'Collapse details' : 'Expand details'}
                    >
                      <svg className={`w-4 h-4 transition-transform ${expandedIpa === ipa.id ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" /></svg>
                    </button>
                    <button
                      onClick={() => openInstall({ ipaId: ipa.id })}
                      className="sl-btn-primary sl-btn-sm sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      aria-label={`Install ${ipa.bundleName ?? ipa.originalName}`}
                    >
                      Install
                    </button>
                    <button
                      onClick={() => remove(ipa)}
                      className="sl-btn-danger sl-btn-xs sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                      aria-label={`Delete ${ipa.bundleName ?? ipa.originalName}`}
                    >
                      Delete
                    </button>
                  </div>
                )}
              </div>
              {!selectionMode && expandedIpa === ipa.id && (
                <div className="sl-card-soft p-4 mt-3 space-y-3 animate-fadeInUp rounded-xl">
                  <div className="grid grid-cols-2 gap-3 text-[12px]">
                    <div><span className="text-[var(--sl-muted)]">Bundle ID</span><p className="font-mono text-[var(--sl-text)]">{ipa.bundleId}</p></div>
                    <div><span className="text-[var(--sl-muted)]">Version</span><p className="text-[var(--sl-text)]">{ipa.bundleShortVersion} ({ipa.bundleVersion})</p></div>
                    <div><span className="text-[var(--sl-muted)]">Min iOS</span><p className="text-[var(--sl-text)]">{ipa.minOsVersion || 'Not specified'}</p></div>
                    <div><span className="text-[var(--sl-muted)]">Size</span><p className="text-[var(--sl-text)]">{formatFileSize(ipa.fileSize)}</p></div>
                  </div>
                  {ipa.extensions.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sl-muted)] mb-1">Extensions ({ipa.extensions.length})</p>
                      <div className="space-y-1">
                        {ipa.extensions.map(ext => (
                          <div key={ext.bundleId} className="text-[12px] font-mono text-[var(--sl-text)]">{ext.name} <span className="text-[var(--sl-muted)]">({ext.bundleId})</span></div>
                        ))}
                      </div>
                    </div>
                  )}
                  {Object.keys(ipa.entitlements).length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sl-muted)] mb-1">Entitlements</p>
                      <div className="space-y-0.5">
                        {Object.entries(ipa.entitlements).map(([key, val]) => (
                          <div key={key} className="text-[12px] font-mono"><span className="text-[var(--sl-accent)]">{key}</span> <span className="text-[var(--sl-muted)]">= {JSON.stringify(val)}</span></div>
                        ))}
                      </div>
                    </div>
                  )}
                  {ipa.warnings.length > 0 && (
                    <div>
                      <p className="text-[11px] font-semibold uppercase tracking-wider text-[var(--sl-warning)] mb-1">Warnings</p>
                      {ipa.warnings.map((w, i) => <p key={i} className="text-[12px] text-[var(--sl-warning)]">{w}</p>)}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}

          {/* Floating bulk delete bar */}
          {selectionMode && selectedIds.size > 0 && (
            <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2 animate-fadeInUp">
              <div className="flex items-center gap-3 rounded-2xl border border-[var(--sl-border)] bg-[var(--sl-surface)] px-5 py-3 shadow-2xl backdrop-blur-xl">
                <span className="text-[13px] text-[var(--sl-text)]">{selectedIds.size} selected</span>
                <button
                  onClick={bulkDelete}
                  disabled={bulkDeleting}
                  className="sl-btn-danger sl-btn-sm flex items-center gap-2"
                >
                  {bulkDeleting && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
                  {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedIds.size})`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
