import { createPrismaAdminOpsExampleApp } from './app.js';

const port = Number(process.env.PORT ?? 3004);
const { app } = await createPrismaAdminOpsExampleApp({
  databaseUrl: process.env.DATABASE_URL,
});

await app.listen(port);
console.log(`NestJS Prisma approval ops example listening on http://localhost:${port}`);
