// Licensed under the Hungry Ghost Hive License. See LICENSE.

/**
 * Checks whether a tech lead restart should be skipped due to the cooldown period.
 * Cooldown is max(maxAgeHours / 2, 1) hours to prevent rapid restart loops.
 */
export function isTechLeadRestartOnCooldown(
  lastRestartAt: number | undefined,
  nowMs: number,
  maxAgeHours: number
): { onCooldown: boolean; cooldownHours: number; remainingMs: number } {
  const cooldownHours = Math.max(maxAgeHours / 2, 1);
  const cooldownMs = cooldownHours * 60 * 60 * 1000;
  if (lastRestartAt === undefined) {
    return { onCooldown: false, cooldownHours, remainingMs: 0 };
  }
  const elapsed = nowMs - lastRestartAt;
  const remainingMs = cooldownMs - elapsed;
  return { onCooldown: remainingMs > 0, cooldownHours, remainingMs: Math.max(remainingMs, 0) };
}
