import { Level } from 'level';

export type NowProvider = () => string;

export const defaultNow: NowProvider = () => new Date().toISOString();

export class LevelDbStore {
  constructor(public readonly db: Level<string, unknown>) {}

  async get<T>(key: string): Promise<T | undefined> {
    try {
      return (await this.db.get(key)) as T;
    } catch (error) {
      if ((error as { code?: string }).code === 'LEVEL_NOT_FOUND') {
        return undefined;
      }
      throw error;
    }
  }

  async put<T>(key: string, value: T): Promise<void> {
    await this.db.put(key, value);
  }

  async del(key: string): Promise<void> {
    await this.db.del(key);
  }

  async listEntries<T>(prefix: string): Promise<Array<{ key: string; value: T }>> {
    const end = `${prefix}\xFF`;
    const entries: Array<{ key: string; value: T }> = [];

    for await (const [key, value] of this.db.iterator({ gte: prefix, lt: end })) {
      entries.push({ key: key as string, value: value as T });
    }

    return entries;
  }

  async listValues<T>(prefix: string): Promise<T[]> {
    const entries = await this.listEntries<T>(prefix);
    return entries.map(entry => entry.value);
  }

  async nextSeq(name: string): Promise<number> {
    const key = `seq:${name}`;
    const current = (await this.get<number>(key)) ?? 0;
    const next = current + 1;
    await this.put(key, next);
    return next;
  }
}
