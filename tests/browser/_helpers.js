/**
 * Gedeelde hulpjes voor de browsertests: Chromium vinden en starten,
 * en de basis-URL van de app (gezet door tests/run.js).
 */
const { chromium } = require('playwright-core');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BASE = process.env.APP_URL || 'http://localhost:8765';

/** Zoekt een Chromium-binary: env-var, Playwright-cache of systeempaden. */
function chromiumPath() {
  if (process.env.CHROMIUM_PATH && fs.existsSync(process.env.CHROMIUM_PATH)) {
    return process.env.CHROMIUM_PATH;
  }
  const roots = [
    process.env.PLAYWRIGHT_BROWSERS_PATH,
    '/opt/pw-browsers',
    path.join(os.homedir(), '.cache', 'ms-playwright'),
  ].filter(Boolean);
  const relPaths = [
    path.join('chrome-linux', 'chrome'),
    path.join('chrome-linux', 'headless_shell'),
    path.join('chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
  ];
  for (const root of roots) {
    let dirs;
    try {
      dirs = fs.readdirSync(root).filter((d) => d.startsWith('chromium'));
    } catch {
      continue;
    }
    for (const dir of dirs) {
      for (const rel of relPaths) {
        const candidate = path.join(root, dir, rel);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

async function launch() {
  const executablePath = chromiumPath();
  if (!executablePath) {
    throw new Error('Geen Chromium gevonden. Installeer met: npx playwright@1.62.1 install chromium');
  }
  return chromium.launch({ executablePath, args: ['--no-sandbox'] });
}

/** 1x1 transparante PNG voor gestubde productafbeeldingen. */
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64'
);

module.exports = { chromium, chromiumPath, launch, BASE, PNG_1PX };
