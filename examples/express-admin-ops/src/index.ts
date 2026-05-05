import { createAdminOpsExampleApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const { app } = createAdminOpsExampleApp();

app.listen(port, () => {
  console.log(`Admin ops example listening on http://localhost:${port}`);
});
