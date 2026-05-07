import { createDeliveryOpsExampleApp } from './app.js';

const port = Number(process.env.PORT ?? 3004);
const { app } = createDeliveryOpsExampleApp();

app.listen(port, () => {
  console.log(`Delivery ops example listening on http://localhost:${port}`);
});
