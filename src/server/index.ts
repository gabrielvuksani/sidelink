// ─── Server Entry Point ──────────────────────────────────────────────
// Bootstrap the HTTP server, start background services, handle shutdown.

import { createAppContextAsync } from './context';
import { createApp } from './app';
import { recoverStalledJobs } from './pipeline';
import { closeAllSSE } from './routes';
import { getDefaultDataDir, getPlatformDisplayName } from './utils/paths';
import { DEFAULTS } from '../shared/constants';
import * as net from 'node:net';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startDiscoveryBroadcaster } from './utils/discovery';

const PREFERRED_PORT = parseInt(process.env.SIDELINK_PORT ?? process.env.PORT ?? String(DEFAULTS.port), 10);
const HOST = process.env.SIDELINK_HOST ?? process.env.HOST ?? '0.0.0.0';
const MAX_PORT_ATTEMPTS = 20;

if (Number.isNaN(PREFERRED_PORT) || PREFERRED_PORT < 1 || PREFERRED_PORT > 65535) {
  console.error(`Invalid port: ${process.env.SIDELINK_PORT ?? process.env.PORT}`);
  process.exit(1);
}

/**
 * Check if a port is available by attempting to listen on it briefly.
 */
function isPortFree(port: number, host: string): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.once('error', () => resolve(false));
    srv.listen(port, host, () => {
      srv.close(() => resolve(true));
    });
  });
}

/**
 * Find the first free port starting from `start`, trying up to `maxAttempts` ports.
 */
async function findFreePort(start: number, host: string, maxAttempts: number): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = start + i;
    if (port > 65535) break;
    if (await isPortFree(port, host)) return port;
    console.log(`  Port ${port} is in use, trying ${port + 1}...`);
  }
  throw new Error(`No free port found in range ${start}–${start + maxAttempts - 1}`);
}

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
  process.exit(1);
});

// ── Startup housekeeping ─────────────────────────────────────────────

/**
 * Remove stale signing temp directories left by unclean shutdowns.
 * Directories are named `sidelink-sign-*` in os.tmpdir().
 */
function purgeStaleSigningDirs(): number {
  const tmpBase = os.tmpdir();
  let removed = 0;
  try {
    const entries = fs.readdirSync(tmpBase, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name.startsWith('sidelink-sign-')) {
        try {
          fs.rmSync(path.join(tmpBase, entry.name), { recursive: true, force: true });
          removed++;
        } catch { /* best-effort */ }
      }
    }
  } catch { /* tmpdir listing failed — ignore */ }
  return removed;
}

async function main() {
  console.log('─── Sidelink Server ───────────────────────────────');
  console.log(`  Platform: ${getPlatformDisplayName()}`);

  // Clean up stale signing temp dirs from prior runs
  const purged = purgeStaleSigningDirs();
  if (purged > 0) {
    console.log(`  Purged ${purged} stale signing temp dir(s)`);
  }

  // Create context (DI container) — async for keychain-backed encryption
  const ctx = await createAppContextAsync({
    dataDir: process.env.SIDELINK_DATA_DIR ?? process.env.DATA_DIR,
    uploadDir: process.env.SIDELINK_UPLOAD_DIR ?? process.env.UPLOAD_DIR,
    // Legacy encryption key override (if user explicitly sets it)
    encryptionSecret: process.env.SIDELINK_ENCRYPTION_KEY ?? process.env.ENCRYPTION_SECRET ?? undefined,
  });

  // Recover any jobs that were interrupted by a restart
  const recovered = recoverStalledJobs(ctx.db, ctx.logs);
  if (recovered > 0) {
    console.log(`  Recovered ${recovered} stalled job(s)`);
  }

  // Start background services
  ctx.devices.startPolling();
  ctx.scheduler.start();

  // Create Express app
  const app = createApp(ctx);

  // Find a free port
  const PORT = await findFreePort(PREFERRED_PORT, HOST, MAX_PORT_ATTEMPTS);

  // Track open connections for graceful drain
  const connections = new Set<net.Socket>();

  // Start HTTP server
  let stopDiscovery: (() => void) | undefined;
  const server = app.listen(PORT, HOST, () => {
    if (PORT !== PREFERRED_PORT) {
      console.log(`  Preferred port ${PREFERRED_PORT} was busy → using ${PORT}`);
    }
    console.log(`  Server listening on http://${HOST}:${PORT}`);
    console.log(`  Data directory: ${ctx.dataDir}`);
    console.log('──────────────────────────────────────────────────');

    stopDiscovery = startDiscoveryBroadcaster({
      name: `Sidelink (${os.hostname()})`,
      port: PORT,
    });
  });

  server.on('connection', (socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
  });

  // Graceful shutdown with connection draining
  let shuttingDown = false;

  const shutdown = () => {
    if (shuttingDown) {
      // Second signal → force exit immediately
      console.log('Forced exit.');
      process.exit(1);
    }
    shuttingDown = true;
    console.log('\nShutting down gracefully...');

    // Close all SSE connections cleanly before stopping the server
    closeAllSSE();
    stopDiscovery?.();

    // Stop accepting new connections; finish in-flight requests
    server.close(() => {
      ctx.shutdown();
      // Final temp dir cleanup
      purgeStaleSigningDirs();
      console.log('Goodbye.');
      process.exit(0);
    });

    // Destroy idle keep-alive connections so server.close() can finish
    for (const socket of connections) {
      // If the socket has no outstanding response, destroy it now.
      // Active responses will finish naturally, then the socket closes.
      if (!socket.writableLength) {
        socket.destroy();
      }
    }

    // Force exit after 8 seconds if drain hasn't completed
    setTimeout(() => {
      console.error('Shutdown timed out — forcing exit.');
      process.exit(1);
    }, 8_000).unref();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
