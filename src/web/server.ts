// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { statSync } from 'fs';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import { join } from 'path';
import type { WebConfig } from '../config/schema.js';
import { getReadOnlyDatabase, type ReadOnlyDatabaseClient } from '../db/client.js';
import { authorize } from './auth.js';
import { renderDashboardHtml } from './frontend/index.js';
import { registerAgentRoutes } from './handlers/agents.js';
import { registerEscalationRoutes } from './handlers/escalations.js';
import { registerLogRoutes } from './handlers/logs.js';
import { registerPipelineRoutes } from './handlers/pipeline.js';
import { registerPullRequestRoutes } from './handlers/pull-requests.js';
import { registerRequirementRoutes } from './handlers/requirements.js';
import { registerStoryRoutes } from './handlers/stories.js';
import { registerSystemRoutes } from './handlers/system.js';
import { registerTeamRoutes } from './handlers/teams.js';
import { Router, parseQuery } from './router.js';
import { WebSocketManager } from './websocket/manager.js';

export class WebDashboardServer {
  private server: Server | null = null;
  private router: Router;
  private wsManager: WebSocketManager | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastDbMtime = 0;
  private boundPort = 0;

  constructor(
    private readonly config: WebConfig,
    private readonly hiveDir: string,
    private readonly rootDir?: string
  ) {
    this.router = new Router();
    this.registerRoutes();
  }

  private registerRoutes(): void {
    registerAgentRoutes(this.router, this.hiveDir);
    registerStoryRoutes(this.router, this.hiveDir);
    registerPipelineRoutes(this.router, this.hiveDir);
    registerRequirementRoutes(this.router, this.hiveDir);
    registerEscalationRoutes(this.router, this.hiveDir);
    registerPullRequestRoutes(this.router, this.hiveDir);
    registerLogRoutes(this.router, this.hiveDir);
    registerTeamRoutes(this.router, this.hiveDir);
    if (this.rootDir) {
      registerSystemRoutes(this.router, this.hiveDir, this.rootDir);
    }
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      void this.handleRequest(req, res);
    });

    this.wsManager = new WebSocketManager(this.server, this.config.auth_token);

    await new Promise<void>((resolve, reject) => {
      if (!this.server) return reject(new Error('Web server not initialized'));
      this.server.once('error', reject);
      this.server.listen(this.config.port, this.config.host, () => {
        this.server?.removeListener('error', reject);
        const addr = this.server?.address();
        if (addr && typeof addr === 'object') {
          this.boundPort = addr.port;
        }
        resolve();
      });
    });

    // Start DB mtime polling for WebSocket broadcasts
    this.startPolling();
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.wsManager) {
      this.wsManager.closeAll();
      this.wsManager = null;
    }
    if (this.server) {
      await new Promise<void>(resolve => {
        this.server?.close(() => resolve());
      });
      this.server = null;
    }
  }

  get url(): string {
    const port = this.boundPort || this.config.port;
    return `http://${this.config.host}:${port}`;
  }

  private startPolling(): void {
    this.pollTimer = setInterval(() => {
      void this.checkForUpdates();
    }, this.config.refresh_interval_ms);
  }

  private async checkForUpdates(): Promise<void> {
    if (!this.wsManager || this.wsManager.clientCount === 0) return;

    const dbPath = join(this.hiveDir, 'hive.db');
    try {
      const stat = statSync(dbPath);
      const mtime = stat.mtimeMs;
      if (mtime <= this.lastDbMtime) return;
      this.lastDbMtime = mtime;
    } catch {
      return;
    }

    let db: ReadOnlyDatabaseClient | null = null;
    try {
      db = await getReadOnlyDatabase(this.hiveDir);

      // Import query functions dynamically to avoid circular deps
      const [agentsMod, storiesMod, escalationsMod, logsMod, prMod, reqMod] = await Promise.all([
        import('../db/queries/agents.js'),
        import('../db/queries/stories.js'),
        import('../db/queries/escalations.js'),
        import('../db/queries/logs.js'),
        import('../db/queries/pull-requests.js'),
        import('../db/queries/requirements.js'),
      ]);

      this.wsManager.broadcast({
        type: 'agents:update',
        data: agentsMod.getActiveAgents(db.db),
      });
      this.wsManager.broadcast({
        type: 'stories:update',
        data: storiesMod.getAllStories(db.db),
      });
      this.wsManager.broadcast({
        type: 'pipeline:update',
        data: storiesMod.getStoryCounts(db.db),
      });
      this.wsManager.broadcast({
        type: 'escalations:update',
        data: escalationsMod.getPendingEscalations(db.db),
      });
      this.wsManager.broadcast({
        type: 'logs:new',
        data: logsMod.getRecentLogs(db.db, 50),
      });
      this.wsManager.broadcast({
        type: 'merge-queue:update',
        data: prMod.getPrioritizedMergeQueue(db.db),
      });
      this.wsManager.broadcast({
        type: 'requirements:update',
        data: reqMod.getAllRequirements(db.db),
      });
    } catch {
      // DB may be locked by another process — skip this poll cycle
    } finally {
      db?.close();
    }
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = req.url || '/';
      const pathname = url.split('?')[0];
      const method = req.method || 'GET';

      // CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

      if (method === 'OPTIONS') {
        res.statusCode = 204;
        res.end();
        return;
      }

      // Serve frontend at root
      if (method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        res.end(renderDashboardHtml(this.config));
        return;
      }

      // API routes require auth
      if (pathname.startsWith('/api/')) {
        if (!authorize(req, this.config.auth_token)) {
          sendJson(res, 401, { error: 'Unauthorized' });
          return;
        }

        const query = parseQuery(url);
        const result = this.router.match(method, pathname);
        if (result) {
          await result.handler(req, res, result.params, query);
          return;
        }

        sendJson(res, 404, { error: 'Not found' });
        return;
      }

      // 404 for everything else
      sendJson(res, 404, { error: 'Not found' });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      sendJson(res, 500, { error: message });
    }
  }
}

export function sendJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

export async function readJsonBody(req: IncomingMessage, maxBytes = 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > maxBytes) {
      throw Object.assign(new Error('Payload too large'), { statusCode: 413 });
    }
    chunks.push(buf);
  }

  if (chunks.length === 0) return {};
  const raw = Buffer.concat(chunks).toString('utf-8');
  if (!raw.trim()) return {};

  try {
    return JSON.parse(raw) as unknown;
  } catch {
    throw Object.assign(new Error('Invalid JSON payload'), { statusCode: 400 });
  }
}
