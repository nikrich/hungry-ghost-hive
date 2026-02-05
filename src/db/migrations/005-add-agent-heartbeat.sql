-- Migration 005: Add agent heartbeat mechanism
-- Adds last_seen column to track agent liveness

ALTER TABLE agents ADD COLUMN last_seen TIMESTAMP;
