// Regression suite runnable without hardware. Scripts named manual_*, capture-*, profile-* or
// *-current-connection need a real device and are intentionally not listed.
//   npm test                   everything, in parallel (before a commit)
//   npm run test:changed       only the tests related to uncommitted changes
//   npm run test:quick         unit and engine tests only (no Electron UI tests)
// Options: --changed [--since <git ref>], --quick, --jobs <n>, --serial, --list (show the
// selection only), --for <files…> (tests related to these files), or test names
// (e.g. `node scripts/run-tests.cjs workbench-desktop rail_test`).
const { spawn, execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const python = require('../electron/python-path.cjs').pythonPath(root);
const unit = [
  'session-store',
  'export',
  'recording',
  'spectral-metrics',
  'wave-playback',
  'display-filter',
  'usb-network',
  'electrode-metrics',
  'developer',
  'agent-guide',
  'dsp',
  'display-smooth',
  'wechat-modules',
  'wechat-recorder',
  'wechat-scanner',
];
const engine = [
  'rail_test',
  'workbench_metrics_test',
  'sampling_test',
  'data_validity_test',
  'connection_check_test',
  'setup_test',
  'single_contact_test',
  'rail_pipeline_test',
  'alpha_test',
  'discovery_test',
  'engine_smoke',
  'acqclock_test',
  'timing_engine_test',
  'contact_test',
  'wearprobe_test',
  'montage_test',
];
const ui = [
  'workbench-desktop',
  'extended-workbench',
  'connection-wizard',
  'record-desktop',
  'metrics',
  'glossary-desktop',
  'glossary-content',
  'anatomy-atlas',
  'montage-desktop',
  'connection-check-desktop',
];
// Timing-sensitive (acquisition clock): run alone, after the others.
const SERIAL = new Set(['timing_engine_test', 'acqclock_test']);

// Which UI tests exercise which part of the app (for --changed). A changed file matching no
// area but under src/ or electron/ runs SMOKE.
const SMOKE = ['workbench-desktop'];
const AREAS = [
  [
    /^wechat\/|^src\/wechat\/|^src\/engine-ts\/|^scripts\/wechat-lib\.cjs$/,
    ['wechat-modules', 'wechat-recorder', 'wechat-scanner'],
  ],
  [/^src\/glossary\//, ['glossary-desktop', 'anatomy-atlas']],
  [/^content\/glossary\//, ['glossary-content', 'glossary-desktop', 'anatomy-atlas']],
  [/^src\/home\/(BrainRecord|BrainTimeline|MomentPlayer)\.tsx$/, ['record-desktop']],
  [
    /^src\/data\/|^electron\/(dataStore|moments|recording|session|export)\.cjs$/,
    ['record-desktop'],
  ],
  [
    /^src\/home\/displaySmooth\.ts$|^src\/WorkbenchFocus\.tsx$/,
    ['display-smooth', 'workbench-desktop'],
  ],
  [/^src\/lab\/(HeadModel|head3d\/)/, ['workbench-desktop']],
  [
    /^src\/(ConnectionCheck|ContactDiagnostics)\.tsx$|^engine\/(connection_check|wearprobe)\.py$/,
    ['connection-check-desktop'],
  ],
  [
    /^src\/(Workbench|ElectrodeMap|Waveform|AdvancedCharts|SpectralCharts|workbench)|^engine\/(spectral|workbench_metrics|rail)\.py$/,
    ['workbench-desktop', 'extended-workbench'],
  ],
  [
    /^src\/(MontageSettings|electrodes)|^electron\/montage\.cjs$|^engine\/electrodes\.py$/,
    ['montage-desktop'],
  ],
  [/^electron\/metrics\.cjs$/, ['metrics', 'record-desktop']],
  [
    /^src\/(Connection|connection-wizard)|^engine\/connection_(check|setup)\.py$/,
    ['connection-wizard'],
  ],
  [
    /^src\/(shell\/|App|main|tokens|styles|types)|^electron\/(main|preload)\.cjs$|^engine\/main\.py$|^package\.json$/,
    SMOKE,
  ],
];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const forFiles = flag('--for') ? args.slice(args.indexOf('--for') + 1) : null;
const named = (forFiles ? args.slice(0, args.indexOf('--for')) : args).filter(
  (a, i) => !a.startsWith('--') && !['--since', '--jobs'].includes(args[i - 1]),
);

const kinds = new Map([
  ...unit.map((n) => [n, ['node', `tests/${n}.cjs`]]),
  ...engine.map((n) => [n, [python, `tests/${n}.py`]]),
  ...ui.map((n) => [n, ['node', `tests/${n}.cjs`]]),
]);

// ---- --changed: tests related to the changed files -----------------------------------------

function changedFiles(since) {
  const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
  const files = since
    ? git('diff', '--name-only', `${since}...HEAD`) + git('diff', '--name-only', 'HEAD')
    : git('diff', '--name-only', 'HEAD');
  const untracked = git('ls-files', '--others', '--exclude-standard');
  return [...new Set((files + untracked).split(/\r?\n/).filter(Boolean))];
}

// Module name as it appears in an import / require of that file.
const moduleName = (file) => path.basename(file).replace(/\.(cjs|js|ts|tsx|py)$/, '');
const references = (text, name) =>
  new RegExp(`(^|\\n)\\s*(import|from)\\s+${name}\\b|[/'"]${name}(\\.\\w+)?['"]`).test(text);

// Files that depend on `name`, directly or through other source files of the same kind.
function dependents(file) {
  const dir = path.dirname(file);
  if (!['engine', 'electron'].includes(dir)) return [file];
  const ext = dir === 'engine' ? '.py' : '.cjs';
  const sources = fs
    .readdirSync(path.join(root, dir))
    .filter((f) => f.endsWith(ext))
    .map((f) => `${dir}/${f}`);
  const text = Object.fromEntries(
    sources.map((f) => [f, fs.readFileSync(path.join(root, f), 'utf8')]),
  );
  const seen = new Set([file]);
  for (let queue = [file]; queue.length;) {
    const name = moduleName(queue.shift());
    for (const f of sources)
      if (!seen.has(f) && references(text[f], name)) {
        seen.add(f);
        // The entry point imports everything: it only counts when it changed itself.
        if (moduleName(f) !== 'main') queue.push(f);
      }
  }
  if (file !== `${dir}/main${ext}`) seen.delete(`${dir}/main${ext}`);
  return [...seen];
}

function relatedTests(files) {
  const picked = new Set();
  const testText = new Map(
    [...kinds].map(([n, [, f]]) => [n, fs.readFileSync(path.join(root, f), 'utf8')]),
  );
  for (const file of files) {
    const test = [...kinds].find(([, [, f]]) => f === file);
    if (test) {
      picked.add(test[0]);
      continue;
    }
    if (!/^(src|electron|engine)\/|^package\.json$/.test(file)) continue;
    // Unit and engine tests that import the file (or a module built on it).
    const own = file.startsWith('engine/') ? engine : file.startsWith('electron/') ? unit : [];
    for (const dep of dependents(file))
      for (const n of own) if (references(testText.get(n), moduleName(dep))) picked.add(n);
    // UI tests by area.
    const areas = AREAS.filter(([re]) => re.test(file)).flatMap(([, tests]) => tests);
    const fallback = /^(src|electron)\//.test(file) ? SMOKE : [];
    for (const n of areas.length ? areas : fallback) picked.add(n);
  }
  return [...picked];
}

// ---- run ----------------------------------------------------------------------------------

let names;
if (named.length) {
  const unknown = named.filter((n) => !kinds.has(n));
  if (unknown.length) {
    console.error(`未知的测试：${unknown.join(', ')}`);
    process.exit(2);
  }
  names = named;
} else if (forFiles || flag('--changed')) {
  const files = forFiles ?? changedFiles(option('--since'));
  names = relatedTests(files);
  console.log(`${files.length} 个改动文件 → ${names.length} 个相关测试`);
  if (!names.length) process.exit(0);
} else names = [...unit, ...engine, ...ui];
if (flag('--quick')) names = names.filter((n) => !ui.includes(n));
if (flag('--list')) {
  console.log(names.join('\n'));
  process.exit(0);
}

// Longest first (from the last runs) so the slow UI tests start early.
const timesFile = path.join(root, 'test-results', 'durations.json');
let times = {};
try {
  times = JSON.parse(fs.readFileSync(timesFile, 'utf8'));
} catch {
  // First run.
}
const jobs = flag('--serial')
  ? 1
  : Number(option('--jobs')) || Math.max(1, Math.min(6, Math.floor(os.cpus().length / 3)));
const parallel = names
  .filter((n) => !SERIAL.has(n))
  .sort(
    (a, b) => (times[b] ?? (ui.includes(b) ? 60 : 5)) - (times[a] ?? (ui.includes(a) ? 60 : 5)),
  );
const serial = names.filter((n) => SERIAL.has(n));

const failed = [];
function run(name) {
  const [cmd, file] = kinds.get(name);
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(cmd, [file], { cwd: root });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    const timer = setTimeout(() => child.kill(), 600000);
    child.on('close', (code) => {
      clearTimeout(timer);
      const seconds = (Date.now() - started) / 1000;
      times[name] = Math.round(seconds);
      const ok = code === 0;
      console.log(`${ok ? 'PASS' : 'FAIL'}  ${file}  ${seconds.toFixed(1)}s`);
      if (!ok) {
        failed.push(file);
        console.log(out.trim().split(/\r?\n/).slice(-8).join('\n'));
      }
      resolve();
    });
  });
}

(async () => {
  const started = Date.now();
  const queue = [...parallel];
  await Promise.all(
    Array.from({ length: Math.min(jobs, queue.length) }, async () => {
      while (queue.length) await run(queue.shift());
    }),
  );
  for (const name of serial) await run(name);
  fs.mkdirSync(path.dirname(timesFile), { recursive: true });
  fs.writeFileSync(timesFile, JSON.stringify(times, null, 2));
  const total = names.length;
  const minutes = ((Date.now() - started) / 60000).toFixed(1);
  console.log(`\n${total - failed.length}/${total} passed · ${minutes} 分钟 · 并行 ${jobs}`);
  process.exit(failed.length ? 1 : 0);
})();
