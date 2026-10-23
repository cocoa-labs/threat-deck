import { query, queryOne } from '../client';

export interface UserRow {
  id: string;
  org_id: string | null;
  email: string;
  name: string | null;
  role: string;
  focus_areas: string[];
  preferences: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export async function getUserByEmail(email: string): Promise<UserRow | null> {
  return queryOne<UserRow>('SELECT * FROM users WHERE email = $1', [email]);
}

export async function getUserById(id: string): Promise<UserRow | null> {
  return queryOne<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
}

export async function upsertUser(params: { email: string; name?: string }): Promise<UserRow> {
  const result = await queryOne<UserRow>(
    `INSERT INTO users (email, name)
     VALUES ($1, $2)
     ON CONFLICT (email) DO UPDATE SET
       name = COALESCE(EXCLUDED.name, users.name),
       updated_at = NOW()
     RETURNING *`,
    [params.email, params.name],
  );
  return result!;
}

export async function updateUserPreferences(
  userId: string,
  preferences: Record<string, unknown>,
): Promise<void> {
  await query(
    `UPDATE users SET preferences = preferences || $2, updated_at = NOW() WHERE id = $1`,
    [userId, preferences],
  );
}

export async function updateUserFocusAreas(userId: string, focusAreas: string[]): Promise<void> {
  await query('UPDATE users SET focus_areas = $2, updated_at = NOW() WHERE id = $1', [
    userId,
    focusAreas,
  ]);
}
