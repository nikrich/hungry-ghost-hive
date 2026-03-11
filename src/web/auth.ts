// Licensed under the Hungry Ghost Hive License. See LICENSE.

import type { IncomingMessage } from 'http';

export function authorize(req: IncomingMessage, authToken?: string): boolean {
  if (!authToken) return true;
  const authHeader = req.headers.authorization;
  if (!authHeader) return false;
  return authHeader === `Bearer ${authToken}`;
}
