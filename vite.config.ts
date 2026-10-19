import type { IncomingMessage, ServerResponse } from 'node:http'
import { execSync } from 'node:child_process'
import react from '@vitejs/plugin-react'
import { defineConfig, type Connect, type Plugin } from 'vite'

/** The app's version shown in the status bar: the date and short hash of the commit it is built from. */
function appVersion(): { date: string; sha: string } {
  const git = (args: string) => {
    try {
      return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
    } catch {
      return ''
    }
  }
  return { date: git('log -1 --format=%cs') || new Date().toISOString().slice(0, 10), sha: git('rev-parse --short HEAD') || 'local' }
}

/**
 * Agent bridge: command-line agents POST /__webcad/rpc {method, args, tab?}; every open WebCAD
 * tab long-polls /__webcad/poll with its tab id, runs window.webcad[method](...args) and posts
 * /__webcad/reply. With several tabs connected a call must name its tab (no surprises in a tab
 * the user is working in). Only same-origin / non-browser requests are accepted.
 */
function agentBridge(): Plugin {
  type Job = { id: string; method: string; args: unknown[]; tab: string; res: ServerResponse; timer: ReturnType<typeof setTimeout> }
  type Poller = { tab: string; res: ServerResponse; timer: ReturnType<typeof setTimeout> }
  type Tab = { id: string; lastSeen: number; document: string | null; browser: string }
  const queue: Job[] = []
  const inflight = new Map<string, Job>()
  const tabs = new Map<string, Tab>()
  let pollers: Poller[] = []
  let seq = 0

  const browserOf = (ua = '') =>
    /Electron|Claude/.test(ua) ? 'Claude app' : /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'browser'
  const connected = () => [...tabs.values()].filter((t) => Date.now() - t.lastSeen < 35000 || pollers.some((p) => p.tab === t.id))

  const send = (res: ServerResponse, code: number, body?: unknown) => {
    if (res.writableEnded || res.destroyed) return
    res.statusCode = code
    res.setHeader('cache-control', 'no-store')
    if (body === undefined) return void res.end()
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(body))
  }
  const readJson = (req: IncomingMessage) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      let s = ''
      req.setEncoding('utf8')
      req.on('data', (c: string) => (s += c))
      req.on('end', () => {
        try {
          resolve(s ? (JSON.parse(s) as Record<string, unknown>) : {})
        } catch (e) {
          reject(e)
        }
      })
      req.on('error', reject)
    })
  const dispatch = () => {
    pollers = pollers.filter((p) => !p.res.writableEnded && !p.res.destroyed)
    for (const job of [...queue]) {
      const p = pollers.find((x) => x.tab === job.tab)
      if (!p) continue
      queue.splice(queue.indexOf(job), 1)
      pollers = pollers.filter((x) => x !== p)
      clearTimeout(p.timer)
      inflight.set(job.id, job)
      send(p.res, 200, { id: job.id, method: job.method, args: job.args })
    }
  }
  const handler: Connect.NextHandleFunction = (req, res, next) => {
    const m = /\/__webcad\/(rpc|poll|reply|status)(?:[?#]|$)/.exec(req.url ?? '')
    if (!m) return next()
    const site = req.headers['sec-fetch-site']
    const origin = req.headers.origin
    if ((site && site !== 'same-origin' && site !== 'none') || (origin && new URL(origin).host !== req.headers.host))
      return send(res, 403, { error: 'cross-site requests are not allowed' })
    if (req.method !== 'POST' || !req.headers['x-webcad']) return send(res, 400, { error: 'POST with an x-webcad header expected' })
    const tabList = () => connected().map(({ id, document, browser }) => ({ id, document, browser }))
    switch (m[1]) {
      case 'status':
        return send(res, 200, { ok: true, appConnected: connected().length > 0, tabs: tabList(), queued: queue.length })
      case 'poll':
        return void readJson(req).then(
          (body) => {
            const id = String(body.tab ?? '')
            if (!id) return send(res, 400, { error: 'tab expected' })
            tabs.set(id, { id, lastSeen: Date.now(), document: typeof body.document === 'string' ? body.document : null, browser: browserOf(req.headers['user-agent']) })
            const p: Poller = { tab: id, res, timer: setTimeout(() => send(res, 204), 25000) }
            res.on('close', () => {
              clearTimeout(p.timer)
              pollers = pollers.filter((x) => x !== p)
            })
            pollers.push(p)
            dispatch()
          },
          () => send(res, 400, { error: 'bad JSON' }),
        )
      case 'reply':
        return void readJson(req).then(
          (body) => {
            const job = inflight.get(String(body.id))
            if (job) {
              inflight.delete(job.id)
              clearTimeout(job.timer)
              send(job.res, body.error ? 500 : 200, body.error ? { error: body.error } : { result: body.result ?? null })
            }
            send(res, 200, { ok: true })
          },
          () => send(res, 400, { error: 'bad JSON' }),
        )
      case 'rpc':
        return void readJson(req).then(
          (body) => {
            if (typeof body.method !== 'string') return send(res, 400, { error: 'method expected' })
            const live = connected()
            let tab = typeof body.tab === 'string' && body.tab ? body.tab : ''
            if (!tab) {
              if (live.length > 1)
                return send(res, 409, { error: 'several WebCAD tabs are connected: choose one with --tab <id> (or WEBCAD_TAB)', tabs: tabList() })
              if (live.length === 1) tab = live[0].id
            } else if (!tabs.has(tab)) return send(res, 404, { error: `no WebCAD tab "${tab}"`, tabs: tabList() })
            if (!tab) return send(res, 503, { error: 'no WebCAD tab is connected: open the app (this server) in a browser' })
            const id = `j${++seq}`
            const wait = Math.min(Number(body.timeoutMs) || 180000, 900000)
            const job: Job = {
              id,
              method: body.method,
              args: Array.isArray(body.args) ? body.args : [],
              tab,
              res,
              timer: setTimeout(() => {
                const i = queue.indexOf(job)
                if (i >= 0) queue.splice(i, 1)
                inflight.delete(id)
                send(res, 504, { error: `timed out waiting for WebCAD tab ${tab}` })
              }, wait),
            }
            queue.push(job)
            dispatch()
          },
          () => send(res, 400, { error: 'bad JSON' }),
        )
    }
  }
  return {
    name: 'webcad-agent-bridge',
    configureServer: (server) => void server.middlewares.use(handler),
    configurePreviewServer: (server) => void server.middlewares.use(handler),
  }
}

/**
 * Generates a service worker that precaches every build artefact (including the
 * OpenCascade WASM) so the app works fully offline after the first visit.
 */
function offline(): Plugin {
  return {
    name: 'webcad-offline',
    apply: 'build',
    generateBundle(_opts, bundle) {
      const publicFiles = ['./icon.svg', './manifest.webmanifest']
      const files = ['./', './index.html', ...publicFiles, ...Object.keys(bundle).filter((f) => f !== 'index.html').map((f) => `./${f}`)]
      const version = Date.now().toString(36)
      const sw = `// Generated by vite.config.ts — precaches the whole app for offline use.
const CACHE = 'webcad-${version}';
const ASSETS = ${JSON.stringify(files)};
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('webcad-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  // the page itself: from the network while online (a new version shows on a plain reload), the cache offline
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('./index.html', copy));
          }
          return res;
        })
        .catch(() => caches.match('./index.html', { ignoreVary: true })),
    );
    return;
  }
  // the rest (file names with content hashes): from the cache, the network when missing
  e.respondWith(
    caches.match(req, { ignoreSearch: true, ignoreVary: true }).then((hit) => {
      if (hit) return hit;
      return fetch(req)
        .then((res) => {
          if (res.ok && res.type === 'basic') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => (req.mode === 'navigate' ? caches.match('./index.html', { ignoreVary: true }) : Response.error()));
    }),
  );
});
`
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  // relative base: the build can be served from any folder of any static server
  base: './',
  plugins: [react(), offline(), agentBridge()],
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  worker: { format: 'es' },
  // Full-page HMR reloads would drop unsaved sketch edits; reload manually instead.
  server: { hmr: false },
  optimizeDeps: { exclude: ['replicad-opencascadejs'] },
  build: { target: 'es2022', chunkSizeWarningLimit: 4000 },
  // drafts in temp/ (copies of the project too) are not tested
  test: { environment: 'node', exclude: ['**/node_modules/**', '**/dist/**', 'temp/**'] },
} as never)
