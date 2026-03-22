import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { usePageRefresh } from '../hooks/usePageRefresh';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { useInstallModal } from '../components/InstallModal';
import { PageHeader, PageLoader, EmptyState, SectionHeading, SearchInput, DropZone } from '../components/Shared';
import { getUiSnapshot, setUiSnapshot } from '../lib/ui-snapshot-cache';
import type { IpaArtifact } from '../../../shared/types';
import { UI_LIMITS } from '../../../shared/constants';

const MAX_FILE_SIZE = UI_LIMITS.maxIpaFileSizeBytes;

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

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
      await api.uploadIpa(file, setUploadPct);
      toast('success', `Uploaded ${file.name}`);
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
          ) : selectedFile && !uploading ? (
            <div className="space-y-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/10 mx-auto">
                <svg className="w-6 h-6 text-emerald-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="text-[13px] font-semibold text-[var(--sl-text)]">{selectedFile.name}</p>
              <p className="text-[12px] text-[var(--sl-muted)]">{formatFileSize(selectedFile.size)} -- .ipa file</p>
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

      {/* IPA list */}
      {loading ? (
        <PageLoader message="Loading IPAs..." />
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
            action={<button onClick={() => openInstall()} className="sl-btn-primary sl-btn-sm" aria-label="Install an app from library">Install App</button>}
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
            <div key={ipa.id} className="sl-card sl-card-interactive group flex items-center justify-between p-3.5 animate-fadeInUp">
              <div className="flex items-center gap-3 min-w-0">
                {ipa.iconData ? (
                  <img src={`data:image/png;base64,${ipa.iconData}`} alt={`${ipa.bundleName ?? ipa.originalName} icon`} className="w-10 h-10 rounded-xl shrink-0" />
                ) : (
                  <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[var(--sl-surface-soft)] shrink-0">
                    <svg className="w-4.5 h-4.5 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 01-2.247 2.118H6.622a2.25 2.25 0 01-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0l-3-3m3 3l3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125z" />
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
              <div className="flex items-center gap-1.5 shrink-0 ml-3">
                <button
                  onClick={() => openInstall({ ipaId: ipa.id })}
                  className="sl-btn-primary !text-[12px] !px-3 !py-1.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  aria-label={`Install ${ipa.bundleName ?? ipa.originalName}`}
                >
                  Install
                </button>
                <button
                  onClick={() => remove(ipa)}
                  className="sl-btn-danger !text-[12px] !px-2.5 !py-1.5 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                  aria-label={`Delete ${ipa.bundleName ?? ipa.originalName}`}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
