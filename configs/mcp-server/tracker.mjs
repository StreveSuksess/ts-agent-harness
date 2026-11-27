// Read-only MCP stdio server. The host supplies a frozen snapshot, never a path.
import { createInterface } from 'node:readline';

const data = JSON.parse(process.env.TRACKER_DATA ?? '[]');
const tools = [
  {
    name: 'list',
    description: 'Read the current tracker snapshot with task IDs, statuses and owners.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];
for await (const line of createInterface({ input: process.stdin })) {
  const request = JSON.parse(line);
  if (request.id === undefined) continue;
  const response = { jsonrpc: '2.0', id: request.id };
  switch (request.method) {
    case 'initialize':
      response.result = {
        protocolVersion: '2025-03-26',
        serverInfo: { name: 'study-tracker', version: '1.0.0' },
        capabilities: { tools: {} },
      };
      break;
    case 'tools/list':
      response.result = { tools };
      break;
    case 'tools/call':
      if (request.params?.name !== 'list' || Object.keys(request.params?.arguments ?? {}).length) {
        response.error = { code: -32602, message: 'Unknown tool or unexpected arguments' };
      } else {
        response.result = {
          isError: Boolean(data.error),
          content: [{ type: 'text', text: data.error ?? JSON.stringify(data.tasks ?? data) }],
        };
      }
      break;
    default:
      response.error = { code: -32601, message: 'Method not found' };
  }
  process.stdout.write(JSON.stringify(response) + '\n');
}
