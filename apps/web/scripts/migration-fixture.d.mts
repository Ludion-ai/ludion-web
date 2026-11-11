// migration-fixture.mjs の型（e2e/migration.spec.ts が読む）。
export const CEO_GITHUB_ID: number;
export function fakeGitHubId(login: string): number;
export function hashToken(token: string): string;
export const PEOPLE: {
  id: string;
  login: string;
  name: string | null;
  avatar_url: string | null;
  created_at: number;
  token: string;
  github_id: number;
}[];
export const WORK_ID: string;
export const OTHER_WORK_ID: string;
export const LIKE: { user_id: string; work_id: string; created_at: number };
export const BOOKMARK: { user_id: string; work_id: string; created_at: number };
export const SESSION_EXPIRES_AT: number;
export function oldShapeSql(): string;
export const MARK_0001_APPLIED: string;
