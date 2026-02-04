import { nanoid } from 'nanoid';
import { queryAll, queryOne, run } from '../client.js';
export function createTeam(db, input) {
    const id = `team-${nanoid(10)}`;
    const now = new Date().toISOString();
    run(db, `
    INSERT INTO teams (id, repo_url, repo_path, name, created_at)
    VALUES (?, ?, ?, ?, ?)
  `, [id, input.repoUrl, input.repoPath, input.name, now]);
    return getTeamById(db, id);
}
export function getTeamById(db, id) {
    return queryOne(db, 'SELECT * FROM teams WHERE id = ?', [id]);
}
export function getTeamByName(db, name) {
    return queryOne(db, 'SELECT * FROM teams WHERE name = ?', [name]);
}
export function getAllTeams(db) {
    return queryAll(db, 'SELECT * FROM teams ORDER BY created_at');
}
export function deleteTeam(db, id) {
    run(db, 'DELETE FROM teams WHERE id = ?', [id]);
}
//# sourceMappingURL=teams.js.map