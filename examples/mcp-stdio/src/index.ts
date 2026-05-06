import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpStdioExampleServer } from './server.js';

const server = createMcpStdioExampleServer();
await server.connect(new StdioServerTransport());
