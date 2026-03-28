// ─── IPA Routes ──────────────────────────────────────────────────────
// POST /api/ipas/upload  — upload an IPA
// GET  /api/ipas         — list uploaded IPAs
// GET  /api/ipas/:id     — get IPA details
// DELETE /api/ipas/:id   — delete an IPA

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import type { AppContext } from '../context';
import { UI_LIMITS } from '../../shared/constants';
import { uploadRateLimit } from '../utils/security';
import { downloadToFileWithLimit } from '../utils/fetch';
import { isLocalNetworkHost } from '../utils/network';

export function ipaRoutes(ctx: AppContext): Router {
  const router = Router();

  const upload = multer({
    dest: ctx.uploadDir,
    limits: { fileSize: UI_LIMITS.maxIpaFileSizeBytes },
    fileFilter: (_req, file, cb) => {
      if (path.extname(file.originalname).toLowerCase() === '.ipa') {
        cb(null, true);
      } else {
        cb(new Error('Only .ipa files are accepted'));
      }
    },
  });

  // Upload IPA
  router.post('/upload', uploadRateLimit, upload.single('ipa'), async (req, res, next) => {
    try {
      if (!req.file) {
        return res.status(400).json({ ok: false, error: 'No IPA file uploaded' });
      }
      const ipa = await ctx.ipas.processUpload(req.file.path, req.file.originalname);
      res.json({ ok: true, data: ipa });
    } catch (err) {
      // Clean up multer temp file on processing failure
      if (req.file?.path) {
        await fs.unlink(req.file.path).catch(() => {});
      }
      next(err);
    }
  });

  // List IPAs
  router.get('/', (req, res) => {
    const ipas = ctx.ipas.list();
    res.json({ ok: true, data: ipas });
  });

  // Get IPA
  router.get('/:id', (req, res) => {
    const ipa = ctx.ipas.get(req.params.id);
    if (!ipa) return res.status(404).json({ ok: false, error: 'IPA not found' });
    res.json({ ok: true, data: ipa });
  });

  // Delete IPA
  router.delete('/:id', async (req, res, next) => {
    try {
      await ctx.ipas.delete(req.params.id);
      res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  // Import IPA from URL
  router.post('/import-url', uploadRateLimit, async (req, res, next) => {
    const rawUrl = String(req.body?.url ?? '').trim();
    if (!rawUrl) {
      return res.status(400).json({ ok: false, error: 'url is required' });
    }

    let parsed: URL;
    try {
      parsed = new URL(rawUrl);
    } catch {
      return res.status(400).json({ ok: false, error: 'Invalid URL' });
    }
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return res.status(400).json({ ok: false, error: 'Only http/https URLs are supported' });
    }
    if (parsed.protocol === 'http:' && !isLocalNetworkHost(parsed.hostname)) {
      return res.status(400).json({ ok: false, error: 'HTTP IPA imports are only allowed for local-network hosts' });
    }

    const tempPath = path.join(ctx.uploadDir, `import-${crypto.randomUUID()}.ipa`);

    try {
      await downloadToFileWithLimit(parsed.href, tempPath, {
        contextLabel: 'IPA download',
        timeoutMs: 120_000,
        maxBytes: UI_LIMITS.maxIpaFileSizeBytes,
        errorStatusCode: 400,
      });

      const originalName = path.basename(parsed.pathname || '').toLowerCase().endsWith('.ipa')
        ? path.basename(parsed.pathname)
        : 'Imported.ipa';
      const ipa = await ctx.ipas.processUpload(tempPath, originalName);
      res.json({ ok: true, data: ipa });
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      next(err);
    }
  });

  router.post('/import-path', uploadRateLimit, async (req, res, next) => {
    const rawPath = String(req.body?.path ?? '').trim();
    if (!rawPath) {
      return res.status(400).json({ ok: false, error: 'path is required' });
    }

    const resolvedPath = path.resolve(rawPath);

    // Security: reject paths that traverse above the user's home directory or into system dirs
    const homedir = require('node:os').homedir();
    const forbidden = ['/etc', '/var', '/usr', '/bin', '/sbin', '/System', '/Library', '/private'];
    const isForbidden = forbidden.some(prefix => resolvedPath.startsWith(prefix) && !resolvedPath.startsWith(path.join(homedir, 'Library')));
    if (isForbidden) {
      return res.status(403).json({ ok: false, error: 'Access to system directories is not allowed' });
    }

    const tempPath = path.join(ctx.uploadDir, `import-local-${crypto.randomUUID()}.ipa`);

    try {
      const stat = await fs.stat(resolvedPath);
      if (!stat.isFile()) {
        return res.status(400).json({ ok: false, error: 'Selected path is not a file' });
      }
      if (path.extname(resolvedPath).toLowerCase() !== '.ipa') {
        return res.status(400).json({ ok: false, error: 'Only .ipa files are supported' });
      }
      if (stat.size > UI_LIMITS.maxIpaFileSizeBytes) {
        return res.status(413).json({ ok: false, error: 'Selected IPA exceeds the 4 GB limit' });
      }

      await fs.copyFile(resolvedPath, tempPath);
      const ipa = await ctx.ipas.processUpload(tempPath, path.basename(resolvedPath));
      res.json({ ok: true, data: ipa });
    } catch (err) {
      await fs.unlink(tempPath).catch(() => {});
      next(err);
    }
  });

  return router;
}
