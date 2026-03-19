// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { nanoid } from 'nanoid';
import type { DatabaseProvider } from '../provider.js';

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

export function createSyncRecord(
  db: DatabaseProvider,
  input: CreateSyncRecordInput
): IntegrationSyncRow {
  const id = `SYNC-${nanoid(8).toUpperCase()}`;
  const now = new Date().toISOString();

  db.run(
    `
    INSERT INTO integration_sync (id, entity_type, entity_id, provider, external_id, last_synced_at, sync_status, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'synced', ?, ?)
  `,
    [id, input.entityType, input.entityId, input.provider, input.externalId, now, now, now]
  );

  return getSyncRecordById(db, id)!;
}

export function getSyncRecordById(
  db: DatabaseProvider,
  id: string
): IntegrationSyncRow | undefined {
  return db.queryOne<IntegrationSyncRow>('SELECT * FROM integration_sync WHERE id = ?', [id]);
}

export function getSyncRecordByEntity(
  db: DatabaseProvider,
  entityType: SyncEntityType,
  entityId: string,
  provider: SyncProvider
): IntegrationSyncRow | undefined {
  return db.queryOne<IntegrationSyncRow>(
    'SELECT * FROM integration_sync WHERE entity_type = ? AND entity_id = ? AND provider = ?',
    [entityType, entityId, provider]
  );
}

export function updateSyncStatus(
  db: DatabaseProvider,
  id: string,
  status: SyncStatus,
  errorMessage?: string | null
): void {
  const now = new Date().toISOString();
  db.run(
    `
    UPDATE integration_sync
    SET sync_status = ?, error_message = ?, last_synced_at = ?, updated_at = ?
    WHERE id = ?
  `,
    [status, errorMessage || null, now, now, id]
  );
}

export function getSyncRecordsByProvider(
  db: DatabaseProvider,
  provider: SyncProvider
): IntegrationSyncRow[] {
  return db.queryAll<IntegrationSyncRow>(
    'SELECT * FROM integration_sync WHERE provider = ? ORDER BY created_at DESC',
    [provider]
  );
}

export function getFailedSyncRecords(db: DatabaseProvider): IntegrationSyncRow[] {
  return db.queryAll<IntegrationSyncRow>(
    "SELECT * FROM integration_sync WHERE sync_status = 'failed' ORDER BY created_at DESC"
  );
}
