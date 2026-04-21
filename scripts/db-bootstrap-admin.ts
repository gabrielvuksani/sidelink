import path from 'node:path';
import { Database } from '../src/server/state/database';
import { createEncryptionProvider, deriveEncryptionKey } from '../src/server/utils/crypto';
import { LogService } from '../src/server/services/log-service';
import { AuthService } from '../src/server/services/auth-service';

const dbPath = process.env.SIDELINK_DB_PATH || path.resolve(process.cwd(), 'tmp/sidelink.sqlite');
const requireEnv = process.argv.includes('--require-env');

const encryption = createEncryptionProvider(deriveEncryptionKey());
const db = new Database(dbPath, encryption);
const logs = new LogService(db);
const auth = new AuthService(db, logs);

const username = process.env.SIDELINK_ADMIN_USERNAME || process.env.SIDELINK_ADMIN_USER || 'admin';
const rawPassword = process.env.SIDELINK_ADMIN_PASSWORD || process.env.SIDELINK_ADMIN_PASS;
const resetOnBoot = process.env.SIDELINK_ADMIN_RESET_ON_BOOT === '1';

if (requireEnv && !rawPassword) {
  console.error('Set SIDELINK_ADMIN_PASSWORD environment variable (--require-env mode)');
  db.close();
  process.exit(1);
}

if (!rawPassword) {
  console.error('Set SIDELINK_ADMIN_PASSWORD environment variable');
  db.close();
  process.exit(1);
}

const password: string = rawPassword;

async function bootstrap() {
  // If reset-on-boot is requested, delete existing admin user first
  if (resetOnBoot && auth.isSetupComplete()) {
    db.prepare('DELETE FROM sessions').run();
    db.prepare('DELETE FROM auth_attempts').run();
    db.prepare('DELETE FROM users WHERE role = ?').run('admin');
    console.log('  Reset existing admin user (SIDELINK_ADMIN_RESET_ON_BOOT=1)');
  }

  if (auth.isSetupComplete()) {
    console.log(`Admin already exists — skipping bootstrap: ${dbPath}`);
    db.close();
    return;
  }

  await auth.setupAdmin(username, password);
  db.close();
  console.log(`Admin bootstrap complete: ${dbPath}`);
}

bootstrap().catch(err => {
  console.error('Failed to bootstrap admin:', err);
  db.close();
  process.exit(1);
});
