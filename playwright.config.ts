import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir:'./e2e', fullyParallel:false, workers:1, retries:0, timeout:45_000,
  reporter:[['list']],
  use:{baseURL:'http://localhost:3302',trace:'retain-on-failure',...devices['Desktop Chrome'],viewport:{width:1440,height:1000}},
  webServer:{command:'node scripts/e2e-server.mjs',url:'http://localhost:3302/api/health',reuseExistingServer:false,timeout:120_000},
});
