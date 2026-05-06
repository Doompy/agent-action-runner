import { createFastifyAdminOpsExampleApp } from './app.js';

const port = Number(process.env.PORT ?? 3002);
const { app } = await createFastifyAdminOpsExampleApp();

await app.listen({ port });
console.log(`Fastify admin ops example listening on http://localhost:${port}`);
