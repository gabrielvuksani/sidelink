import type { SigningParams, SigningResult, CommandAuditWriter } from '../types';
import { signIpa as signIpaTs } from './ts-signer';
import { signIpa as signIpaNative } from './signer';
import { commandExists } from '../utils/command';
import { SigningError } from '../utils/errors';

export type SigningStrategy = 'auto' | 'native' | 'typescript';
export type ResolvedSigningStrategy = 'native' | 'typescript';

function normalizeStrategy(raw: string | undefined): SigningStrategy {
	const value = (raw ?? 'auto').trim().toLowerCase();
	if (value === 'native' || value === 'codesign') return 'native';
	if (value === 'typescript' || value === 'ts' || value === 'ts-signer') return 'typescript';
	return 'auto';
}

export async function resolveSigningStrategy(options?: {
	strategy?: string;
	platform?: NodeJS.Platform;
	hasCodesign?: () => Promise<boolean>;
}): Promise<ResolvedSigningStrategy> {
	const strategy = normalizeStrategy(options?.strategy ?? process.env.SIDELINK_SIGNING_STRATEGY);
	const platform = options?.platform ?? process.platform;
	const hasCodesign = options?.hasCodesign ?? (() => commandExists('codesign'));

	if (strategy === 'typescript') return 'typescript';

	if (strategy === 'native') {
		if (platform !== 'darwin') {
			throw new SigningError(
				'NATIVE_SIGNING_UNSUPPORTED_PLATFORM',
				'Native signing requires macOS. Use SIDELINK_SIGNING_STRATEGY=auto or typescript on this platform.',
			);
		}
		if (!(await hasCodesign())) {
			throw new SigningError(
				'CODESIGN_NOT_FOUND',
				'Native signing requested but codesign is unavailable. Install Xcode Command Line Tools or use SIDELINK_SIGNING_STRATEGY=typescript.',
			);
		}
		return 'native';
	}

	if (platform === 'darwin' && (await hasCodesign())) {
		return 'native';
	}
	return 'typescript';
}

function auditStrategy(
	audit: CommandAuditWriter | undefined,
	jobId: string | undefined,
	resolved: ResolvedSigningStrategy,
	configured: SigningStrategy,
): void {
	if (!audit || !jobId) return;
	audit({
		jobId,
		command: 'signing-strategy',
		args: [resolved],
		cwd: null,
		exitCode: 0,
		stdout: `Configured strategy: ${configured}; selected strategy: ${resolved}`,
		stderr: '',
		durationMs: 0,
		notes: null,
	});
}

/**
 * Sign IPA with platform-aware strategy.
 *
 * macOS: Prefer native `codesign` implementation for maximum compatibility
 * with complex apps (multiple frameworks/extensions).
 * Other platforms: Use the pure TypeScript signer.
 */
export async function signIpa(
	params: SigningParams,
	audit?: CommandAuditWriter,
	jobId?: string,
): Promise<SigningResult> {
	const configured = normalizeStrategy(process.env.SIDELINK_SIGNING_STRATEGY);
	const selected = await resolveSigningStrategy({ strategy: configured });
	auditStrategy(audit, jobId, selected, configured);

	if (selected === 'native') {
		return signIpaNative(params, audit, jobId);
	}

	return signIpaTs(params, audit, jobId);
}

// Shared signing utilities
export * from './signing-utils';

// Sub-modules
export * from './macho';
export * from './codesign-structures';
