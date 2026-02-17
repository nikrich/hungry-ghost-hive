// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type Database from 'better-sqlite3';
// @ts-ignore Database.Database type;
import { queryAll, queryOne, run } from '../client.js';

export type SyncEntityType = 'story' | 'requirement' | 'pull_request';
export type SyncProvider = 'jira' | 'github' | 'confluence';
export type SyncStatus = 'pending' | 'synced' | 'failed';

export interface IntegrationSyncRow {
  id: string;
  entity_type: SyncEntityType;
  entity_id: string;
  provider: SyncProvider;
  external_id: string;
  last_synced_at: string | null;
  sync_status: SyncStatus;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateSyncRecordInput {
  entityType: SyncEntityType;
  entityId: string;
  provider: SyncProvider;
  externalId: string;
}

export function createSyncRecord(db: Database.Database, input: CreateSyncRecordInput): IntegrationSyncRow {
  const id = `SYNC-${nanoid(8).toUpperCase()}`;
  const now = new Date().toISOString();

  run(
    db,
    `
    INSERT INTO integration_sync (id, entity_type, entity_id, provider, external_id, last_synced_at, sync_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'synced', ?, ?)
  `,
    [id, input.entityType, input.entityId, input.provider, input.externalId, now, now, now]
  );

  return getSyncRecordById(db, id)!;
}

export function getSyncRecordById(db: Database.Database, id: string): IntegrationSyncRow | undefined {
  return queryOne<IntegrationSyncRow>(db, 'SELECT * FROM integration_sync WHERE id = ?', [id]);
}

export function getSyncRecordByEntity(
  db: Database.Database,
  entityType: SyncEntityType,
  entityId: string,
  provider: SyncProvider
): IntegrationSyncRow | undefined {
  return queryOne<IntegrationSyncRow>(
    db,
    'SELECT * FROM integration_sync WHERE entity_type = ? AND entity_id = ? AND provider = ?',
    [entityType, entityId, provider]
  );
}

export function updateSyncStatus(
  db: Database.Database,
  id: string,
  status: SyncStatus,
  errorMessage?: string | null
): void {
  const now = new Date().toISOString();
  run(
    db,
    `
    UPDATE integration_sync
    SET sync_status = ?, error_message = ?, last_synced_at = ?, updated_at = ?
    WHERE id = ?
  `,
    [status, errorMessage || null, now, now, id]
  );
}

export function getSyncRecordsByProvider(
  db: Database.Database,
  provider: SyncProvider
): IntegrationSyncRow[] {
  return queryAll<IntegrationSyncRow>(
    db,
    'SELECT * FROM integration_sync WHERE provider = ? ORDER BY created_at DESC',
    [provider]
  );
}

export function getFailedSyncRecords(db: Database.Database): IntegrationSyncRow[] {
  return queryAll<IntegrationSyncRow>(
    db,
    "SELECT * FROM integration_sync WHERE sync_status = 'failed' ORDER BY created_at DESC"
  );
}
