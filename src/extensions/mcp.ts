import type { ToolDefinition, Args, ToolResult } from '../types.js';
import { serverSpec, type ServerSpec } from './mcp-config.js';
import { withServer } from './mcp-transport.js';
import { digest } from './skills.js';

export interface McpTool {
  server: string;
  name: string;
  definition: ToolDefinition;
  specHash: string;
}

export async function discoverMcp(
  server: string,
  spec: ServerSpec,
  data?: string,
): Promise<McpTool[]> {
  return withServer(spec, data, async (peer) => {
    const found: McpTool[] = [];
    let cursor: unknown;
    for (let page = 0; page < 8; page++) {
      const result = await peer.request('tools/list', cursor ? { cursor } : {});
      if (!Array.isArray(result.tools)) throw new Error('Invalid MCP tools/list');
      for (const tool of result.tools) {
        if (!spec.readOnlyTools.includes(tool.name)) continue;
        const name = 'mcp_' + server + '_' + tool.name;
        if (
          !/^[\w-]{1,64}$/.test(name) ||
          tool.inputSchema?.type !== 'object' ||
          found.some((t) => t.name === tool.name)
        )
          throw new Error('Unsupported or duplicate MCP tool: ' + name);
        found.push({
          server,
          name: tool.name,
          specHash: digest(JSON.stringify(spec)),
          definition: {
            type: 'function',
            function: {
              name,
              description: String(tool.description ?? tool.name),
              parameters: tool.inputSchema,
            },
          },
        });
      }
      cursor = result.nextCursor;
      if (!cursor) return found;
    }
    throw new Error('MCP listing exceeds 8 pages');
  });
}

export async function callMcp(
  tool: McpTool,
  args: Args,
  configFile: string,
  data?: string,
): Promise<ToolResult> {
  const spec = serverSpec(configFile, tool.server);
  if (!spec.readOnlyTools.includes(tool.name) || digest(JSON.stringify(spec)) !== tool.specHash)
    throw new Error('MCP tool denied by current server policy');
  return withServer(spec, data, async (peer) => {
    const response = await peer.request('tools/call', { name: tool.name, arguments: args });
    if (!Array.isArray(response.content)) throw new Error('Invalid MCP tool content');
    const text = response.content
      .map((item) => {
        if (item?.type !== 'text' || typeof item.text !== 'string')
          throw new Error('Only MCP text responses are supported');
        return item.text;
      })
      .join('\n');
    return response.isError ? { ok: false, error: text } : { ok: true, content: text };
  });
}
