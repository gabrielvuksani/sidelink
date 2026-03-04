import path from 'node:path';
import { AppStore } from '../src/server/state/store';
import { readEnv } from '../src/server/utils/env';

const dbPath = readEnv('SIDELINK_DB_PATH', 'ALTSTORE_DB_PATH') || path.resolve(process.cwd(), 'tmp/sidelink.sqlite');

const store = new AppStore('demo', { dbPath });
store.close();

// eslint-disable-next-line no-console
console.log(`Migrations applied: ${dbPath}`);
