// Tier 3 — Playwright over the full stack (see CONTRIBUTING.md).
//
// Nothing here starts a server. Point BASE_URL at whatever is running:
//   npm run dev                          → http://localhost:5173 (default)
//   docker compose up -d --build         → BASE_URL=http://gantry.localhost
//
// Screenshots land in e2e/shots/<project>/ (gitignored).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  fullyParallel: false,
  workers: 2,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.BASE_URL ?? 'http://localhost:5173',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
  },
  projects: [
    // iPhone presets default to WebKit; we only ship Chromium, and layout is what
    // we audit here. Real Safari quirks (100vh, safe areas) need a real device.
    { name: 'iphone-portrait',  use: { ...devices['iPhone 14'],           browserName: 'chromium' } },
    { name: 'iphone-landscape', use: { ...devices['iPhone 14 landscape'], browserName: 'chromium' } },
    { name: 'pixel-portrait',   use: { ...devices['Pixel 7'] } },
    { name: 'pixel-landscape',  use: { ...devices['Pixel 7 landscape'] } },
    { name: 'desktop',          use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 800 } } },
  ],
});
