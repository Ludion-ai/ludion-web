// wrangler-deploy.mjs の型（e2e/wrangler-deploy.spec.ts が読む）。
export const RETRIES: number;
export const WAIT_MS: number;
export function isTransient(output: string): boolean;
export function deployWithRetry(options?: {
  run?: () => Promise<{ code: number; output: string }>;
  wait?: (ms: number) => Promise<void>;
  retries?: number;
  waitMs?: number;
  log?: (line: string) => void;
}): Promise<number>;
