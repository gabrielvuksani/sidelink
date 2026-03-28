import { useState, useRef, type DragEvent } from 'react';
import { api } from '../../lib/api';
import { getErrorMessage } from '../../lib/errors';
import { useToast } from '../../components/Toast';
import { isElectron, pickIpaFile } from '../../lib/electron';
import { InlineNotice, StepActions } from './shared';
import type { IpaArtifact } from '../../../../shared/types';
import { UI_LIMITS } from '../../../../shared/constants';

const MAX_FILE_SIZE = UI_LIMITS.maxIpaFileSizeBytes;

export function UploadStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const [uploading, setUploading] = useState(false);
  const [uploadPct, setUploadPct] = useState(0);
  const [uploaded, setUploaded] = useState<IpaArtifact | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const upload = async (file: File) => {
    if (uploading) return;
    if (file.size > MAX_FILE_SIZE) { toast('error', 'File too large — maximum 4 GB'); return; }
    setUploading(true);
    setUploadPct(0);
    try {
      const res = await api.uploadIpa(file, setUploadPct);
      setUploaded(res.data ?? null);
      toast('success', `Uploaded ${file.name}`);
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
    if (!f.name.endsWith('.ipa')) { toast('warning', 'Please select an .ipa file'); return; }
    upload(f);
  };

  const handleElectronPick = async () => {
    const path = await pickIpaFile();
    if (path) {
      // Electron native picker returns a path — we need to create a fetch for it
      // For now, fall back to the HTML file input
      fileRef.current?.click();
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  if (uploaded) {
    return (
      <div>
        <div className="sl-card sl-card-emerald p-6 text-center mb-4">
          <svg aria-hidden="true" className="w-10 h-10 text-emerald-400 mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-emerald-400 font-medium">{uploaded.bundleName || uploaded.originalName}</p>
          <p className="text-emerald-400/60 text-xs mt-1">
            {uploaded.bundleId} · v{uploaded.bundleShortVersion}
          </p>
        </div>
        <StepActions onBack={onBack} onNext={onNext} />
      </div>
    );
  }

  return (
    <div>
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => !uploading && (isElectron ? handleElectronPick() : fileRef.current?.click())}
        className={`mt-2 border-2 border-dashed rounded-[28px] p-10 text-center transition-all mb-4 cursor-pointer ${
          uploading ? 'border-indigo-700 bg-indigo-950/10 cursor-wait'
          : dragging ? 'border-[var(--sl-accent)] bg-[rgba(45,212,191,0.08)]'
          : 'border-[var(--sl-border)] hover:border-[var(--sl-border-hover)] bg-[var(--sl-surface)]'
        }`}
      >
        <input
          ref={fileRef}
          type="file"
          accept=".ipa"
          onChange={e => handleFiles(e.target.files)}
          className="hidden"
        />
        {uploading ? (
          <div>
            <p className="text-indigo-400 text-sm mb-3">Uploading... {uploadPct}%</p>
            <div className="w-48 mx-auto h-2 bg-[var(--sl-surface-raised)] rounded-full overflow-hidden">
              <div
                className="h-full bg-[var(--sl-accent)] rounded-full transition-all duration-200"
                style={{ width: `${uploadPct}%` }}
              />
            </div>
          </div>
        ) : (
          <>
            <svg aria-hidden="true" className="w-10 h-10 text-[var(--sl-muted)] mx-auto mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-[var(--sl-text)] text-sm">Drop an .ipa file here or click to browse</p>
            <p className="text-[var(--sl-muted)] text-xs mt-1">Maximum 4 GB. Use this step to avoid landing on an empty dashboard.</p>
          </>
        )}
      </div>

      <InlineNotice title="Library Seed" tone="default">
        Uploading one IPA here makes the product feel immediately real: the dashboard, install flow, and source management all have something concrete to work with.
      </InlineNotice>

      <StepActions
        onBack={onBack}
        onNext={onNext}
        nextLabel="Skip for now"
        showSkip={false}
      />
    </div>
  );
}
