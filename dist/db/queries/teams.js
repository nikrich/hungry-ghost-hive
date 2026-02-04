import { nanoid } from 'nanoid';
export function createTeam(db, input) {
    const id = `team-${nanoid(10)}`;
    const stmt = db.prepare(`
    INSERT INTO teams (id, repo_url, repo_path, name)
    VALUES (?, ?, ?, ?)
  `);
    stmt.run(id, input.repoUrl, input.repoPath, input.name);
    return getTeamById(db, id);
}
export function getTeamById(db, id) {
    return db.prepare('SELECT * FROM teams WHERE id = ?').get(id);
}
export function getTeamByName(db, name) {
    return db.prepare('SELECT * FROM teams WHERE name = ?').get(name);
}
export function getAllTeams(db) {
    return db.prepare('SELECT * FROM teams ORDER BY created_at').all();
}
export function deleteTeam(db, id) {
    db.prepare('DELETE FROM teams WHERE id = ?').run(id);
}
//# sourceMappingURL=teams.js.map