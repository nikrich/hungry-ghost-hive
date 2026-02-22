// Licensed under the Hungry Ghost Hive License. See LICENSE.

export function isImmediateHumanBlockerReason(reason: string): boolean {
  const normalized = reason.toLowerCase();
  if (normalized.includes('human intervention required')) return true;
  if (normalized.includes('only a human can fix')) return true;
  if (normalized.includes('manual intervention required')) return true;

  // Common external-blocker patterns seen in stuck stories.
  if (/missing .*generated|generated .*missing/.test(normalized)) return true;
  if (/missing .*\.proto|\.proto .*missing/.test(normalized)) return true;
  if (/missing .*codegen|codegen .*missing/.test(normalized)) return true;
  if (/\.proto .*restor(e|ed|ing)|proto .*restor(e|ed|ing)/.test(normalized)) return true;
  if (/codegen .*rerun|rerun .*codegen/.test(normalized)) return true;
  if (
    /restor(e|ed|ing) .*proto|restor(e|ed|ing) .*generated|regenerat(e|ion|ed|ing) .*generated/.test(
      normalized
    )
  )
    return true;

  return false;
}
