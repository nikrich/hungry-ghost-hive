// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { Server } from 'http';
import { WebSocketServer, type WebSocket } from 'ws';
import type { WebSocketEvent } from './events.js';

export class WebSocketManager {
  private wss: WebSocketServer;
  private clients = new Set<WebSocket>();

  constructor(server: Server, authToken?: string) {
    this.wss = new WebSocketServer({ noServer: true });

    server.on('upgrade', (req, socket, head) => {
      // Auth check for WebSocket upgrade
      if (authToken) {
        const url = new URL(req.url || '/', `http://${req.headers.host}`);
        const token = url.searchParams.get('token');
        if (token !== authToken) {
          socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
          socket.destroy();
          return;
        }
      }

      this.wss.handleUpgrade(req, socket, head, ws => {
        this.wss.emit('connection', ws, req);
      });
    });

    this.wss.on('connection', (ws: WebSocket) => {
      this.clients.add(ws);
      ws.on('close', () => {
        this.clients.delete(ws);
      });
      ws.on('error', () => {
        this.clients.delete(ws);
      });
    });
  }

  broadcast(event: WebSocketEvent): void {
    const msg = JSON.stringify(event);
    for (const client of this.clients) {
      if (client.readyState === 1) {
        // OPEN
        client.send(msg);
      }
    }
  }

  get clientCount(): number {
    return this.clients.size;
  }

  closeAll(): void {
    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();
    this.wss.close();
  }
}
