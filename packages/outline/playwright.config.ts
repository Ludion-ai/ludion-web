import { defineConfig } from '@playwright/test';

// ブラウザは使わない（地図は純粋な関数）。Playwright は試験の走らせ方だけに使う（ほかの packages と同じ）。
export default defineConfig({
  testDir: './tests',
  fullyParallel: true,
  reporter: 'list',
});
