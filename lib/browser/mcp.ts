import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { CallToolResultSchema } from '@modelcontextprotocol/sdk/types.js';
import { resolve, sep, basename } from 'node:path';
import { readFile, realpath } from 'node:fs/promises';
import { root, browserEnv } from '../shared/runtime.ts';
export class PlaywrightMcp {
  readonly client = new Client({ name: 'playwright-jev-comparison', version: '0.1.0' });
  transport?: StdioClientTransport;
  calls = 0;
  constructor(readonly directory: string) {}
  async connect() {
    this.transport = new StdioClientTransport({ command: process.execPath,
      args: [resolve(root, 'node_modules/@playwright/mcp/cli.js'), '--headless', '--isolated', '--browser', 'chrome', '--viewport-size', '1120x780', '--caps', 'devtools', '--image-responses', 'omit', '--output-dir', this.directory, '--timeout-action', '3000', '--timeout-navigation', '15000', '--timeout-settle', '50'],
      cwd: root, stderr: 'pipe', env: browserEnv(),
    });
    this.transport.stderr?.on('data', () => {});
    await this.client.connect(this.transport, { timeout: 30_000 });
  }
  async tool(name: string, args: Record<string, unknown> = {}) {
    this.calls++;
    const result = CallToolResultSchema.parse(await this.client.callTool({ name, arguments: args }, undefined, { timeout: 30_000 }));
    // Current MCP emits some post-action snapshots as local attachments. Give the
    // model their contents, without requiring an extra model/browser round trip.
    const blocks = Array.isArray(result.content) ? [...result.content] : [];
    for (const block of [...blocks]) {
      if (block.type !== 'text' || typeof block.text !== 'string') continue;
      for (const match of block.text.matchAll(/\[Snapshot\]\(([^)\r\n]+)\)/g)) {
        const path = resolve(root, match[1]);
        if (!path.startsWith(resolve(this.directory) + sep) || !/^page-[\dTZ.-]+\.yml$/.test(basename(path))) continue;
        const actual = await realpath(path);
        if (!actual.startsWith(await realpath(this.directory) + sep)) throw new Error('Snapshot attachment escaped the output directory');
        blocks.push({ type: 'text', text: `Attached browser snapshot:\n${await readFile(actual, 'utf8')}` });
      }
    }
    return { ...result, content: blocks };
  }
  async checkedTool(name: string, args: Record<string, unknown> = {}) {
    const result = await this.tool(name, args);
    if (result.isError) throw new Error(`MCP ${name} failed: ${JSON.stringify(result.content).slice(0, 1500)}`);
    return result;
  }
  async startVideo(path: string) { await this.checkedTool('browser_start_video', { filename: path, size: { width: 1120, height: 780 }, fps: 25, cursor: false }); }
  async stopVideo() { await this.checkedTool('browser_stop_video'); }
  async close() { try { await this.checkedTool('browser_close'); } finally { await this.client.close(); } }
}
