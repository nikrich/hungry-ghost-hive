// Licensed under the Hungry Ghost Hive License. See LICENSE.

import { describe, expect, it } from 'vitest';
import { isTechLeadRestartOnCooldown } from './restart-cooldown.js';

const HOUR_MS = 60 * 60 * 1000;

describe('isTechLeadRestartOnCooldown', () => {
  it('returns onCooldown=false when no previous restart exists', () => {
    const result = isTechLeadRestartOnCooldown(undefined, Date.now(), 4);
    expect(result.onCooldown).toBe(false);
    expect(result.remainingMs).toBe(0);
  });

  it('returns onCooldown=true when last restart was within cooldown period', () => {
    const now = Date.now();
    const lastRestartAt = now - 30 * 60 * 1000; // 30 minutes ago
    const result = isTechLeadRestartOnCooldown(lastRestartAt, now, 4);
    // cooldownHours = max(4/2, 1) = 2h; elapsed 30m < 2h → on cooldown
    expect(result.onCooldown).toBe(true);
    expect(result.cooldownHours).toBe(2);
    expect(result.remainingMs).toBeGreaterThan(0);
    expect(result.remainingMs).toBeLessThanOrEqual(2 * HOUR_MS);
  });

  it('returns onCooldown=false when last restart was outside cooldown period', () => {
    const now = Date.now();
    const lastRestartAt = now - 3 * HOUR_MS; // 3 hours ago
    const result = isTechLeadRestartOnCooldown(lastRestartAt, now, 4);
    // cooldownHours = 2h; elapsed 3h > 2h → not on cooldown
    expect(result.onCooldown).toBe(false);
    expect(result.remainingMs).toBe(0);
  });

  it('enforces minimum 1 hour cooldown when maxAgeHours is very small', () => {
    const now = Date.now();
    const lastRestartAt = now - 30 * 60 * 1000; // 30 minutes ago
    const result = isTechLeadRestartOnCooldown(lastRestartAt, now, 1);
    // cooldownHours = max(1/2, 1) = 1h; elapsed 30m < 1h → on cooldown
    expect(result.onCooldown).toBe(true);
    expect(result.cooldownHours).toBe(1);
  });

  it('uses half of maxAgeHours as cooldown when that is more than 1 hour', () => {
    const now = Date.now();
    const lastRestartAt = now - 5 * HOUR_MS; // 5 hours ago
    const result = isTechLeadRestartOnCooldown(lastRestartAt, now, 24);
    // cooldownHours = max(24/2, 1) = 12h; elapsed 5h < 12h → on cooldown
    expect(result.onCooldown).toBe(true);
    expect(result.cooldownHours).toBe(12);
  });

  it('returns onCooldown=false exactly at cooldown boundary', () => {
    const now = Date.now();
    const cooldownHours = 2; // max(4/2, 1)
    const lastRestartAt = now - cooldownHours * HOUR_MS; // exactly at boundary
    const result = isTechLeadRestartOnCooldown(lastRestartAt, now, 4);
    expect(result.onCooldown).toBe(false);
    expect(result.remainingMs).toBe(0);
  });
});
