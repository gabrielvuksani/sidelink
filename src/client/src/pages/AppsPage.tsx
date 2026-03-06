import { useState, useEffect, useRef, useCallback, type DragEvent } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmModal';
import { useInstallModal } from '../components/InstallModal';
import { PageLoader, EmptyState } from '../components/Shared';
import type { IpaArtifact } from '../../../shared/types';
import { UI_LIMITS } from '../../../shared/constants';

const MAX_FILE_SIZE = UI_LIMITS.maxIpaFileSizeBytes;

export default function AppsPage() {
  const [ipas, setIpas] = useState<IpaArtifact[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const confirm = useConfirm();
  const { openInstall } = useInstallModal();

  useEffect(() => { document.title = 'IPAs — SideLink'; }, []);

  const reload = useCallback(() => {
    api.listIpas().then(r => setIpas(r.data ?? [])).finally(() => setLoading(false));
  }, []);

  useEffect(() => { reload(); }, [reload]);

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
      reload();
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
    upload(f);
  };

  const handleClick = () => {
    if (uploading) return;
    fileRef.current?.click();
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
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
      reload();
    } catch (e: unknown) {
      toast('error', getErrorMessage(e, 'Failed to delete IPA'));
    }
  };

  return (
    <div className="space-y-6 animate-fadeIn">
      {/* Header */}
      <div>
        <h2 className="text-xl font-bold text-[var(--sl-text)]">IPAs</h2>
        <p className="text-[13px] text-[var(--sl-muted)] mt-0.5">Upload and manage your app files</p>
      </div>

      {/* Upload zone */}
      <div
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && handleClick()}
        className={`sl-card relative p-8 text-center transition-all cursor-pointer !border-dashed ${
          uploading
            ? '!border-[var(--sl-accent)]/30 !bg-[var(--sl-accent)]/[0.03] cursor-wait'
            : dragging
              ? '!border-[var(--sl-accent)]/50 !bg-[var(--sl-accent)]/[0.05]'
              : 'hover:!border-[var(--sl-border-hover)] hover:!bg-[var(--sl-surface-soft)]'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".ipa"
          onChange={(e) => handleFiles(e.target.files)}
          className="hidden"
        />
        {uploading ? (
          <div>
            <p className="text-[var(--sl-accent)] text-[13px] font-medium mb-3">Uploading... {uploadPct}%</p>
            <div className="w-48 mx-auto h-1.5 bg-[var(--sl-surface-soft)] rounded-full overflow-hidden">
              <div className="h-full bg-[var(--sl-accent)] rounded-full transition-all duration-200" style={{ width: `${uploadPct}%` }} />
            </div>
          </div>
        ) : (
          <>
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[var(--sl-surface-soft)] mx-auto mb-3">
              <svg className="w-5 h-5 text-[var(--sl-muted)]" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <p className="text-[13px] font-medium text-[var(--sl-text)]">Drop an .ipa file here or click to browse</p>
            <p className="text-[12px] text-[var(--sl-muted)] mt-1">Maximum 4 GB</p>
          </>
        )}
      </div>

      {/* IPA list */}
      {loading ? (
        <PageLoader message="Loading IPAs..." />
      ) : ipas.length === 0 ? (
        <EmptyState title="No IPAs yet" description="Upload an .ipa file above to get started." />
      ) : (
        <div className="space-y-2 stagger-children">
          {ipas.map(ipa => (
            <div key={ipa.id} className="sl-card sl-card-interactive group flex items-center justify-between p-3.5 animate-fadeInUp">
              <div className="flex items-center gap-3 min-w-0">
                {ipa.iconData ? (
                  <img src={`data:image/png;base64,${ipa.iconData}`} alt="" className="w-10 h-10 rounded-xl shrink-0" />
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
                    <span className="text-[11px] text-[var(--sl-muted)]">{(ipa.fileSize / (1024 * 1024)).toFixed(1)} MB</span>
                    {(ipa.extensions?.length ?? 0) > 0 && (
                      <span className="text-[11px] text-[var(--sl-accent)]">{ipa.extensions.length} ext{ipa.extensions.length > 1 ? 's' : ''}</span>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 ml-3">
                <button onClick={() => openInstall({ ipaId: ipa.id })} className="sl-btn-primary !text-[12px] !px-3 !py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  Install
                </button>
                <button onClick={() => remove(ipa)} className="sl-btn-danger !text-[12px] !px-2.5 !py-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
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
