import { defineConfig, devices } from '@playwright/test';

/**
 * Visual regression for Claudian's CSS components. Renders a static harness
 * (tests/visual/components.html) that links the BUILT styles.css and screenshots
 * the goal banner, permission toggle states, status bar and switch-model action
 * at key breakpoints. Run `npm run build:css` first so styles.css is current.
 *
 * Usage:
 *   npx playwright install chromium   # one-time
 *   npm run test:visual               # compare against baselines
 *   npm run test:visual:update        # (re)generate baselines
 */
export default defineConfig({
  testDir: './tests/visual',
  snapshotDir: './tests/visual/__screenshots__',
  fullyParallel: true,
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
  },
  projects: [
    { name: 'w320', use: { viewport: { width: 320, height: 900 } } },
    { name: 'w768', use: { viewport: { width: 768, height: 900 } } },
    { name: 'w1440', use: { viewport: { width: 1440, height: 900 } } },
  ],
});
