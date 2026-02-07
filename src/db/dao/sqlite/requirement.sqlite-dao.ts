import { nanoid } from 'nanoid';
import type { Database } from 'sql.js';
import { queryAll, queryOne, run } from '../../client.js';
import type {
  CreateRequirementInput,
  RequirementRow,
  RequirementStatus,
  UpdateRequirementInput,
} from '../../queries/requirements.js';
import type { RequirementDao } from '../interfaces/requirement.dao.js';

export class SqliteRequirementDao implements RequirementDao {
  constructor(private readonly db: Database) {}

  async createRequirement(input: CreateRequirementInput): Promise<RequirementRow> {
    const id = `REQ-${nanoid(8).toUpperCase()}`;
    const now = new Date().toISOString();

    run(
      this.db,
      `
      INSERT INTO requirements (id, title, description, submitted_by, godmode, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [id, input.title, input.description, input.submittedBy || 'human', input.godmode ? 1 : 0, now]
    );

    return (await this.getRequirementById(id))!;
  }

  async getRequirementById(id: string): Promise<RequirementRow | undefined> {
    return queryOne<RequirementRow>(this.db, 'SELECT * FROM requirements WHERE id = ?', [id]);
  }

  async getAllRequirements(): Promise<RequirementRow[]> {
    return queryAll<RequirementRow>(
      this.db,
      'SELECT * FROM requirements ORDER BY created_at DESC, rowid DESC'
    );
  }

  async getRequirementsByStatus(status: RequirementStatus): Promise<RequirementRow[]> {
    return queryAll<RequirementRow>(
      this.db,
      'SELECT * FROM requirements WHERE status = ? ORDER BY created_at DESC, rowid DESC',
      [status]
    );
  }

  async getPendingRequirements(): Promise<RequirementRow[]> {
    return queryAll<RequirementRow>(
      this.db,
      `
      SELECT * FROM requirements
      WHERE status IN ('pending', 'planning', 'in_progress')
      ORDER BY created_at, rowid
    `
    );
  }

  async updateRequirement(
    id: string,
    input: UpdateRequirementInput
  ): Promise<RequirementRow | undefined> {
    const updates: string[] = [];
    const values: (string | number)[] = [];

    if (input.title !== undefined) {
      updates.push('title = ?');
      values.push(input.title);
    }
    if (input.description !== undefined) {
      updates.push('description = ?');
      values.push(input.description);
    }
    if (input.status !== undefined) {
      updates.push('status = ?');
      values.push(input.status);
    }
    if (input.godmode !== undefined) {
      updates.push('godmode = ?');
      values.push(input.godmode ? 1 : 0);
    }

    if (updates.length === 0) {
      return this.getRequirementById(id);
    }

    values.push(id);
    run(this.db, `UPDATE requirements SET ${updates.join(', ')} WHERE id = ?`, values);
    return this.getRequirementById(id);
  }

  async deleteRequirement(id: string): Promise<void> {
    run(this.db, 'DELETE FROM requirements WHERE id = ?', [id]);
  }
}
