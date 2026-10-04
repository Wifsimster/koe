#!/usr/bin/env node
// control-koe: drive a throwaway local Koe instance (widget inside a fake host
// SaaS page + admin dashboard) the way a user does, and keep the proof.
// Agent-facing: one JSON object on stdout per call, exit 0 on success.
// Run `control-koe --help` or `control-koe <command> --help`.

import { spawn, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const REPO = path.resolve(HERE, '..', '..', '..', '..');
const RUN_DIR = path.join(REPO, '.verify-run');
const STATE_FILE = path.join(RUN_DIR, 'state.json');
const EVIDENCE_ROOT = path.resolve(process.env.KOE_EVIDENCE_DIR || path.join(REPO, '.verify-evidence'));
const TOOLS_DIR = process.env.KOE_VERIFY_TOOLS || path.join(os.homedir(), '.cache', 'koe-verify', 'tools');
const PLAYWRIGHT_VERSION = '1.62.1';

// Fixed, unusual ports: the host's 5432 and 8787 already belong to other projects.
const PORTS = { api: 38787, host: 38788, postgres: 38432, cdp: 38222 };
const PG = 'koe-verify-pg';
const LABEL_KEY = 'koe-verify';
const LABEL = `${LABEL_KEY}=1`;
const DB_URL = `postgres://koe:koe_verify@127.0.0.1:${PORTS.postgres}/koe`;
const API = `http://localhost:${PORTS.api}`;
const HOST = `http://localhost:${PORTS.host}`;
const DASH = `${API}/admin`;
// Fake, throwaway identities. Nothing here is a real account.
const ADMIN = { email: 'admin@koe-verify.test', password: 'verify-admin-pass-123' };
const PROJECT = { key: 'acme-verify', name: 'Acme Verify (fake)' };
const HOST_USER = { id: 'user-42', name: 'Jane Fake', email: 'jane@acme-verify.test', metadata: { plan: 'pro (fake)', role: 'owner' } };
const HOST_APP = { version: '2.3.1-fake', release: 'acme-2026.10.04' };
// 1x1 PNG served by the host page as the "uploaded" screenshot.
const FAKE_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const PKG = {
  api: path.join(REPO, 'packages', 'api'),
  widget: path.join(REPO, 'packages', 'widget'),
  dashboard: path.join(REPO, 'packages', 'dashboard'),
  shared: path.join(REPO, 'packages', 'shared'),
};
const BUILD_ARTIFACTS = {
  shared: path.join(PKG.shared, 'dist', 'index.js'),
  widgetIife: path.join(PKG.widget, 'dist', 'koe.iife.js'),
  widgetCss: path.join(PKG.widget, 'dist', 'style.css'),
  dashboard: path.join(PKG.dashboard, 'dist', 'index.html'),
};

// ---------- output ----------
function out(obj) {
  const text = JSON.stringify(obj, null, 2);
  process.stdout.write(text + '\n');
  return text;
}
class CliError extends Error {
  constructor(message, fix, extra = {}) {
    super(message);
    this.fix = fix;
    this.extra = extra;
  }
}
function fail(message, fix, extra) {
  throw new CliError(message, fix, extra);
}

// ---------- args ----------
function parseArgs(argv) {
  const pos = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const k = eq === -1 ? a.slice(2) : a.slice(2, eq);
      const v = eq === -1 ? undefined : a.slice(eq + 1);
      let val;
      if (v !== undefined) val = v;
      else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) val = argv[++i];
      else val = true;
      if (flags[k] !== undefined) flags[k] = [].concat(flags[k], val);
      else flags[k] = val;
    } else pos.push(a);
  }
  return { pos, flags };
}

// ---------- state ----------
function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return null;
  }
}
function writeState(s) {
  fs.mkdirSync(RUN_DIR, { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}
function requireState() {
  const s = readState();
  if (!s) fail('No running verification instance.', 'Run `control-koe launch` first (or `control-koe doctor` to see what is up).');
  return s;
}
function evidenceDir(state) {
  const dir = path.join(EVIDENCE_ROOT, state?.runId || 'adhoc');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}
function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}
function artifactPath(state, name, ext = '.png') {
  const safe = String(name || 'shot').replace(/[^a-z0-9._-]+/gi, '-');
  return path.join(evidenceDir(state), `${stamp()}_${safe}${ext}`);
}

// ---------- helpers ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function portInUse(port) {
  return new Promise((resolve) => {
    const s = net.connect({ port, host: '127.0.0.1' });
    s.once('connect', () => {
      s.destroy();
      resolve(true);
    });
    s.once('error', () => resolve(false));
  });
}
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
function sh(cmd, args, opts = {}) {
  return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 << 20, ...opts }).trim();
}
function docker(...args) {
  return sh('docker', args);
}
function containerLabelled(name) {
  try {
    return docker('inspect', '-f', `{{index .Config.Labels "${LABEL_KEY}"}}`, name) === '1';
  } catch {
    return false;
  }
}
function containerRunning(name) {
  try {
    return docker('inspect', '-f', '{{.State.Running}}', name) === 'true';
  } catch {
    return false;
  }
}
function psql(sqlText) {
  return sh('docker', ['exec', PG, 'psql', '-U', 'koe', '-d', 'koe', '-v', 'ON_ERROR_STOP=1', '-At', '-c', sqlText]);
}
function psqlJson(sqlText) {
  const raw = psql(`select coalesce(json_agg(t), '[]'::json) from (${sqlText}) t`);
  return JSON.parse(raw || '[]');
}
const lit = (s) => `'${String(s).replace(/'/g, "''")}'`;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function waitFor(fn, { timeoutMs, label }) {
  const start = Date.now();
  let last;
  while (Date.now() - start < timeoutMs) {
    try {
      if (await fn()) return Date.now() - start;
    } catch (e) {
      last = e;
    }
    await sleep(400);
  }
  fail(`Timed out after ${timeoutMs}ms waiting for ${label}.`, `Read the logs in ${path.join(RUN_DIR, 'logs')} and run \`control-koe doctor\`.`, { lastError: last?.message });
}
function spawnDetached(name, cmd, args, { cwd, env }) {
  const logDir = path.join(RUN_DIR, 'logs');
  fs.mkdirSync(logDir, { recursive: true });
  const log = fs.openSync(path.join(logDir, `${name}.log`), 'a');
  const child = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', log, log] });
  child.unref();
  return child.pid;
}
function loadPlaywright() {
  const tries = [
    () => createRequire(path.join(REPO, 'package.json'))('playwright-core'),
    () => createRequire(path.join(TOOLS_DIR, 'package.json'))('playwright-core'),
    () => createRequire(path.join(REPO, 'package.json'))('playwright'),
  ];
  for (const t of tries) {
    try {
      return t();
    } catch {}
  }
  fail(
    'playwright-core is not installed (Koe has no Playwright dependency).',
    `Install the dev tool outside the repo: \`mkdir -p ${TOOLS_DIR} && npm i --prefix ${TOOLS_DIR} playwright-core@${PLAYWRIGHT_VERSION} && node ${TOOLS_DIR}/node_modules/playwright-core/cli.js install chromium\`. Or set KOE_VERIFY_TOOLS to a dir that has it.`,
  );
}
async function connect() {
  const state = requireState();
  const { chromium } = loadPlaywright();
  let browser;
  try {
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORTS.cdp}`);
  } catch (e) {
    fail('Browser daemon is not reachable on the CDP port.', 'Run `control-koe doctor`; if the browser is down, run `control-koe teardown`, then `control-koe launch`.', { error: e.message });
  }
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());
  return { browser, ctx, page, state };
}
async function withPage(fn) {
  const c = await connect();
  try {
    return await fn(c);
  } finally {
    await c.browser.close().catch(() => {});
  }
}
function resolveUrl(target, app) {
  if (/^https?:\/\//.test(target)) return target;
  const p = target.startsWith('/') ? target : '/' + target;
  if (app === 'dashboard') return DASH + (p === '/' ? '/' : p);
  if (app === 'api') return API + p;
  return HOST + p;
}
function hmacHex(secret, value) {
  return crypto.createHmac('sha256', secret).update(value).digest('hex');
}
function argList(v) {
  return v === undefined ? [] : [].concat(v);
}

// ---------- the fake host SaaS page ----------
// Served by the `__hostd` daemon on :38788. It plays the customer: its
// "backend" signs the reporter id with the project's identitySecret
// (v1 HMAC, README "Identity verification") and the page embeds the
// standalone IIFE build exactly like the README's <script> snippet.
function hostPageHtml(state, reqPath, asUser) {
  const user = asUser || HOST_USER;
  const userHash = hmacHex(state.project.identitySecret, user.id);
  const apiUrl = state.embed === 'same-origin' ? HOST : API;
  const cfg = {
    projectKey: state.project.key,
    apiUrl,
    user,
    userHash,
    position: 'bottom-right',
    theme: { accentColor: '#0f766e' },
    app: HOST_APP,
    capture: { keepQueryParams: ['tab'] },
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Acme Projects (fake host app)</title>
<link rel="stylesheet" href="/koe/style.css" />
<style>
  body { font-family: system-ui, sans-serif; margin: 0; color: #111; }
  header { display: flex; gap: 1rem; align-items: center; padding: .75rem 1.5rem; background: #0f766e; color: #fff; }
  header a { color: #fff; }
  main { padding: 1.5rem; max-width: 760px; }
  .banner { background: #fef3c7; border: 1px solid #f59e0b; padding: .5rem .75rem; font-size: 13px; }
  table { border-collapse: collapse; margin-top: 1rem; } td, th { border: 1px solid #ddd; padding: .4rem .8rem; }
</style>
</head>
<body>
<header>
  <strong>Acme Projects</strong>
  <nav aria-label="Host app">
    <a href="/">Home</a> <a href="/projects">Projects</a> <a href="/settings">Settings</a>
  </nav>
  <span style="margin-left:auto">Signed in as ${esc(user.name || user.id)}</span>
</header>
<main>
  <p class="banner">Verification scaffolding: a fake customer app that embeds the Koe widget. Not part of Koe.</p>
  <h1>${esc(reqPath === '/' ? 'Home' : reqPath.split('?')[0].replace(/^\//, ''))}</h1>
  <p>Current path: <code id="host-path"></code></p>
  <table aria-label="Projects">
    <tr><th>Project</th><th>Status</th></tr>
    <tr><td>Apollo (fake)</td><td>Active</td></tr>
    <tr><td>Borealis (fake)</td><td>Paused</td></tr>
  </table>
  <p><button type="button" id="export-csv">Export CSV</button> <span id="export-result" role="status"></span></p>
</main>
<script>
  document.getElementById('host-path').textContent = location.pathname + location.search + location.hash;
  // Deliberately broken host feature, so a bug report has something to describe
  // and repro has a console error to observe.
  document.getElementById('export-csv').addEventListener('click', function () {
    console.error('[acme] Export CSV failed: TypeError: rows.map is not a function');
    document.getElementById('export-result').textContent = 'Nothing happened?';
  });
</script>
<script src="/koe/koe.iife.js"></script>
<script>
  // The host's screenshot hook: a real app would capture and upload to its own storage.
  Koe.init(Object.assign(${JSON.stringify(cfg)}, {
    captureScreenshot: function () { return Promise.resolve(location.origin + '/fake-screenshots/' + Date.now() + '.png'); }
  }));
</script>
</body>
</html>`;
}

async function hostd() {
  const state = readState();
  if (!state) process.exit(1);
  const files = { '/koe/koe.iife.js': [BUILD_ARTIFACTS.widgetIife, 'text/javascript'], '/koe/style.css': [BUILD_ARTIFACTS.widgetCss, 'text/css'] };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, HOST);
    const f = files[url.pathname];
    if (f) {
      res.writeHead(200, { 'content-type': f[1], 'cache-control': 'no-store' });
      fs.createReadStream(f[0]).pipe(res);
      return;
    }
    if (url.pathname.startsWith('/v1/')) {
      // Same-origin embed mode: reverse-proxy the widget API like a customer
      // who mounts Koe under their own domain.
      const up = http.request({ host: '127.0.0.1', port: PORTS.api, path: req.url, method: req.method, headers: { ...req.headers, host: `localhost:${PORTS.api}` } }, (r) => {
        res.writeHead(r.statusCode || 502, r.headers);
        r.pipe(res);
      });
      up.on('error', () => {
        res.writeHead(502);
        res.end();
      });
      req.pipe(up);
      return;
    }
    if (url.pathname.startsWith('/fake-screenshots/')) {
      res.writeHead(200, { 'content-type': 'image/png' });
      res.end(FAKE_PNG);
      return;
    }
    if (url.pathname === '/favicon.ico') {
      res.writeHead(204);
      res.end();
      return;
    }
    const cookie = Object.fromEntries((req.headers.cookie || '').split(';').map((c) => c.trim().split('=')).filter((p) => p[0]));
    const asId = url.searchParams.get('as') || (cookie.koe_verify_as ? decodeURIComponent(cookie.koe_verify_as) : null);
    const asUser = asId ? { id: asId, name: `Replay of ${asId}` } : null;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(hostPageHtml(state, url.pathname + url.search, asUser));
  });
  server.listen(PORTS.host, '127.0.0.1');
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}

// ---------- browser daemon ----------
async function browserd() {
  const { chromium } = loadPlaywright();
  const ctx = await chromium.launchPersistentContext(path.join(RUN_DIR, 'browser-profile'), {
    headless: true,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    args: [`--remote-debugging-port=${PORTS.cdp}`],
  });
  const con = fs.createWriteStream(path.join(RUN_DIR, 'console.jsonl'), { flags: 'a' });
  const netw = fs.createWriteStream(path.join(RUN_DIR, 'network.jsonl'), { flags: 'a' });
  const attach = (page) => {
    page.on('console', (m) => con.write(JSON.stringify({ ts: new Date().toISOString(), type: m.type(), text: m.text(), url: page.url() }) + '\n'));
    page.on('pageerror', (e) => con.write(JSON.stringify({ ts: new Date().toISOString(), type: 'pageerror', text: e.message, url: page.url() }) + '\n'));
    page.on('requestfinished', async (req) => {
      const res = await req.response().catch(() => null);
      netw.write(JSON.stringify({ ts: new Date().toISOString(), method: req.method(), url: req.url(), status: res?.status() ?? null, ms: Math.round(req.timing().responseEnd) }) + '\n');
    });
    page.on('requestfailed', (req) => netw.write(JSON.stringify({ ts: new Date().toISOString(), method: req.method(), url: req.url(), status: null, failure: req.failure()?.errorText }) + '\n'));
  };
  ctx.pages().forEach(attach);
  ctx.on('page', attach);
  if (!ctx.pages().length) await ctx.newPage();
  const stop = async () => {
    await ctx.close().catch(() => {});
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  setInterval(() => {}, 1 << 30);
}

// ---------- widget helpers ----------
async function openWidget(page, hostPath) {
  await page.goto(resolveUrl(hostPath || '/', 'host'), { waitUntil: 'networkidle' });
  const launcher = page.getByRole('button', { name: 'Support', exact: true });
  await launcher.waitFor({ timeout: 10000 }).catch(() => fail('Widget launcher ("Support" button) did not render on the host page.', 'Run `control-koe console --level error` (IIFE load error?) and check packages/widget/dist/koe.iife.js exists; rebuild with `pnpm turbo run build`.'));
  await launcher.click();
  const dialog = page.getByRole('dialog', { name: /how can we help|report a bug|suggest an idea|ideas|my requests/i });
  await dialog.waitFor({ timeout: 5000 });
  return dialog;
}

function ticketRow(id) {
  return psqlJson(`select id, kind, title, description, status, priority, reporter_id, reporter_name, reporter_email, reporter_verified, steps_to_reproduce, expected_behavior, actual_behavior, metadata, screenshot_url, notes, is_public_roadmap, created_at, updated_at from tickets where id = ${lit(id)}`)[0] || null;
}

// ---------- commands ----------
const COMMANDS = {};

COMMANDS.launch = {
  summary: 'Start a throwaway Postgres, the API (+ dashboard), the fake host page and the browser daemon.',
  help: `control-koe launch [--embed same-origin|cross-origin] [--origins any|allowlist] [--dry-run]

Starts ONE isolated verification instance:
  1. builds the workspace (pnpm turbo run build) if shared/widget/dashboard dist is missing
  2. docker container ${PG} (postgres:16-alpine, tmpfs, 127.0.0.1:${PORTS.postgres}, label ${LABEL})
  3. the API from source (tsx src/bin/serve.ts) on :${PORTS.api}; it migrates on start and serves
     the built dashboard at ${DASH}/. Env is a whitelist: RESEND_*, NOTIFY_OWNER_EMAIL,
     DASHBOARD_PUBLIC_URL, REDIS_URL and KOE_SECRET_KEYS are forced empty.
     Fake admin: ${ADMIN.email} / ${ADMIN.password} (hash generated at launch).
  4. the repo's own bootstrap CLI (--non-interactive) creates project "${PROJECT.key}" with
     requireIdentityVerification=true and allowedOrigins=[] (or [${HOST}] with --origins allowlist); 2 fake feature requests
     with fake votes are inserted so "Browse ideas" is not empty.
  5. a fake host SaaS page on ${HOST} (verification scaffolding, in-memory, gone at teardown)
     that embeds the standalone widget build with a server-side HMAC userHash.
  6. a headless Chromium daemon (CDP :${PORTS.cdp}) recording console + network to JSONL.
Refuses to start if a port is busy, the container exists, or .verify-run/state.json exists.

--embed      same-origin (default): the host page reverse-proxies /v1/* to the API and the widget's
             apiUrl is the host's own origin (the README's "self-host the API on the same domain").
             cross-origin: the widget calls ${API} directly, like a SaaS on another domain.
             Use it to prove any CORS change (see features/widget-bug-report.md).
--origins    any (default): allowedOrigins=[] (permissive), every widget screen works.
             allowlist: allowedOrigins=[${HOST}]. \`widget ... --host-origin http://127.0.0.1:${PORTS.host}\`
             then loads the host page from an origin outside the list, to prove a refusal.
--dry-run    print the plan and touch nothing.`,
  async run(flags) {
    const embed = flags.embed === 'cross-origin' ? 'cross-origin' : 'same-origin';
    const origins = flags.origins === 'allowlist' ? 'allowlist' : 'any';
    const allowedOrigins = origins === 'allowlist' ? [HOST] : [];
    const plan = {
      ports: PORTS,
      container: PG,
      label: LABEL,
      embed,
      origins,
      allowedOrigins,
      urls: { hostPage: HOST, dashboard: `${DASH}/`, api: API },
      admin: ADMIN,
      project: PROJECT,
      steps: ['pnpm turbo run build (only if dist missing)', 'docker run postgres:16-alpine --tmpfs', 'tsx src/bin/serve.ts (migrate on start)', 'tsx src/bin/bootstrap.ts --non-interactive', 'seed 2 fake feature requests', '__hostd (fake host page)', '__browserd (headless Chromium, CDP)'],
      evidenceRoot: EVIDENCE_ROOT,
    };
    if (flags['dry-run']) return { ok: true, dryRun: true, plan };
    if (readState()) fail('A verification instance is already recorded in .verify-run/state.json.', 'Run `control-koe doctor` to inspect it, or `control-koe teardown` before launching again.');
    const busy = [];
    for (const [k, p] of Object.entries(PORTS)) if (await portInUse(p)) busy.push(`${k}:${p}`);
    if (busy.length) fail(`Ports already in use: ${busy.join(', ')}.`, 'Another app or a leaked run owns them. Do not kill it blindly: check `ss -ltnp` and `docker ps`, stop your own leftover with `control-koe teardown`, or wait.', { busy });
    try {
      docker('inspect', PG);
      fail(`Container ${PG} already exists.`, `Run \`control-koe teardown\` (it removes only containers labelled ${LABEL}).`);
    } catch (e) {
      if (e instanceof CliError) throw e;
    }

    const runId = stamp();
    const state = { runId, startedAt: new Date().toISOString(), embed, origins, pids: {}, containers: [], gitSha: sh('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']) };
    writeState(state);
    const logDir = path.join(RUN_DIR, 'logs');
    fs.mkdirSync(logDir, { recursive: true });
    const timings = {};
    let t = Date.now();

    const missing = Object.entries(BUILD_ARTIFACTS).filter(([, f]) => !fs.existsSync(f)).map(([k]) => k);
    if (missing.length) {
      try {
        fs.writeFileSync(path.join(logDir, 'build.log'), sh('pnpm', ['turbo', 'run', 'build'], { cwd: REPO }));
      } catch (e) {
        fs.writeFileSync(path.join(logDir, 'build.log'), `${e.stdout}\n${e.stderr}`);
        fail('pnpm turbo run build failed.', `Read ${path.join(logDir, 'build.log')}; run \`pnpm install\` first, then \`control-koe teardown\` and launch again.`);
      }
    }
    timings.build = Date.now() - t;
    t = Date.now();

    docker('run', '-d', '--name', PG, '--label', LABEL, '-p', `127.0.0.1:${PORTS.postgres}:5432`, '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_USER=koe', '-e', 'POSTGRES_PASSWORD=koe_verify', '-e', 'POSTGRES_DB=koe', 'postgres:16-alpine');
    state.containers.push(PG);
    writeState(state);
    // pg_isready flips true during the init-time restart; wait for a real query through the mapped port.
    await waitFor(async () => {
      psql('select 1');
      return portInUse(PORTS.postgres);
    }, { timeoutMs: 60000, label: 'postgres' });
    await sleep(1500);
    await waitFor(() => (psql('select 1') === '1'), { timeoutMs: 30000, label: 'postgres (post-init)' });
    timings.postgres = Date.now() - t;
    t = Date.now();

    const argon2 = createRequire(path.join(PKG.api, 'package.json'))('@node-rs/argon2');
    const adminHash = await argon2.hash(ADMIN.password, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
    // Whitelisted env: nothing from the operator's shell (keys, tokens) leaks in.
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      LANG: process.env.LANG || 'C.UTF-8',
      NODE_ENV: 'development',
      DATABASE_URL: DB_URL,
      PORT: String(PORTS.api),
      HOST: '127.0.0.1',
      MIGRATE_ON_START: 'true',
      MIGRATIONS_FOLDER: path.join(PKG.api, 'drizzle'),
      ENABLE_DASHBOARD: 'true',
      DASHBOARD_DIR: path.join(PKG.dashboard, 'dist'),
      ADMIN_EMAIL: ADMIN.email,
      ADMIN_PASSWORD_HASH: adminHash,
      ADMIN_SESSION_SECRET: crypto.randomBytes(32).toString('hex'),
      ADMIN_COOKIES_SECURE: 'false',
      // Third parties forced off.
      RESEND_API_KEY: '',
      RESEND_FROM_EMAIL: '',
      NOTIFY_OWNER_EMAIL: '',
      DASHBOARD_PUBLIC_URL: '',
      REDIS_URL: '',
      KOE_SECRET_KEYS: '',
      KOE_SECRET_ACTIVE_KID: '',
    };
    const tsx = path.join(PKG.api, 'node_modules', '.bin', 'tsx');
    state.pids.api = spawnDetached('api', tsx, ['src/bin/serve.ts'], { cwd: PKG.api, env });
    writeState(state);
    await waitFor(async () => (await fetch(`${API}/health/ready`)).ok, { timeoutMs: 90000, label: 'API /health/ready' });
    timings.api = Date.now() - t;
    t = Date.now();

    let boot;
    try {
      boot = sh(tsx, ['src/bin/bootstrap.ts', '--non-interactive'], {
        cwd: PKG.api,
        env: { ...env, KOE_PROJECT_NAME: PROJECT.name, KOE_PROJECT_KEY: PROJECT.key, KOE_ALLOWED_ORIGINS: allowedOrigins.join(','), KOE_REQUIRE_IDENTITY_VERIFICATION: 'true' },
      });
    } catch (e) {
      fs.writeFileSync(path.join(logDir, 'bootstrap.log'), `${e.stdout}\n${e.stderr}`);
      fail('bootstrap --non-interactive failed.', `Read ${path.join(logDir, 'bootstrap.log')}, then \`control-koe teardown\`.`);
    }
    // The identitySecret is a fake, per-run secret for a throwaway DB; keep it out of the log.
    const secret = boot.match(/identitySecret\s+([0-9a-f]{64})/)?.[1];
    fs.writeFileSync(path.join(logDir, 'bootstrap.log'), boot.replace(/[0-9a-f]{64}/g, '<redacted fake secret>'));
    if (!secret) fail('Could not read identitySecret from bootstrap output.', `Read ${path.join(logDir, 'bootstrap.log')}; the CLI output format may have changed.`);
    const projectId = psql(`select id from projects where key = ${lit(PROJECT.key)}`);
    state.project = { ...PROJECT, id: projectId, identitySecret: secret, allowedOrigins, requireIdentityVerification: true };
    psql(`insert into tickets (project_id, kind, title, description, reporter_id, reporter_name, reporter_verified, metadata) values
      (${lit(projectId)}, 'feature', 'Dark mode for the reports page (fake seed)', 'Seeded by control-koe launch.', 'seed-user-1', 'Seed User 1', true, '{}'::jsonb),
      (${lit(projectId)}, 'feature', 'Export projects to CSV (fake seed)', 'Seeded by control-koe launch.', 'seed-user-2', 'Seed User 2', true, '{}'::jsonb)`);
    psql(`insert into ticket_votes (ticket_id, user_id) select id, u from tickets, unnest(array['seed-user-1','seed-user-2','seed-user-3']) u where title like 'Dark mode%'`);
    timings.seed = Date.now() - t;
    t = Date.now();
    writeState(state);

    state.pids.host = spawnDetached('hostd', process.execPath, [SELF, '__hostd'], { cwd: REPO, env: { PATH: process.env.PATH, HOME: process.env.HOME } });
    writeState(state);
    await waitFor(async () => (await fetch(HOST)).ok, { timeoutMs: 15000, label: 'host page' });
    state.pids.browser = spawnDetached('browserd', process.execPath, [SELF, '__browserd'], { cwd: REPO, env: { PATH: process.env.PATH, HOME: process.env.HOME, KOE_VERIFY_TOOLS: TOOLS_DIR } });
    writeState(state);
    await waitFor(() => portInUse(PORTS.cdp), { timeoutMs: 60000, label: 'browser daemon CDP port' });
    timings.hostAndBrowser = Date.now() - t;
    state.readyAt = new Date().toISOString();
    writeState(state);
    return { ok: true, runId, embed, origins, allowedOrigins, urls: plan.urls, admin: ADMIN, project: { key: PROJECT.key, id: projectId }, hostUser: HOST_USER, pids: state.pids, containers: state.containers, timingsMs: timings, evidenceDir: evidenceDir(state), next: 'control-koe doctor' };
  },
};

COMMANDS.doctor = {
  summary: 'Read-only health check: is this instance ours, up, seeded and drivable?',
  help: `control-koe doctor

Read-only. Checks: state file, recorded pids alive, ${PG} running with label ${LABEL},
API /health/ready, admin API mounted (POST-less probe of /v1/admin/me => 401, not 404),
dashboard index served at ${DASH}/, host page embeds the widget, widget CORS preflight from
the host origin, browser CDP port, Playwright Chromium installed, seeded project present,
third-party env forced empty, git sha. Exit 0 only when every required check passes.
Run it first whenever anything looks off; read "hints".`,
  async run() {
    const state = readState();
    const checks = {};
    const hints = [];
    checks.stateFile = !!state;
    checks.pids = Object.fromEntries(Object.entries(state?.pids || {}).map(([k, p]) => [k, alive(p)]));
    checks.container = containerRunning(PG) && containerLabelled(PG);
    const get = async (url, init) => {
      try {
        const r = await fetch(url, init);
        return { status: r.status, text: await r.text(), headers: r.headers };
      } catch (e) {
        return { status: null, error: e.message };
      }
    };
    const ready = await get(`${API}/health/ready`);
    checks.apiReady = ready.status === 200;
    const me = await get(`${API}/v1/admin/me`);
    checks.adminApiMounted = me.status === 401;
    const dash = await get(`${DASH}/`);
    checks.dashboardServed = dash.status === 200 && /<div id="root">/.test(dash.text || '');
    const host = await get(`${HOST}/`);
    checks.hostPageEmbedsWidget = host.status === 200 && (host.text || '').includes('/koe/koe.iife.js');
    const pre = await get(`${API}/v1/widget/bugs`, { method: 'OPTIONS', headers: { Origin: HOST, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type,x-koe-project-key,x-koe-user-hash' } });
    checks.widgetPreflightAllowsHost = pre.headers?.get?.('access-control-allow-origin') === HOST;
    checks.browserCdp = await portInUse(PORTS.cdp);
    try {
      const { chromium } = loadPlaywright();
      checks.playwrightChromium = fs.existsSync(chromium.executablePath());
    } catch {
      checks.playwrightChromium = false;
    }
    if (checks.container) {
      try {
        checks.seededProject = psql(`select count(*) from projects where key = ${lit(PROJECT.key)}`) === '1';
        checks.ticketCount = Number(psql('select count(*) from tickets'));
      } catch (e) {
        checks.db = e.message;
      }
    }
    if (state?.pids?.api && alive(state.pids.api)) {
      try {
        const envRaw = fs.readFileSync(`/proc/${state.pids.api}/environ`, 'utf8');
        // Report names only, never values.
        const bad = ['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'REDIS_URL', 'NOTIFY_OWNER_EMAIL', 'DASHBOARD_PUBLIC_URL', 'KOE_SECRET_KEYS'].filter((k) => envRaw.split('\0').some((l) => l.startsWith(k + '=') && l.length > k.length + 1));
        checks.thirdPartyEnvEmpty = bad.length === 0 ? true : bad;
      } catch {
        checks.thirdPartyEnvEmpty = 'unknown (tsx re-spawns node; see logs)';
      }
    }
    checks.gitSha = sh('git', ['-C', REPO, 'rev-parse', '--short', 'HEAD']);
    checks.embed = state?.embed;
    checks.origins = state?.origins;
    const required = !!state && Object.values(checks.pids).every(Boolean) && checks.container && checks.apiReady && checks.adminApiMounted && checks.dashboardServed && checks.hostPageEmbedsWidget && checks.browserCdp && checks.playwrightChromium && checks.seededProject;
    if (!state) hints.push('No instance recorded: run `control-koe launch`.');
    if (state && !Object.values(checks.pids).every(Boolean)) hints.push('A recorded process died: read .verify-run/logs/*.log, then `control-koe teardown` and launch again.');
    if (!checks.playwrightChromium) hints.push(`Install the browser: node ${TOOLS_DIR}/node_modules/playwright-core/cli.js install chromium`);
    if (state?.embed === 'cross-origin' && !checks.widgetPreflightAllowsHost) hints.push('The API answers the CORS preflight from the host origin WITHOUT Access-Control-Allow-Origin, so the browser will block cross-origin widget calls. Read packages/api/src/middleware/cors.ts and lib/widgetOrigin.ts (see features/widget-bug-report.md Gotchas).');
    if (!required) process.exitCode = 1;
    return { ok: !!required, runId: state?.runId, checks, hints };
  },
};

COMMANDS.info = {
  summary: 'Print the recorded run: urls, fake credentials, pids, evidence dir.',
  help: 'control-koe info\n\nRead-only. Prints .verify-run/state.json (minus the fake identitySecret) plus URLs, fake admin credentials and the evidence dir.',
  async run() {
    const s = requireState();
    const { identitySecret, ...project } = s.project || {};
    return { ok: true, ...s, project, urls: { hostPage: HOST, dashboard: `${DASH}/`, api: API }, admin: ADMIN, hostUser: HOST_USER, evidenceDir: evidenceDir(s) };
  },
};

COMMANDS.teardown = {
  summary: 'Stop what launch started (recorded pids, labelled container); keep evidence.',
  help: `control-koe teardown [--dry-run]

Kills only the process groups recorded in .verify-run/state.json (never by name), removes
${PG} only if it carries label ${LABEL}, copies logs + console/network JSONL into
<evidence>/run-logs/, then deletes .verify-run/ (state, browser profile, host page daemon).
Evidence under ${EVIDENCE_ROOT} is never deleted. Reports portsStillOpen (must be []).

--dry-run   list what would be stopped/removed and do nothing.`,
  async run(flags) {
    const state = readState();
    const plan = { kill: state?.pids || {}, containers: containerLabelled(PG) ? [PG] : [], remove: [RUN_DIR].filter((p) => fs.existsSync(p)), keep: state ? evidenceDir(state) : EVIDENCE_ROOT };
    if (flags['dry-run']) return { ok: true, dryRun: true, plan };
    let saved = null;
    if (state && fs.existsSync(RUN_DIR)) {
      saved = path.join(evidenceDir(state), 'run-logs');
      fs.mkdirSync(saved, { recursive: true });
      for (const f of ['console.jsonl', 'network.jsonl']) if (fs.existsSync(path.join(RUN_DIR, f))) fs.copyFileSync(path.join(RUN_DIR, f), path.join(saved, f));
      if (fs.existsSync(path.join(RUN_DIR, 'logs'))) fs.cpSync(path.join(RUN_DIR, 'logs'), path.join(saved, 'logs'), { recursive: true });
    }
    const killed = {};
    for (const [name, pid] of Object.entries(state?.pids || {})) {
      try {
        process.kill(-pid, 'SIGTERM');
        killed[name] = 'SIGTERM';
      } catch {
        killed[name] = 'not running';
      }
    }
    await sleep(2000);
    for (const [name, pid] of Object.entries(state?.pids || {})) {
      if (alive(pid)) {
        try {
          process.kill(-pid, 'SIGKILL');
          killed[name] = 'SIGKILL';
        } catch {}
      }
    }
    for (const c of plan.containers) docker('rm', '-f', c);
    fs.rmSync(RUN_DIR, { recursive: true, force: true });
    const portsStillOpen = [];
    for (const [k, p] of Object.entries(PORTS)) if (await portInUse(p)) portsStillOpen.push(`${k}:${p}`);
    if (portsStillOpen.length) process.exitCode = 1;
    return { ok: portsStillOpen.length === 0, killed, removedContainers: plan.containers, savedLogs: saved, evidenceKept: plan.keep, portsStillOpen, ...(portsStillOpen.length ? { fix: 'Something outside this run holds a port; inspect with `ss -ltnp` before relaunching. Do not kill processes you did not start.' } : {}) };
  },
};

COMMANDS.goto = {
  summary: 'Navigate the shared page: host page path (default), --app dashboard, or a full URL.',
  help: `control-koe goto <path|url> [--app host|dashboard|api]

host (default)  ${HOST}<path>          e.g. control-koe goto /projects?tab=export
dashboard       ${DASH}<path>          e.g. control-koe goto / --app dashboard
Waits for network idle; prints url, HTTP status and title.`,
  async run(flags, pos) {
    if (!pos[0]) fail('Missing path.', 'Example: control-koe goto /projects, or control-koe goto / --app dashboard');
    return withPage(async ({ page }) => {
      const r = await page.goto(resolveUrl(pos[0], flags.app || 'host'), { waitUntil: 'networkidle' }).catch((e) => fail(`Navigation failed: ${e.message}`, 'Run `control-koe doctor`.'));
      return { ok: true, url: page.url(), status: r?.status(), title: await page.title() };
    });
  },
};

COMMANDS.login = {
  summary: 'Log the shared browser into the dashboard through the real /admin/login form.',
  help: `control-koe login [--dry-run]

Opens ${DASH}/login, fills "Email" and "Password" with the fake admin
(${ADMIN.email} / ${ADMIN.password}), clicks the submit button, waits to leave /login.
Side effect: one admin_sessions row. The auth route allows 5 attempts/minute per IP.
--dry-run   print the account and URL without submitting.`,
  async run(flags) {
    if (flags['dry-run']) return { ok: true, dryRun: true, account: ADMIN.email, url: `${DASH}/login` };
    return withPage(async ({ page, state }) => {
      await page.goto(`${DASH}/login`, { waitUntil: 'networkidle' });
      await page.getByLabel(/email/i).fill(ADMIN.email);
      await page.getByLabel(/password/i).fill(ADMIN.password);
      const resp = page.waitForResponse((r) => r.url().includes('/v1/admin/auth/login'), { timeout: 15000 }).catch(() => null);
      await page.locator('form button[type="submit"]').click();
      const r = await resp;
      await page.waitForURL((u) => !u.pathname.endsWith('/login'), { timeout: 15000 }).catch(() => {});
      await page.waitForLoadState('networkidle').catch(() => {});
      const url = page.url();
      if (url.includes('/login')) fail('Login did not leave /admin/login.', 'Run `control-koe network-log --filter /v1/admin/auth` and read .verify-run/logs/api.log (rate limit: 5/min).', { loginStatus: r?.status() });
      const sessions = Number(psql('select count(*) from admin_sessions'));
      const file = artifactPath(state, 'dashboard-after-login');
      await page.screenshot({ path: file });
      return { ok: true, account: ADMIN.email, loginStatus: r?.status(), url, adminSessionsRows: sessions, file };
    });
  },
};

COMMANDS.widget = {
  summary: 'Drive the embedded widget on the host page: open | bug | feature | vote | my-requests.',
  help: `control-koe widget open [--path /projects]
control-koe widget bug --title <t> --description <d> [--steps <s>] [--expected <e>] [--path /projects?tab=export] [--trigger-error] [--dry-run]
control-koe widget feature --title <t> --description <d> [--path /] [--dry-run]
control-koe widget vote [--title <regex>] [--dry-run]
control-koe widget my-requests
Every action accepts --host-origin http://127.0.0.1:${PORTS.host}: the same host page, served from
an origin that \`launch --origins allowlist\` does not allow. Use it to prove a refusal.

All flows start on the fake host page (${HOST}<path>) as the signed-in host user
${HOST_USER.id} ("${HOST_USER.name}"), whose userHash the host page computed server-side.
They click the real launcher (button "Support"), then the intent card, then fill fields by
their visible labels ("Title", "What happened?", "How to reproduce", "Describe your idea").

bug        --trigger-error first clicks the host's broken "Export CSV" button (console error),
           so a later \`repro\` has something to observe. Waits for POST /v1/widget/bugs,
           shows the success text, then reads the tickets row back from the DB (second read).
           Side effect: one tickets row (kind=bug). Prints ticketId for \`repro\` and \`ticket\`.
feature    same for "Suggest an idea" -> POST /v1/widget/features. Side effect: one tickets row.
vote       "Browse ideas", clicks the Upvote toggle on the first row matching --title
           (default: first row). Reads ticket_votes back. Side effect: one vote row toggled.
my-requests "My requests" list for the host user (read-only).
--dry-run  bug/feature/vote: report what would be typed/clicked; does not open the widget.`,
  async run(flags, pos) {
    const action = pos[0];
    const actions = ['open', 'bug', 'feature', 'vote', 'my-requests'];
    if (!actions.includes(action)) fail(`Unknown widget action "${action ?? ''}".`, `Use one of: ${actions.join(', ')} (see control-koe widget --help).`);
    if ((action === 'bug' || action === 'feature') && (typeof flags.title !== 'string' || typeof flags.description !== 'string')) fail('Missing --title or --description.', `Example: control-koe widget ${action} --title "Export does nothing" --description "Clicked Export CSV, no file"`);
    const pathPart = typeof flags.path === 'string' ? flags.path : action === 'bug' ? '/projects?tab=export' : '/';
    const hostOrigin = typeof flags['host-origin'] === 'string' ? flags['host-origin'].replace(/\/$/, '') : null;
    if (hostOrigin && !/^http:\/\/(localhost|127\.0\.0\.1):38788$/.test(hostOrigin)) fail(`--host-origin must name the local host page (${HOST} or http://127.0.0.1:${PORTS.host}).`, 'Use --host-origin http://127.0.0.1:38788 to load the same host page from an origin outside the allowlist.');
    const hostPath = hostOrigin ? hostOrigin + (pathPart.startsWith('/') ? pathPart : '/' + pathPart) : pathPart;
    if (flags['dry-run']) return { ok: true, dryRun: true, action, hostUrl: resolveUrl(hostPath, 'host'), as: HOST_USER, fields: { title: flags.title, description: flags.description, steps: flags.steps }, triggerError: !!flags['trigger-error'], sideEffect: { bug: 'tickets row', feature: 'tickets row', vote: 'ticket_votes row toggled' }[action] || 'none' };
    return withPage(async ({ page, state }) => {
      if (action === 'bug' && flags['trigger-error']) {
        await page.goto(resolveUrl(hostPath, 'host'), { waitUntil: 'networkidle' });
        await page.getByRole('button', { name: 'Export CSV' }).click();
        await sleep(300);
      }
      const dialog = action === 'bug' && flags['trigger-error'] ? await (async () => {
        await page.getByRole('button', { name: 'Support', exact: true }).click();
        const d = page.getByRole('dialog');
        await d.waitFor({ timeout: 5000 });
        return d;
      })() : await openWidget(page, hostPath);
      if (action === 'open') {
        const file = artifactPath(state, 'widget-open');
        await page.screenshot({ path: file });
        return { ok: true, url: page.url(), aria: await dialog.ariaSnapshot(), file };
      }
      if (action === 'my-requests') {
        await dialog.getByRole('button', { name: /my requests/i }).click();
        await page.waitForResponse((r) => r.url().includes('/v1/widget/my-requests'), { timeout: 10000 }).catch(() => null);
        await sleep(600);
        const file = artifactPath(state, 'widget-my-requests');
        await page.screenshot({ path: file });
        const loadError = await dialog.getByRole('alert').first().textContent({ timeout: 500 }).catch(() => null);
        const rows = psqlJson(`select id, kind, title, status from tickets where reporter_id = ${lit(HOST_USER.id)} order by created_at desc`);
        if (loadError) process.exitCode = 1;
        return { ok: !loadError, aria: await dialog.ariaSnapshot(), dbRowsForHostUser: rows, file, ...(loadError ? { error: `My requests failed to load: "${loadError}".`, fix: 'Run `control-koe network-log --filter /v1/widget/my-requests`; a 403 origin_not_allowed means the page origin is outside allowedOrigins.' } : {}) };
      }
      if (action === 'vote') {
        await dialog.getByRole('button', { name: /browse ideas/i }).click();
        await dialog.getByRole('listitem').or(dialog.getByRole('alert')).first().waitFor({ timeout: 10000 });
        const loadError = await dialog.getByRole('alert').first().textContent({ timeout: 500 }).catch(() => null);
        if (loadError && !(await dialog.getByRole('listitem').count())) fail(`Browse ideas failed to load: "${loadError}".`, 'Run `control-koe network-log --filter /v1/widget/features`. A 403 origin_not_allowed means the page origin is outside allowedOrigins.');
        const items = dialog.getByRole('listitem');
        const row = typeof flags.title === 'string' ? items.filter({ hasText: new RegExp(flags.title, 'i') }).first() : items.first();
        if (!(await row.count())) fail('No idea row matched --title.', 'Run `control-koe widget vote --dry-run` and `control-koe snapshot` to see row titles.');
        const btn = row.getByRole('button', { name: /upvote|remove upvote/i }).first();
        const before = artifactPath(state, 'widget-vote-before');
        await page.screenshot({ path: before });
        const respP = page.waitForResponse((r) => /\/v1\/widget\/features\/[^/]+\/vote/.test(r.url()) && r.request().method() === 'POST', { timeout: 15000 });
        await btn.click();
        const resp = await respP;
        const body = await resp.json().catch(() => null);
        await sleep(600);
        const after = artifactPath(state, 'widget-vote-after');
        await page.screenshot({ path: after });
        const ticketId = body?.data?.id;
        const votes = ticketId ? psqlJson(`select user_id, created_at from ticket_votes where ticket_id = ${lit(ticketId)} order by created_at`) : [];
        const ok = resp.ok();
        if (!ok) process.exitCode = 1;
        return { ok, response: { status: resp.status(), body }, dbVotes: votes, hostUserHasVote: votes.some((v) => v.user_id === HOST_USER.id), evidence: { before, after }, ...(ok ? {} : { fix: 'Check `control-koe network-log --filter /v1/widget --status-min 400` and .verify-run/logs/api.log.' }) };
      }
      // bug | feature
      const isBug = action === 'bug';
      await dialog.getByRole('button', { name: isBug ? /report a bug/i : /suggest an idea/i }).click();
      await dialog.getByLabel('Title').fill(flags.title);
      await dialog.getByLabel(isBug ? 'What happened?' : 'Describe your idea').fill(flags.description);
      if (isBug && typeof flags.steps === 'string') await dialog.getByLabel('How to reproduce').fill(flags.steps.replace(/\\n/g, '\n'));
      if (isBug && typeof flags.expected === 'string') await dialog.getByLabel('What did you expect?').fill(flags.expected);
      const before = artifactPath(state, `widget-${action}-filled`);
      await page.screenshot({ path: before });
      const endpoint = isBug ? '/v1/widget/bugs' : '/v1/widget/features';
      const respP = page.waitForResponse((r) => r.url().endsWith(endpoint) && r.request().method() === 'POST', { timeout: 15000 }).catch(() => null);
      await dialog.getByRole('button', { name: isBug ? 'Send bug report' : 'Submit request' }).click();
      const resp = await respP;
      const body = resp ? await resp.json().catch(() => null) : null;
      const successText = isBug ? 'Thanks — your report has been received.' : 'Thanks for the suggestion!';
      const success = await page.getByText(successText).waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
      const alertText = success ? null : await dialog.getByRole('alert').first().textContent({ timeout: 1000 }).catch(() => null);
      const after = artifactPath(state, `widget-${action}-result`);
      await page.screenshot({ path: after });
      const ticketId = body?.data?.id || null;
      const row = ticketId ? ticketRow(ticketId) : null;
      const ok = !!(resp && resp.status() === 201 && success && row);
      const result = { ok, action, hostUrl: page.url(), response: resp ? { status: resp.status(), body } : null, successShown: success, widgetAlert: alertText, ticketId, dbRow: row, evidence: { before, after } };
      fs.writeFileSync(after.replace(/\.png$/, '.json'), JSON.stringify(result, null, 2));
      if (!ok) {
        process.exitCode = 1;
        result.error = resp ? `Submission did not complete (HTTP ${resp.status()}).` : 'No POST reached the API (blocked by the browser: CORS?).';
        result.fix = 'Run `control-koe console --level error --last 10` and `control-koe network-log --filter /v1/widget`; a CORS error means the page origin is not allowed (expected with --host-origin under --origins allowlist); see features/widget-bug-report.md.';
      }
      return result;
    });
  },
};

COMMANDS.inbox = {
  summary: 'Open the dashboard inbox, screenshot it, compare with the admin tickets API.',
  help: `control-koe inbox [--expect <ticketId|title regex>] [--status open|all|...] [--kind bug|feature|all]

Requires \`control-koe login\`. Opens ${DASH}/?status=<status>&kind=<kind>, screenshots it,
fetches GET /v1/admin/projects/${PROJECT.key}/tickets through the same session, and reports
whether --expect (a ticket id or a title regex) is in the API list AND visible on the page.
Read-only.`,
  async run(flags) {
    return withPage(async ({ page, state }) => {
      const status = typeof flags.status === 'string' ? flags.status : 'open';
      const kind = typeof flags.kind === 'string' ? flags.kind : 'all';
      await page.goto(`${DASH}/?status=${status}&kind=${kind}`, { waitUntil: 'networkidle' });
      if (page.url().includes('/login')) fail('Not logged in: the dashboard redirected to /admin/login.', 'Run `control-koe login` first.');
      await sleep(800);
      const api = await page.evaluate(async (k) => {
        const r = await fetch(`/v1/admin/projects/${k}/tickets?limit=50`, { credentials: 'include' });
        return { status: r.status, body: await r.json() };
      }, PROJECT.key);
      const items = api.body?.data?.items || api.body?.data?.tickets || api.body?.data || [];
      const list = Array.isArray(items) ? items : [];
      const mainText = await page.locator('body').innerText().catch(() => '');
      let expect = null;
      if (typeof flags.expect === 'string') {
        const hit = UUID_RE.test(flags.expect) ? list.find((t) => t.id === flags.expect) : list.find((t) => new RegExp(flags.expect, 'i').test(t.title));
        expect = { query: flags.expect, inApi: !!hit, ticketId: hit?.id || null, title: hit?.title || null, visibleOnPage: !!hit && mainText.includes(hit.title) };
      }
      const file = artifactPath(state, 'dashboard-inbox');
      await page.screenshot({ path: file, fullPage: true });
      const ok = api.status === 200 && (!expect || (expect.inApi && expect.visibleOnPage));
      if (!ok) process.exitCode = 1;
      return { ok, url: page.url(), api: { status: api.status, count: list.length, titles: list.slice(0, 10).map((t) => `${t.kind}: ${t.title} [${t.status}]`) }, expect, file, ...(ok ? {} : { fix: 'Check --status (default "open") and --kind filters; run `control-koe tickets` for the DB view.' }) };
    });
  },
};

COMMANDS.ticket = {
  summary: 'Open a ticket in the dashboard; optionally change its status through the Status select.',
  help: `control-koe ticket <ticketId> [--set-status open|in_progress|planned|resolved|closed|wont_fix] [--dry-run]

Requires \`control-koe login\`. Opens ${DASH}/tickets/<id>, screenshots it (Description,
Reproduction, Browser context, Reporter). With --set-status, opens the "Status" select,
picks the option, waits for the PATCH, then reads the tickets row and admin_ticket_events
back from the DB. Side effect (only with --set-status): status change + one audit event.
--dry-run   with --set-status: report the current and target status without clicking.`,
  async run(flags, pos) {
    const id = pos[0];
    if (!id || !UUID_RE.test(id)) fail('Missing or malformed ticket id.', 'Pass the uuid printed by `control-koe widget bug` (ticketId) or listed by `control-koe tickets`.');
    const before = ticketRow(id);
    if (!before) fail(`No ticket ${id} in the throwaway DB.`, 'Run `control-koe tickets` to list ids.');
    const labels = { open: 'Open', in_progress: 'In progress', planned: 'Planned', resolved: 'Resolved', closed: 'Closed', wont_fix: "Won't fix" };
    const target = typeof flags['set-status'] === 'string' ? flags['set-status'] : null;
    if (target && !labels[target]) fail(`Unknown status "${target}".`, `Use one of: ${Object.keys(labels).join(', ')}`);
    if (flags['dry-run']) return { ok: true, dryRun: true, ticketId: id, currentStatus: before.status, targetStatus: target };
    return withPage(async ({ page, state }) => {
      await page.goto(`${DASH}/tickets/${id}`, { waitUntil: 'networkidle' });
      if (page.url().includes('/login')) fail('Not logged in.', 'Run `control-koe login` first.');
      await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 10000 });
      const shot = artifactPath(state, `dashboard-ticket-${id.slice(0, 8)}`);
      await page.screenshot({ path: shot, fullPage: true });
      const text = await page.locator('body').innerText().catch(() => '');
      const shows = { title: text.includes(before.title), browserContext: /Browser context/i.test(text), reproduction: before.steps_to_reproduce ? text.includes(before.steps_to_reproduce.split('\n')[0]) : null };
      if (!target) return { ok: true, ticketId: id, url: page.url(), shows, file: shot };
      // The Status select is the first combobox in the State card ("Status" row).
      const trigger = page.getByRole('combobox').filter({ hasText: labels[before.status] || before.status }).first();
      await trigger.click();
      const patchP = page.waitForResponse((r) => r.url().includes(`/tickets/${id}`) && r.request().method() === 'PATCH', { timeout: 15000 }).catch(() => null);
      await page.getByRole('option', { name: labels[target] }).click();
      const patch = await patchP;
      await sleep(800);
      const after = ticketRow(id);
      const events = psqlJson(`select kind, payload, created_at from admin_ticket_events where ticket_id = ${lit(id)} order by created_at`);
      const shot2 = artifactPath(state, `dashboard-ticket-${id.slice(0, 8)}-${target}`);
      await page.screenshot({ path: shot2, fullPage: true });
      const ok = patch?.status() === 200 && after?.status === target;
      if (!ok) process.exitCode = 1;
      return { ok, ticketId: id, patchStatus: patch?.status() ?? null, statusBefore: before.status, statusAfter: after?.status, auditEvents: events, shows, evidence: { before: shot, after: shot2 }, ...(ok ? {} : { fix: 'Run `control-koe snapshot --selector main` to see the State card comboboxes.' }) };
    });
  },
};

COMMANDS.tickets = {
  summary: 'Read-only DB view of tickets (the second read for any widget/dashboard proof).',
  help: `control-koe tickets [--id <uuid>] [--kind bug|feature] [--last N]

Reads the tickets table of the throwaway DB through docker exec psql. With --id prints the
full row (metadata, steps, reporter, screenshot_url) plus its votes and audit events.`,
  async run(flags) {
    requireState();
    if (typeof flags.id === 'string') {
      const row = ticketRow(flags.id);
      if (!row) fail(`No ticket ${flags.id}.`, 'Run `control-koe tickets` without --id to list.');
      return { ok: true, ticket: row, votes: psqlJson(`select user_id, created_at from ticket_votes where ticket_id = ${lit(flags.id)}`), events: psqlJson(`select kind, payload, created_at from admin_ticket_events where ticket_id = ${lit(flags.id)} order by created_at`) };
    }
    const where = flags.kind === 'bug' || flags.kind === 'feature' ? `where t.kind = ${lit(flags.kind)}` : '';
    const n = parseInt(flags.last || '20', 10);
    return { ok: true, tickets: psqlJson(`select t.id, t.kind, t.title, t.status, t.reporter_id, t.reporter_verified, (select count(*) from ticket_votes v where v.ticket_id = t.id) as votes, t.created_at from tickets t ${where} order by t.created_at desc limit ${n}`) };
  },
};

COMMANDS.click = {
  summary: 'Click by role+name (preferred), label, or text on the shared page.',
  help: 'control-koe click (--role <role> --name <regex> | --label <regex> | --text <regex>) [--dry-run]\n\nExample: control-koe click --role button --name "^Support$"\n--dry-run reports how many elements match without clicking.',
  async run(flags) {
    return withPage(async ({ page }) => {
      const loc = flags.role ? page.getByRole(flags.role, { name: new RegExp(flags.name || '.', 'i') }) : flags.label ? page.getByLabel(new RegExp(flags.label, 'i')) : flags.text ? page.getByText(new RegExp(flags.text, 'i')) : null;
      if (!loc) fail('No locator given.', 'Pass --role button --name "Support" (preferred), --label or --text.');
      const count = await loc.count();
      if (count === 0) fail('Locator matched nothing.', 'Run `control-koe snapshot` and copy the role/name from the ARIA tree.');
      if (flags['dry-run']) return { ok: true, dryRun: true, matches: count };
      await loc.first().click();
      await sleep(400);
      return { ok: true, matches: count, url: page.url() };
    });
  },
};

COMMANDS.fill = {
  summary: 'Type into a field found by its label (or placeholder).',
  help: 'control-koe fill (--label <regex> | --placeholder <regex>) --value <text> [--dry-run]\n\nExample: control-koe fill --label "^Title$" --value "Export does nothing"',
  async run(flags) {
    if (typeof flags.value !== 'string') fail('Missing --value.', 'Example: control-koe fill --label "^Title$" --value "text"');
    return withPage(async ({ page }) => {
      const loc = flags.label ? page.getByLabel(new RegExp(flags.label, 'i')) : flags.placeholder ? page.getByPlaceholder(new RegExp(flags.placeholder, 'i')) : null;
      if (!loc) fail('No locator given.', 'Pass --label or --placeholder.');
      const count = await loc.count();
      if (!count) fail('Field not found.', 'Run `control-koe snapshot` to see field labels.');
      if (flags['dry-run']) return { ok: true, dryRun: true, matches: count };
      await loc.first().fill(flags.value);
      return { ok: true, matches: count };
    });
  },
};

COMMANDS.key = {
  summary: 'Press a key on the focused element (Enter, Escape, Tab...).',
  help: 'control-koe key <Key>\n\nExample: control-koe key Escape (closes the widget panel).',
  async run(_f, pos) {
    if (!pos[0]) fail('Missing key.', 'Example: control-koe key Enter');
    return withPage(async ({ page }) => {
      await page.keyboard.press(pos[0]);
      return { ok: true, key: pos[0] };
    });
  },
};

COMMANDS.screenshot = {
  summary: 'Save a PNG of the shared page into the evidence dir.',
  help: 'control-koe screenshot [--name <label>] [--full-page]\n\nWrites <evidence>/<timestamp>_<label>.png and prints its path.',
  async run(flags) {
    return withPage(async ({ page, state }) => {
      const file = artifactPath(state, flags.name);
      await page.screenshot({ path: file, fullPage: !!flags['full-page'] });
      return { ok: true, file, url: page.url() };
    });
  },
};

COMMANDS.snapshot = {
  summary: 'ARIA snapshot of the shared page (roles + accessible names to drive by).',
  help: 'control-koe snapshot [--name <label>] [--selector <css>]\n\nPrints the ARIA tree (YAML) of body or --selector and saves it as <evidence>/<ts>_<label>.aria.yml.\nThe widget panel is a <dialog>; use --selector dialog to see only it.',
  async run(flags) {
    return withPage(async ({ page, state }) => {
      const yml = await page.locator(flags.selector || 'body').first().ariaSnapshot();
      const file = artifactPath(state, flags.name || 'snapshot', '.aria.yml');
      fs.writeFileSync(file, yml);
      return { ok: true, url: page.url(), file, aria: yml };
    });
  },
};

function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
}
COMMANDS.console = {
  summary: 'Browser console messages recorded by the daemon since launch.',
  help: 'control-koe console [--level error|warning|log|pageerror] [--grep <regex>] [--last N]\n\nReads .verify-run/console.jsonl (copied into the evidence dir by teardown).',
  async run(flags) {
    requireState();
    let rows = readJsonl(path.join(RUN_DIR, 'console.jsonl'));
    if (flags.level) rows = rows.filter((r) => r.type === flags.level);
    if (flags.grep) rows = rows.filter((r) => new RegExp(flags.grep, 'i').test(r.text));
    return { ok: true, total: rows.length, messages: rows.slice(-parseInt(flags.last || '50', 10)) };
  },
};
COMMANDS['network-log'] = {
  summary: 'HTTP requests recorded by the daemon (method, url, status, timing).',
  help: 'control-koe network-log [--filter <substring>] [--status-min 400] [--failed] [--last N]\n\nReads .verify-run/network.jsonl. Example: control-koe network-log --filter /v1/widget',
  async run(flags) {
    requireState();
    let rows = readJsonl(path.join(RUN_DIR, 'network.jsonl'));
    if (flags.filter) rows = rows.filter((r) => r.url.includes(flags.filter));
    if (flags['status-min']) rows = rows.filter((r) => (r.status || 0) >= parseInt(flags['status-min'], 10));
    if (flags.failed) rows = rows.filter((r) => r.status === null);
    return { ok: true, total: rows.length, requests: rows.slice(-parseInt(flags.last || '50', 10)) };
  },
};

// ---------- repro ----------
const STEP_HELP = `Steps file (--steps-file): JSON array, executed in order on the replay page, a screenshot after each:
  {"goto": "/projects?tab=export"}                      host-page path
  {"click": {"role": "button", "name": "Export CSV"}}   or {"click": {"text": "..."}} / {"label": "..."}
  {"fill": {"label": "Title", "value": "x"}}
  {"press": "Enter"}
  {"wait": 1000}
Write it by reading the report's free-text "steps_to_reproduce"; Koe does not record actions.`;

function loadReport(flags, pos) {
  if (typeof flags['from-file'] === 'string') {
    const raw = JSON.parse(fs.readFileSync(flags['from-file'], 'utf8'));
    // Accept a tickets row (snake_case), the admin API shape (camelCase), a widget
    // response envelope ({ok,data}), or a previous repro bundle's report.json.
    const t = raw?.data && raw.ok !== undefined ? raw.data : raw?.ticket || raw?.report || raw;
    return {
      source: `file:${path.resolve(flags['from-file'])}`,
      ticket: {
        id: t.id,
        kind: t.kind,
        title: t.title,
        description: t.description,
        steps_to_reproduce: t.steps_to_reproduce ?? t.stepsToReproduce ?? null,
        expected_behavior: t.expected_behavior ?? t.expectedBehavior ?? null,
        actual_behavior: t.actual_behavior ?? t.actualBehavior ?? null,
        reporter_id: t.reporter_id ?? t.reporterId ?? null,
        reporter_verified: t.reporter_verified ?? t.reporterVerified ?? null,
        screenshot_url: t.screenshot_url ?? t.screenshotUrl ?? null,
        metadata: t.metadata ?? null,
        created_at: t.created_at ?? t.createdAt ?? null,
      },
    };
  }
  const id = pos[0];
  if (!id || !UUID_RE.test(id)) fail('Missing ticket id (or --from-file).', 'Usage: control-koe repro <ticketId> | control-koe repro --from-file report.json');
  requireState();
  const t = ticketRow(id);
  if (!t) fail(`No ticket ${id} in the local DB.`, 'Run `control-koe tickets --kind bug`, or export the report as JSON and use --from-file.');
  return { source: `db:${PG}/tickets/${id}`, ticket: t };
}

// What the stored report still lacks for a full auto-reproduction.
function notCaptured(ticket) {
  const m = ticket.metadata || {};
  const gaps = [];
  if (!Array.isArray(m.breadcrumbs)) gaps.push('action trail (metadata.breadcrumbs)');
  if (!Array.isArray(m.console)) gaps.push('console buffer (metadata.console)');
  if (!Array.isArray(m.network)) gaps.push('failed requests (metadata.network)');
  if (!ticket.screenshot_url) gaps.push('screenshot (screenshot_url; host captureScreenshot hook)');
  if (!ticket.expected_behavior) gaps.push('expected behavior (expected_behavior)');
  if (!m.app?.version) gaps.push('host app version (metadata.app)');
  if (!m.widgetVersion) gaps.push('widget version (metadata.widgetVersion)');
  if (!m.input) gaps.push('input capability (metadata.input): touch is not replayed');
  return gaps;
}

function buildReplayPlan(ticket) {
  const m = ticket.metadata || {};
  const missing = [];
  let target = null;
  let originRewritten = null;
  if (typeof m.url === 'string' && m.url) {
    try {
      const u = new URL(m.url);
      target = u.pathname + u.search + u.hash;
      originRewritten = u.origin !== HOST ? { captured: u.origin, replayedOn: HOST } : null;
    } catch {
      missing.push('metadata.url is not a valid URL');
    }
  } else missing.push('metadata.url');
  const validTz = (() => {
    try {
      if (!m.timezone) return null;
      new Intl.DateTimeFormat('en', { timeZone: m.timezone });
      return m.timezone;
    } catch {
      return null;
    }
  })();
  const context = {
    viewport: m.viewport?.width && m.viewport?.height ? { width: m.viewport.width, height: m.viewport.height } : null,
    screen: m.screen?.width && m.screen?.height ? { width: m.screen.width, height: m.screen.height } : null,
    userAgent: m.userAgent || null,
    locale: m.language || null,
    timezoneId: validTz,
    deviceScaleFactor: typeof m.devicePixelRatio === 'number' && m.devicePixelRatio > 0 ? m.devicePixelRatio : null,
  };
  for (const [k, v] of Object.entries(context)) if (v === null) missing.push(`metadata.${k}`);
  // Touch emulation from the captured input capability (widget >= capture-context).
  if (m.input && typeof m.input.maxTouchPoints === 'number') {
    context.hasTouch = m.input.maxTouchPoints > 0;
    context.isMobile = !!m.input.coarsePointer && !m.input.hover;
  } else missing.push('metadata.input');
  return {
    target: target || '/',
    originRewritten,
    referrer: m.referrer || null,
    context,
    reporterId: ticket.reporter_id,
    manualSteps: ticket.steps_to_reproduce ? ticket.steps_to_reproduce.split('\n').map((s) => s.trim()).filter(Boolean) : [],
    expected: ticket.expected_behavior,
    actual: ticket.actual_behavior || ticket.description,
    screenshotUrl: ticket.screenshot_url,
    versions: { widget: m.widgetVersion || null, app: m.app || null },
    reporterMetadata: m.reporterMetadata || null,
    missingFromReport: missing,
    notCaptured: notCaptured(ticket),
    capturedAt: m.capturedAt || null,
    pageLoadedAt: m.pageLoadedAt || null,
  };
}

COMMANDS.repro = {
  summary: 'Replay a stored widget bug report against the local instance; write a repro bundle.',
  help: `control-koe repro <ticketId> [--steps-file steps.json] [--dry-run]
control-koe repro --from-file report.json [--steps-file steps.json] [--dry-run]

Reads the bug report from the throwaway DB (tickets row) or from a JSON export, then replays
what Koe's data model captured:
  - a fresh browser context with the captured viewport, screen, userAgent, language (locale),
    timezone and devicePixelRatio (metadata.* captured by captureBrowserMetadata())
  - the captured page URL (metadata.url) re-targeted onto the local host page
    (${HOST}<path+query+hash>), as the same reporter id (cookie koe_verify_as)
  - optional agent-written --steps-file actions (the report only has free-text steps)
  - console messages, page errors and network requests of the replay
Writes <evidence>/repro-<id>-<ts>/: report.json, plan.json, console.json, network.json,
landed.png, step-N.png, summary.json. The summary compares captured vs replayed environment
and lists what the report could not provide (see features/repro-bug-report.md).
Side effect: page loads on the host page only (the widget heartbeat may stamp
projects.last_ping_at). Nothing is submitted.
--dry-run   print the replay plan without opening a browser.

${STEP_HELP}`,
  async run(flags, pos) {
    const { source, ticket } = loadReport(flags, pos);
    if (ticket.kind && ticket.kind !== 'bug') fail(`Ticket ${ticket.id} is a ${ticket.kind}, not a bug report.`, 'repro only replays bug reports (kind=bug).');
    const plan = buildReplayPlan(ticket);
    let steps = [];
    if (typeof flags['steps-file'] === 'string') {
      steps = JSON.parse(fs.readFileSync(flags['steps-file'], 'utf8'));
      if (!Array.isArray(steps)) fail('--steps-file must contain a JSON array.', STEP_HELP);
    }
    if (flags['dry-run']) return { ok: true, dryRun: true, source, plan, steps };
    const state = requireState();
    const bundle = path.join(evidenceDir(state), `repro-${String(ticket.id || 'file').slice(0, 8)}-${stamp()}`);
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(bundle, 'report.json'), JSON.stringify({ source, ticket }, null, 2));
    fs.writeFileSync(path.join(bundle, 'plan.json'), JSON.stringify({ plan, steps }, null, 2));
    const { chromium } = loadPlaywright();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${PORTS.cdp}`).catch((e) => fail('Browser daemon not reachable.', 'Run `control-koe doctor`.', { error: e.message }));
    const consoleRows = [];
    const networkRows = [];
    const stepResults = [];
    let observed;
    try {
      const c = plan.context;
      const ctx = await browser.newContext({
        ...(c.viewport ? { viewport: c.viewport } : {}),
        ...(c.screen ? { screen: c.screen } : {}),
        ...(c.userAgent ? { userAgent: c.userAgent } : {}),
        ...(c.locale ? { locale: c.locale } : {}),
        ...(c.timezoneId ? { timezoneId: c.timezoneId } : {}),
        ...(c.deviceScaleFactor ? { deviceScaleFactor: c.deviceScaleFactor } : {}),
        ...(typeof c.hasTouch === 'boolean' ? { hasTouch: c.hasTouch, isMobile: c.isMobile } : {}),
      });
      if (plan.reporterId) await ctx.addCookies([{ name: 'koe_verify_as', value: encodeURIComponent(plan.reporterId), url: HOST }]);
      const page = await ctx.newPage();
      // Belt and braces: when the daemon's persistent context had a timezoneId, new
      // contexts inherited it over CDP. The daemon sets none now; force it per page too.
      if (c.timezoneId) {
        const cdp = await ctx.newCDPSession(page);
        await cdp.send('Emulation.setTimezoneOverride', { timezoneId: c.timezoneId }).catch(() => {});
      }
      page.on('console', (m) => consoleRows.push({ ts: new Date().toISOString(), type: m.type(), text: m.text(), url: page.url() }));
      page.on('pageerror', (e) => consoleRows.push({ ts: new Date().toISOString(), type: 'pageerror', text: e.message, url: page.url() }));
      page.on('requestfinished', async (req) => {
        const res = await req.response().catch(() => null);
        networkRows.push({ ts: new Date().toISOString(), method: req.method(), url: req.url(), status: res?.status() ?? null });
      });
      page.on('requestfailed', (req) => networkRows.push({ ts: new Date().toISOString(), method: req.method(), url: req.url(), status: null, failure: req.failure()?.errorText }));
      const resp = await page.goto(HOST + plan.target, { waitUntil: 'networkidle', ...(plan.referrer ? { referer: plan.referrer } : {}) });
      await page.screenshot({ path: path.join(bundle, 'landed.png') });
      observed = await page.evaluate(() => ({
        url: location.href,
        userAgent: navigator.userAgent,
        language: navigator.language,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        viewport: { width: innerWidth, height: innerHeight },
        screen: { width: screen.width, height: screen.height },
        devicePixelRatio: devicePixelRatio,
        maxTouchPoints: navigator.maxTouchPoints,
        coarsePointer: matchMedia('(pointer: coarse)').matches,
      }));
      observed.httpStatus = resp?.status() ?? null;
      for (const [i, s] of steps.entries()) {
        const r = { i: i + 1, step: s };
        try {
          if (s.goto) await page.goto(HOST + s.goto, { waitUntil: 'networkidle' });
          else if (s.click) {
            const k = s.click;
            const loc = k.role ? page.getByRole(k.role, { name: k.name, exact: !!k.exact }) : k.label ? page.getByLabel(k.label) : page.getByText(k.text);
            await loc.first().click({ timeout: 5000 });
          } else if (s.fill) await page.getByLabel(s.fill.label).first().fill(s.fill.value, { timeout: 5000 });
          else if (s.press) await page.keyboard.press(s.press);
          else if (s.wait) await sleep(Number(s.wait));
          else throw new Error('unknown step kind');
          await sleep(400);
          r.ok = true;
        } catch (e) {
          r.ok = false;
          r.error = e.message.split('\n')[0];
        }
        r.screenshot = path.join(bundle, `step-${i + 1}.png`);
        await page.screenshot({ path: r.screenshot }).catch(() => {});
        stepResults.push(r);
      }
      await ctx.close();
    } finally {
      await browser.close().catch(() => {});
    }
    const m = ticket.metadata || {};
    const envMatch = {
      userAgent: !m.userAgent || observed.userAgent === m.userAgent,
      language: !m.language || observed.language === m.language,
      timezone: !m.timezone || observed.timezone === m.timezone,
      viewport: !m.viewport || (observed.viewport.width === m.viewport.width && observed.viewport.height === m.viewport.height),
      devicePixelRatio: !m.devicePixelRatio || observed.devicePixelRatio === m.devicePixelRatio,
      touch: !m.input || (observed.maxTouchPoints > 0) === (m.input.maxTouchPoints > 0),
    };
    const errors = consoleRows.filter((r) => r.type === 'error' || r.type === 'pageerror');
    const failedRequests = networkRows.filter((r) => r.status === null || r.status >= 400);
    fs.writeFileSync(path.join(bundle, 'console.json'), JSON.stringify(consoleRows, null, 2));
    fs.writeFileSync(path.join(bundle, 'network.json'), JSON.stringify(networkRows, null, 2));
    const summary = {
      ok: true,
      ticketId: ticket.id,
      title: ticket.title,
      source,
      bundle,
      replayedUrl: observed.url,
      httpStatus: observed.httpStatus,
      originRewritten: plan.originRewritten,
      envMatch,
      observed,
      stepsReplayed: stepResults.map(({ i, step, ok, error }) => ({ i, step, ok, error })),
      manualStepsFromReport: plan.manualSteps,
      consoleErrors: errors.map((e) => e.text),
      failedRequests,
      missingFromReport: plan.missingFromReport,
      oracle: { expected: plan.expected, actual: plan.actual },
      screenshotUrl: plan.screenshotUrl,
      versions: plan.versions,
      reporterMetadata: plan.reporterMetadata,
      notCaptured: plan.notCaptured,
      verdict: 'Environment and entry URL replayed. Whether the bug reproduces needs a human or agent judgement: compare consoleErrors and the step screenshots with the report description.',
    };
    fs.writeFileSync(path.join(bundle, 'summary.json'), JSON.stringify(summary, null, 2));
    return summary;
  },
};

// ---------- main ----------
function usage() {
  const lines = Object.entries(COMMANDS).map(([k, c]) => `  ${k.padEnd(12)} ${c.summary}`);
  return `control-koe: drive a throwaway local Koe (widget on a fake host SaaS page + admin dashboard).

Usage: control-koe <command> [flags]      (one JSON object on stdout; exit 1 on failure)

Health:       doctor, info, teardown
Lifecycle:    launch
Navigation:   goto, login
Interaction:  widget (open|bug|feature|vote|my-requests), ticket --set-status, click, fill, key
Inspection:   screenshot, snapshot, inbox, tickets, repro
Streaming:    console, network-log

${lines.join('\n')}

Typical run:
  control-koe launch && control-koe doctor
  control-koe widget bug --title "Export does nothing" --description "..." --trigger-error
  control-koe tickets --id <ticketId>         # second read: the DB row
  control-koe login && control-koe inbox --expect <ticketId>
  control-koe repro <ticketId>
  control-koe teardown

URLs: host page ${HOST}  dashboard ${DASH}/  api ${API}
Evidence: ${EVIDENCE_ROOT}/<runId>/ (KOE_EVIDENCE_DIR), survives teardown; every call is
appended to <runId>/transcript.txt. Commands with side effects accept --dry-run.
\`control-koe <command> --help\` for details.`;
}

async function main() {
  const argv = process.argv.slice(2);
  const [cmd, ...rest] = argv;
  if (cmd === '__browserd') return browserd();
  if (cmd === '__hostd') return hostd();
  if (!cmd || cmd === '--help' || cmd === '-h' || cmd === 'help') {
    process.stdout.write(usage() + '\n');
    return;
  }
  const c = COMMANDS[cmd];
  if (!c) {
    out({ ok: false, error: `Unknown command "${cmd}".`, fix: `Run \`control-koe --help\`. Commands: ${Object.keys(COMMANDS).join(', ')}` });
    process.exitCode = 1;
    return;
  }
  const { pos, flags } = parseArgs(rest);
  if (flags.help || flags.h) {
    process.stdout.write(c.help + '\n');
    return;
  }
  // teardown deletes the state; resolve the transcript path first.
  const preState = readState();
  let text;
  try {
    text = out(await c.run(flags, pos));
  } catch (e) {
    text = out({ ok: false, command: cmd, error: e.message.split('\n')[0], fix: e.fix || 'Run `control-koe doctor` and read .verify-run/logs/.', ...(e.extra || {}) });
    process.exitCode = 1;
  }
  const state = readState() || preState;
  if (state) {
    try {
      fs.appendFileSync(path.join(evidenceDir(state), 'transcript.txt'), `$ control-koe ${argv.join(' ')}\n${text}\n\n`);
    } catch {}
  }
}
main();
