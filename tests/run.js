/**
 * Testrunner voor de familie-app.
 *
 * - Start een eigen statische server voor de app (geen externe afhankelijkheid).
 * - Draait eerst de unit-tests (tests/unit), daarna de browsertests
 *   (tests/browser, Playwright + Chromium).
 * - Elke test is een los Node-script dat bij falen met exitcode != 0 stopt.
 *
 * Gebruik:  npm test           (alles)
 *           npm run test:unit
 *           npm run test:browser
 * Zonder Chromium worden de browsertests overgeslagen, tenzij
 * REQUIRE_BROWSER=1 (zoals in CI) — dan is dat een fout.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const ROOT = path.join(__dirname, '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};

function startServer() {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    let filePath = path.normalize(path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end();
      return;
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404).end('not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve(server));
  });
}

function listTests(dir) {
  const full = path.join(__dirname, dir);
  if (!fs.existsSync(full)) return [];
  return fs
    .readdirSync(full)
    .filter((f) => /\.test\.(js|mjs)$/.test(f))
    .sort()
    .map((f) => path.join(full, f));
}

/**
 * Draait één testbestand in een subproces. Asynchroon (geen spawnSync!):
 * de statische server draait in dít proces en moet requests kunnen blijven
 * beantwoorden terwijl de test loopt.
 */
function runTest(file, env) {
  return new Promise((resolve) => {
    const started = Date.now();
    let out = '';
    const child = spawn(process.execPath, [file], {
      env: { ...process.env, ...env },
    });
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    const timer = setTimeout(() => child.kill('SIGKILL'), 180000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const ok = code === 0;
      console.log(`${ok ? 'OK  ' : 'FAAL'} ${path.basename(file)} (${((Date.now() - started) / 1000).toFixed(1)}s)`);
      if (!ok) console.log(out.split('\n').slice(-20).join('\n'));
      resolve(ok);
    });
  });
}

(async () => {
  const args = process.argv.slice(2);
  const unitOnly = args.includes('--unit');
  const browserOnly = args.includes('--browser');
  let failed = 0;

  if (!browserOnly) {
    console.log('== Unit-tests ==');
    for (const file of listTests('unit')) {
      if (!(await runTest(file, {}))) failed++;
    }
  }

  if (!unitOnly) {
    const { chromiumPath } = require('./browser/_helpers');
    if (!chromiumPath()) {
      const message = 'Geen Chromium gevonden — browsertests overgeslagen. Installeer met: npx playwright@1.62.1 install chromium';
      if (process.env.REQUIRE_BROWSER === '1') {
        console.error('FAAL: ' + message);
        process.exit(1);
      }
      console.warn('LET OP: ' + message);
    } else {
      console.log('== Browsertests ==');
      const server = await startServer();
      const appUrl = `http://127.0.0.1:${server.address().port}`;
      for (const file of listTests('browser')) {
        if (!(await runTest(file, { APP_URL: appUrl }))) failed++;
      }
      server.close();
    }
  }

  console.log(failed === 0 ? '\nALLE TESTS GESLAAGD' : `\n${failed} TEST(S) GEFAALD`);
  process.exit(failed === 0 ? 0 : 1);
})();
