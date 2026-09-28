import { readFile, realpath } from 'node:fs/promises';
import { basename, resolve, sep } from 'node:path';
import { z } from 'zod';
import { PlaywrightCli } from './cli.ts';
import { root } from '../shared/runtime.ts';

const ref = z.string().regex(/^e\d+$/, 'Use an element ref from the current snapshot');
const text = z.string().min(1).max(2000);
const definitions = {
  cli_snapshot: { description: 'Read the current native Playwright CLI accessibility snapshot and element refs.', command: 'snapshot', schema: z.object({}).strict() },
  cli_click: { description: 'Click an observed element ref using playwright-cli click.', command: 'click', schema: z.object({ target: ref }).strict() },
  cli_fill: { description: 'Fill an observed editable field with text using playwright-cli fill. Set submit=true to press Enter after filling when appropriate; otherwise filling does not submit.', command: 'fill', schema: z.object({ target: ref, text, submit: z.boolean().optional() }).strict() },
  cli_press: { description: 'Press a key in the currently focused element, for example Enter.', command: 'press', schema: z.object({ key: z.string().min(1).max(80).regex(/^[A-Za-z0-9+]+$/) }).strict() },
  cli_select: { description: 'Select an option value in an observed dropdown.', command: 'select', schema: z.object({ target: ref, value: text }).strict() },
  cli_hover: { description: 'Hover over an observed element.', command: 'hover', schema: z.object({ target: ref }).strict() },
  cli_scroll: { description: 'Scroll the page using playwright-cli mousewheel.', command: 'mousewheel', schema: z.object({ dx: z.number().int().min(-2000).max(2000), dy: z.number().int().min(-2000).max(2000) }).strict() },
};
export const nativeCliTools = Object.entries(definitions).map(([name, definition]) => ({
  type: 'function', name, description: definition.description,
  parameters: {
    type: 'object', additionalProperties: false,
    properties: Object.fromEntries(Object.entries(definition.schema.shape).map(([key, field]) => [key, {
      type: key === 'submit' ? 'boolean' : field instanceof z.ZodNumber ? 'integer' : 'string',
      ...(key === 'target' ? { description: 'Exact ref from the current snapshot, such as e16.' } : {}),
    }])),
    required: Object.entries(definition.schema.shape).filter(([, field]) => !field.isOptional()).map(([key]) => key),
  }, strict: false,
}));
export function nativeCommand(name: string, raw: unknown): string[] {
  if (!Object.hasOwn(definitions, name)) throw new Error('Unoffered CLI tool');
  const definition = definitions[name as keyof typeof definitions];
  const args = definition.schema.parse(raw) as Record<string, string | number | boolean | undefined>;
  // execFile receives argv directly: model arguments never become shell code.
  return [definition.command, ...Object.keys(definition.schema.shape).filter(key => key !== 'submit').map(key => String(args[key])), ...(args.submit ? ['--submit'] : [])];
}
export class NativePlaywrightCli extends PlaywrightCli {
  override async open(url: string) { await super.open(url, 'full'); }
  async native(args: string[]): Promise<string> {
    const output = await this.command(args, false);
    const snapshots: string[] = [];
    for (const match of output.matchAll(/\[Snapshot\]\(([^)\r\n]+)\)/g)) {
      const path = resolve(root, match[1]);
      if (!path.startsWith(resolve(this.directory) + sep) || !/^page-[\dTZ.-]+\.yml$/.test(basename(path))) continue;
      const actual = await realpath(path);
      if (!actual.startsWith(await realpath(this.directory) + sep)) throw new Error('Snapshot attachment escaped the output directory');
      snapshots.push(await readFile(actual, 'utf8'));
    }
    return [output, ...snapshots.map(snapshot => `Attached browser snapshot:\n${snapshot}`)].join('\n\n');
  }
  async tool(name: string, args: unknown) { return this.native(nativeCommand(name, args)); }
}
