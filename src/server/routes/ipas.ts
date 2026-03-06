// ─── IPA Routes ──────────────────────────────────────────────────────
// POST /api/ipas/upload  — upload an IPA
// GET  /api/ipas         — list uploaded IPAs
// GET  /api/ipas/:id     — get IPA details
// DELETE /api/ipas/:id   — delete an IPA

import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import crypto from 'node:crypto';
import type { AppContext } from '../context';
import { UI_LIMITS } from '../../shared/constants';

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
  router.post('/upload', upload.single('ipa'), async (req, res, next) => {
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
  router.post('/import-url', async (req, res, next) => {
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

    const tempPath = path.join(ctx.uploadDir, `import-${crypto.randomUUID()}.ipa`);

    try {
      const upstream = await fetch(parsed.href);
      if (!upstream.ok || !upstream.body) {
        return res.status(400).json({ ok: false, error: `Failed to download IPA (${upstream.status})` });
      }

      await pipeline(Readable.fromWeb(upstream.body as any), createWriteStream(tempPath));

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

  return router;
}
