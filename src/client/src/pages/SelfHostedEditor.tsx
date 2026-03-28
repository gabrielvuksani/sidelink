import { useState } from 'react';
import { api } from '../lib/api';
import { getErrorMessage } from '../lib/errors';
import { useToast } from '../components/Toast';
import type { SourceManifest } from '../../../shared/types';

// ── Types ────────────────────────────────────────────────────────────

export interface SelfHostedFormState {
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

export interface SelfHostedAppDraft {
  name: string;
  bundleIdentifier: string;
  developerName: string;
  version: string;
  downloadURL: string;
  iconURL: string;
  localizedDescription: string;
}

// ── Utility functions ────────────────────────────────────────────────

export function emptySelfHostedFormState(): SelfHostedFormState {
  return {
    name: 'SideLink Self Hosted',
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

export function emptySelfHostedAppDraft(): SelfHostedAppDraft {
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

export function emptySelfHostedManifest(): SourceManifest {
  return {
    name: 'SideLink Self Hosted',
    identifier: 'com.sidelink.self-hosted',
    sourceURL: '/api/sources/self-hosted',
    apps: [],
  };
}

export function parseManifestText(raw: string): SourceManifest | null {
  try {
    return JSON.parse(raw) as SourceManifest;
  } catch {
    return null;
  }
}

export function manifestToFormState(manifest: SourceManifest): SelfHostedFormState {
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

export function formStateToManifestPatch(form: SelfHostedFormState): Omit<SourceManifest, 'apps'> {
  return {
    name: form.name.trim() || 'SideLink Self Hosted',
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

// ── Component ────────────────────────────────────────────────────────

export function SelfHostedEditor({
  selfHostedText,
  setSelfHostedText,
  selfHostedDirty,
  setSelfHostedDirty,
  selfHostedForm,
  setSelfHostedForm,
  busy,
  onSave,
  onReload,
}: {
  selfHostedText: string;
  setSelfHostedText: (text: string) => void;
  selfHostedDirty: boolean;
  setSelfHostedDirty: (dirty: boolean) => void;
  selfHostedForm: SelfHostedFormState;
  setSelfHostedForm: (fn: SelfHostedFormState | ((prev: SelfHostedFormState) => SelfHostedFormState)) => void;
  busy: string | null;
  onSave: () => void;
  onReload: () => void;
}) {
  const { toast } = useToast();
  const [selfHostedAppDraft, setSelfHostedAppDraft] = useState<SelfHostedAppDraft>(emptySelfHostedAppDraft());

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

  return (
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
        <button onClick={applyFormToManifest} className="sl-btn-ghost sl-btn-sm">Apply Form to JSON</button>
        <button onClick={loadFormFromManifest} className="sl-btn-ghost sl-btn-sm">Load Form from JSON</button>
        <button onClick={exportSelfHostedManifest} className="sl-btn-ghost sl-btn-sm">Export JSON</button>
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
        <button onClick={addDraftAppToManifest} className="sl-btn-primary sl-btn-sm mt-2">Add/Update App</button>
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
          onClick={() => void onSave()}
          disabled={!selfHostedDirty || busy === 'self-hosted'}
          className="sl-btn-primary"
        >
          {busy === 'self-hosted' ? 'Saving...' : 'Save Self-Hosted Manifest'}
        </button>
        <button onClick={() => void onReload()} className="sl-btn-ghost">Reload</button>
      </div>
    </section>
  );
}
