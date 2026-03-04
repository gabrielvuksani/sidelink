import path from 'node:path';
import { AppStore } from '../src/server/state/store';
import { LogService } from '../src/server/services/log-service';
import { AuthService } from '../src/server/services/auth-service';
import { readEnv, readNumberEnv } from '../src/server/utils/env';

const dbPath = readEnv('SIDELINK_DB_PATH', 'ALTSTORE_DB_PATH') || path.resolve(process.cwd(), 'tmp/sidelink.sqlite');
const requireEnv = process.argv.includes('--require-env');

const store = new AppStore('demo', { dbPath });
const logs = new LogService(store);
const auth = new AuthService(store, logs, {
  cookieName: readEnv('SIDELINK_AUTH_COOKIE_NAME', 'ALTSTORE_AUTH_COOKIE_NAME') || 'sidelink_session',
  sessionTtlHours: readNumberEnv(['SIDELINK_SESSION_TTL_HOURS', 'ALTSTORE_SESSION_TTL_HOURS'], 12)
});

auth.bootstrapAdminFromEnv({ requireExplicitEnv: requireEnv });
store.close();

// eslint-disable-next-line no-console
console.log(`Admin bootstrap complete: ${dbPath}`);
