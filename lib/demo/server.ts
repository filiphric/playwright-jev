import { spawn, type ChildProcess } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { resolve } from 'node:path';
import { createServer } from 'node:net';
import { root, logger } from '../shared/runtime.ts';
const log = logger.child({ module: 'demo' });
export class DemoServer {
  child?: ChildProcess;
  private originalDatabase?: Buffer;
  readonly url: string;
  constructor(readonly port = 3100, readonly apiPort = 3101) { this.url = `http://127.0.0.1:${port}`; }
  async start() {
    // Refuse occupied ports before any reset can reach an unrelated local app.
    await Promise.all([this.port, this.apiPort].map(port => new Promise<void>((resolvePort, reject) => {
      const probe = createServer(); probe.once('error', reject);
      probe.listen(port, '127.0.0.1', () => probe.close(error => error ? reject(error) : resolvePort()));
    })));
    this.originalDatabase = await readFile(resolve(root, 'demo/backend/data/database.json'));
    this.child = spawn(process.execPath, [resolve(root, 'demo/node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(this.port), '--strictPort'], {
      cwd: resolve(root, 'demo'), env: { ...process.env, APP: String(this.port), SERVER: String(this.apiPort) }, stdio: ['ignore', 'pipe', 'pipe'],
    });
    let errors = '';
    this.child.stderr?.on('data', data => { errors += String(data); });
    this.child.stdout?.resume();
    try {
      const deadline = performance.now() + 30_000;
      while (performance.now() < deadline) {
        if (this.child.exitCode !== null) throw new Error(`Demo server exited: ${errors.slice(-2000)}`);
        try {
          const response = await fetch(`${this.url}/api/boards`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(1000) });
          if (response.ok && response.headers.get('content-type')?.includes('application/json')) { log.info({ url: this.url }, 'Production demo ready'); return; }
        } catch { /* readiness polling */ }
        await delay(100);
      }
      throw new Error(`Demo did not start: ${errors.slice(-2000)}`);
    } catch (error) { await this.close(); throw error; }
  }
  async close() {
    const child = this.child; this.child = undefined;
    if (child && child.exitCode === null && child.signalCode === null) {
      await new Promise<void>(resolveClose => {
        const timer = setTimeout(() => child.kill('SIGKILL'), 3000);
        child.once('exit', () => { clearTimeout(timer); resolveClose(); });
        child.kill('SIGTERM');
      });
    }
    if (this.originalDatabase) { await writeFile(resolve(root, 'demo/backend/data/database.json'), this.originalDatabase); this.originalDatabase = undefined; }
  }
}
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const server = new DemoServer();
  await server.start();
  for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, () => { void server.close().then(() => process.exit()); });
}
