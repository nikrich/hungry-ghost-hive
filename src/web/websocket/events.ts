// Licensed under the Hungry Ghost Hive License. See LICENSE.

export type WebSocketEventType =
  | 'state:full'
  | 'agents:update'
  | 'stories:update'
  | 'pipeline:update'
  | 'escalations:update'
  | 'logs:new'
  | 'merge-queue:update'
  | 'requirements:update';

export interface WebSocketEvent {
  type: WebSocketEventType;
  data: unknown;
}
