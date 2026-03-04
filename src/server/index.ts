import { buildApp } from './app';
import { readEnv } from './utils/env';

const port = Number(readEnv('SIDELINK_PORT', 'PORT') ?? 4010);
const host = readEnv('SIDELINK_HOST', 'HOST') ?? '127.0.0.1';

const { app, context } = buildApp({
  defaultMode: (readEnv('SIDELINK_MODE', 'ALTSTORE_MODE') === 'real' ? 'real' : 'demo')
});

const server = app.listen(port, host, () => {
  // eslint-disable-next-line no-console
  console.log(`Sidelink running at http://${host}:${port}`);
});

const shutdown = () => {
  context.shutdown();
  server.close(() => {
    process.exit(0);
  });
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
