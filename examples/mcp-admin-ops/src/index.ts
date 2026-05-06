import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpAdminOpsExample } from './server.js';

const { server } = createMcpAdminOpsExample();
await server.connect(new StdioServerTransport());
