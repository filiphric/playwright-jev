import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { mkdir, writeFile } from 'node:fs/promises';
import pino from 'pino';

export const root = fileURLToPath(new URL('../../', import.meta.url));
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' }, process.stderr);
export const runFile = promisify(execFile);
export const now = () => performance.now();
export function browserEnv(): Record<string, string> {
  const keys = ['PATH', 'HOME', 'TMPDIR', 'DISPLAY', 'PLAYWRIGHT_BROWSERS_PATH', 'PWTEST_DAEMON_SESSION_DIR'];
  return { ...Object.fromEntries(keys.flatMap(key => process.env[key] ? [[key, process.env[key]!]] : [])), CI: '1', NO_UPDATE_NOTIFIER: '1' };
}
export async function saveJson(path: string, data: unknown) {
  await writeFile(path, JSON.stringify(data, null, 2) + '\n');
}
export async function prepareDirectory(path: string) { await mkdir(path, { recursive: true }); }
export function loadEnv() {
  try { process.loadEnvFile(`${root}/.env`); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}
export async function jsonFetch(url: string, init: RequestInit = {}): Promise<unknown> {
  const response = await fetch(url, { ...init, headers: { Accept: 'application/json', ...init.headers }, signal: init.signal ?? AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`HTTP ${response.status} from ${new URL(url).host}`);
  return response.status === 204 ? null : response.json();
}
