import { createPersistentAdminOpsExampleApp } from './app.js';

const port = Number(process.env.PORT ?? 3003);
const { app, dataDir } = createPersistentAdminOpsExampleApp({
  dataDir: process.env.AGENT_RUNNER_DATA_DIR,
});

app.listen(port, () => {
  console.log(`Persistent admin ops example listening on http://localhost:${port}`);
  console.log(`Persistent example data directory: ${dataDir}`);
});
