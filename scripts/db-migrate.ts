import path from 'node:path';
import { Database } from '../src/server/state/database';
import { createEncryptionProvider, deriveEncryptionKey } from '../src/server/utils/crypto';

const dbPath = process.env.SIDELINK_DB_PATH || path.resolve(process.cwd(), 'tmp/sidelink.sqlite');

const encryption = createEncryptionProvider(deriveEncryptionKey());
const db = new Database(dbPath, encryption);
db.close();

console.log(`Migrations applied: ${dbPath}`);
