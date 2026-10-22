#!/usr/bin/env node
// WebCAD agent CLI. Live commands talk to the WebCAD tab open in a browser through the dev /
// preview server bridge; `build` runs headless (OpenCascade in Node, no browser needed).
// Reference: docs/agent-api.md

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const URLS = process.env.WEBCAD_URL ? [process.env.WEBCAD_URL] : ['http://localhost:5173', 'http://localhost:4173'];

const USAGE = `WebCAD agent CLI — npm run agent -- <command> …

Live (the app must be open in a browser tab served by \`npm run dev\` or \`npm run serve\`):
  status                          connected WebCAD tabs (id, browser, open document)
  --tab <id>                      target tab, required when several tabs are connected (or WEBCAD_TAB)
  docs                            list documents
  open <id|name> | create <name>  open / create a document in the tab
  state                           features, variables, parts (bbox, volume), sketch frames; an assembly's instances
                                  and mates; a drawing's views, dimensions, notes, bill of materials
  run <ops.json|-|'[…]'> [--keep-failed]
                                  apply ops (one undo step); by default nothing changes if a feature fails;
                                  version / branch / workspace / merge ops are applied at once, in order
  versions                        the document's versions, its workspace (branch) and the others
  query '<json>'                  e.g. '{"edges":{"dir":"z"}}' — matching faces / edges with geometry
  measure '<json>'                the same queries → the measure panel: distances (min / max / centres), angle, totals
  animate '<json>'                e.g. '{"mate":"Revolute 1","from":0,"to":90,"frames":4}' — where the moving
                                  instances are at each frame of a mate's motion (nothing changes)
  feature <name>                  raw feature JSON
  undo | redo | cancel-edit
  shot <out.png> [view] [--exploded "<name>"] [--amount 0…1]
                                  screenshot of the graphics area (view: iso, top, front, right, fit…); an
                                  assembly's exploded view by name, exploded that far
  export <stl|step|webcad|pdf|svg|dxf> <out> [--drawing "<name>"]
                                  export the open document; pdf / svg / dxf — a drawing (the active one by default)
  call <method> [json args…]      any window.webcad method

Headless (no browser):
  build <ops.json> [--doc in.webcad.json] [--out out.webcad.json] [--stl f.stl] [--step f.step]
        [--pdf f.pdf] [--svg f.svg] [--dxf f.dxf] [--drawing "<name>"] [--lang ru|en] [--name "Doc name"]
                                  run ops on a document file and print the report; the .webcad.json
                                  can be imported in the app (Documents → Import); --pdf / --svg / --dxf —
                                  a drawing of it (the active one, else the first; or --drawing); --lang — the
                                  language of its title block, section letters, callouts (default: the system's)

Environment: WEBCAD_URL (default http://localhost:5173, then :4173)`;

function readJsonArg(a) {
  if (a === undefined) throw new Error('JSON argument expected');
  if (a === '-') return JSON.parse(readFileSync(0, 'utf8'));
  const t = a.trim();
  if (t.startsWith('[') || t.startsWith('{')) return JSON.parse(t);
  return JSON.parse(readFileSync(resolve(a), 'utf8'));
}

function parseValue(a) {
  if (a.startsWith('@')) return JSON.parse(readFileSync(resolve(a.slice(1)), 'utf8'));
  try {
    return JSON.parse(a);
  } catch {
    return a;
  }
}

async function post(base, path, body) {
  const res = await fetch(`${base}/__webcad/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-webcad': 'cli' },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`${base} is not a WebCAD dev/preview server (HTTP ${res.status})`);
  }
  return { status: res.status, json };
}

async function server() {
  const errors = [];
  for (const base of URLS) {
    try {
      const { json } = await post(base, 'status');
      if (json.ok) return { base, status: json };
    } catch (e) {
      errors.push(`${base}: ${e.message}`);
    }
  }
  throw new Error(`No WebCAD server found (start it with \`npm run dev\`). ${errors.join('; ')}`);
}

let TAB = process.env.WEBCAD_TAB;

async function call(method, ...args) {
  const { base } = await server();
  const { status: code, json } = await post(base, 'rpc', { method, args, tab: TAB });
  if (code !== 200) {
    const tabs = json.tabs?.length ? `\nConnected tabs:\n${json.tabs.map((t) => `  ${t.id}  ${t.browser}  ${t.document ?? '(document list)'}`).join('\n')}` : '';
    throw new Error(`${json.error ?? `HTTP ${code}`}${tabs}`);
  }
  return json.result;
}

const out = (v) => process.stdout.write(`${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}\n`);

function flag(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return undefined;
  const v = args[i + 1];
  args.splice(i, 2);
  return v;
}

async function headless(args) {
  const docPath = flag(args, '--doc');
  const outPath = flag(args, '--out');
  const stl = flag(args, '--stl');
  const step = flag(args, '--step');
  const sheets = { pdf: flag(args, '--pdf'), svg: flag(args, '--svg'), dxf: flag(args, '--dxf') };
  const drawing = flag(args, '--drawing');
  const lang = flag(args, '--lang');
  const name = flag(args, '--name');
  const ops = readJsonArg(args[0]);
  const { runnerImport } = await import('vite');
  const { module: h } = await runnerImport(resolve(ROOT, 'src/agent/headless.ts'), { root: ROOT, logLevel: 'error' });
  if (lang === 'ru' || lang === 'en') h.setLang(lang);
  else if (lang !== undefined) throw new Error('--lang ru | en');
  const wasm = resolve(ROOT, 'node_modules/replicad-opencascadejs/dist/replicad_single.wasm');
  const doc = docPath ? JSON.parse(readFileSync(resolve(docPath), 'utf8')) : h.emptyDocument(name ?? 'Agent model');
  const s = await h.openHeadless(doc, wasm);
  const report = await s.run(Array.isArray(ops) ? ops : ops.ops);
  if (report.applied) {
    if (outPath) writeFileSync(resolve(outPath), JSON.stringify(s.doc));
    if (stl) writeFileSync(resolve(stl), await s.exportStl());
    if (step) writeFileSync(resolve(step), await s.exportStep());
    for (const [format, file] of Object.entries(sheets)) if (file) writeFileSync(resolve(file), await s.exportDrawing(format, drawing));
  }
  out(report);
  if (!report.ok) process.exitCode = 1;
}

async function main() {
  const argv = process.argv.slice(2);
  TAB = flag(argv, '--tab') ?? TAB;
  const [cmd, ...args] = argv;
  switch (cmd) {
    case undefined:
    case 'help':
    case '--help':
      return out(USAGE);
    case 'status':
      return out(await server());
    case 'docs':
      return out(await call('documents'));
    case 'open':
      return out(await call('open', args.join(' ')));
    case 'create':
      return out(await call('create', args.join(' ') || 'Agent model'));
    case 'state':
      return out(await call('state'));
    case 'versions':
      return out(await call('versions'));
    case 'run': {
      const keep = args.includes('--keep-failed');
      const rest = args.filter((a) => a !== '--keep-failed');
      const report = await call('run', readJsonArg(rest[0]), { atomic: !keep });
      out(report);
      if (!report.ok) process.exitCode = 1;
      return;
    }
    case 'query':
      return out(await call('query', readJsonArg(args[0])));
    case 'measure':
      return out(await call('measure', readJsonArg(args[0])));
    case 'animate':
      return out(await call('animate', readJsonArg(args[0])));
    case 'feature':
      return out(await call('feature', args.join(' ')));
    case 'undo':
    case 'redo':
      return out(await call(cmd));
    case 'cancel-edit':
      return out(await call('cancelEdit'));
    case 'shot': {
      // shot <out.png> [view] [--exploded "<name>"] [--amount 0…1]
      const flag = (name) => {
        const i = args.indexOf(name);
        if (i < 0) return undefined;
        const v = args[i + 1];
        args.splice(i, 2);
        return v;
      };
      const exploded = flag('--exploded');
      const amount = flag('--amount');
      if (!args[0]) throw new Error('shot <out.png> [view] [--exploded "<name>"] [--amount 0…1]');
      const url = await call('screenshot', { ...(args[1] ? { view: args[1] } : {}), ...(exploded !== undefined ? { exploded } : {}), ...(amount !== undefined ? { amount: Number(amount) } : {}) });
      writeFileSync(resolve(args[0]), Buffer.from(String(url).split(',')[1], 'base64'));
      return out(`saved ${resolve(args[0])}`);
    }
    case 'export': {
      const drawing = flag(args, '--drawing');
      if (!args[0] || !args[1]) throw new Error('export <stl|step|webcad|pdf|svg|dxf> <out> [--drawing "<name>"]');
      const r = await call('export', args[0], ...(drawing !== undefined ? [drawing] : []));
      writeFileSync(resolve(args[1]), Buffer.from(r.base64, 'base64'));
      return out(`saved ${resolve(args[1])} (${r.mime})`);
    }
    case 'call':
      return out(await call(args[0], ...args.slice(1).map(parseValue)));
    case 'build':
      return headless(args);
    default:
      throw new Error(`Unknown command "${cmd}"\n\n${USAGE}`);
  }
}

main().catch((e) => {
  process.stderr.write(`error: ${e.message}\n`);
  process.exitCode = 1;
});
