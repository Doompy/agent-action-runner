import { createNestAdminOpsExampleApp } from './app.js';

const port = Number(process.env.PORT ?? 3001);
const { app } = await createNestAdminOpsExampleApp();

await app.listen(port);
console.log(`NestJS admin ops example listening on http://localhost:${port}`);
