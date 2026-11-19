// Optional transport for an already open browser. Authentication stays inside its WebCAD tab.
const CALL_TIMEOUT = 180000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

function endpointUrl(endpoint) {
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    throw new Error('CDP endpoint must be an HTTP(S) origin.');
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('CDP endpoint must be an HTTP(S) origin.');
  return url;
}

function allowedPage(target) {
  if (target?.type !== 'page' || typeof target.id !== 'string' || !target.id) return false;
  try {
    const url = new URL(target.url);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return false;
    if (LOOPBACK.has(url.hostname) || (url.protocol === 'https:' && url.hostname === 'cad.ya-erm.ru')) return true;
    if (process.env.WEBCAD_URL) {
      const configured = new URL(process.env.WEBCAD_URL);
      return !configured.username && !configured.password && url.origin === configured.origin;
    }
  } catch {
    /* An invalid browser target is never selected. */
  }
  return false;
}

async function targets(endpoint) {
  const base = endpointUrl(endpoint);
  try {
    const response = await fetch(new URL('/json/list', base), { redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error();
    const data = await response.json();
    if (!Array.isArray(data) || data.length > 1000) throw new Error();
    const pages = data.filter(allowedPage);
    if (new Set(pages.map((page) => page.id)).size !== pages.length) throw new Error();
    return { base, pages };
  } catch {
    throw new Error('Cannot read browser CDP targets. Check the debugging endpoint and that the browser is running.');
  }
}

function socketUrl(target, base) {
  try {
    const url = new URL(target.webSocketDebuggerUrl);
    const protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    const sameHost = url.hostname === base.hostname || (LOOPBACK.has(url.hostname) && LOOPBACK.has(base.hostname));
    const port = url.port || (url.protocol === 'wss:' ? '443' : '80');
    const basePort = base.port || (base.protocol === 'https:' ? '443' : '80');
    if (
      url.protocol !== protocol ||
      !sameHost ||
      port !== basePort ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !/^\/devtools\/page\/[^/]+$/.test(url.pathname)
    )
      throw new Error();
    return url.href;
  } catch {
    throw new Error('Selected tab has an unsafe or unavailable CDP socket.');
  }
}

export async function cdpStatus(endpoint) {
  const { base, pages } = await targets(endpoint);
  return {
    base: base.origin,
    status: {
      ok: true,
      appConnected: pages.length > 0,
      tabs: pages.map((page) => ({ id: page.id, document: typeof page.title === 'string' ? page.title : null, browser: 'Chrome (CDP)' })),
      queued: 0,
    },
  };
}

export async function cdpCall(endpoint, tab, method, args) {
  if (typeof globalThis.WebSocket !== 'function') throw new Error('CDP transport requires Node.js 22 or newer with built-in WebSocket.');
  if (typeof method !== 'string' || !method || !Array.isArray(args))
    throw new Error('CDP call requires a method name and an argument array.');
  const { base, pages } = await targets(endpoint);
  let target;
  if (tab) target = pages.find((page) => page.id === tab);
  else {
    if (pages.length > 1) throw new Error('Several WebCAD tabs are available: choose one with --tab <id> (or WEBCAD_TAB).');
    target = pages[0];
  }
  if (!target)
    throw new Error(
      tab
        ? 'The selected WebCAD tab is not available at this CDP endpoint.'
        : 'No WebCAD tab is open. Open WebCAD and sign in in the browser.',
    );
  const url = socketUrl(target, base);
  let expression;
  try {
    expression = `(async()=>{if(location.origin!==${JSON.stringify(new URL(target.url).origin)})throw new Error("WebCAD tab navigated");const api=window.webcad;const method=${JSON.stringify(method)};if(!api||!Object.hasOwn(api,method)||typeof api[method]!=="function")throw new Error("WebCAD method unavailable");return await api[method](...JSON.parse(${JSON.stringify(JSON.stringify(args))}));})()`;
  } catch {
    throw new Error('CDP arguments must be JSON serializable.');
  }
  return new Promise((resolve, reject) => {
    let socket,
      timer,
      settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (socket) {
        socket.removeEventListener('open', open);
        socket.removeEventListener('message', message);
        socket.removeEventListener('error', failed);
        socket.removeEventListener('close', closed);
        try {
          socket.close();
        } catch {
          /* The connection may already be gone. */
        }
      }
      if (error) reject(new Error(error));
      else resolve(value);
    };
    const failed = () => finish('Browser CDP connection failed.');
    const closed = () => finish('Browser CDP connection closed before WebCAD replied.');
    const open = () => {
      try {
        socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
      } catch {
        failed();
      }
    };
    const message = (event) => {
      let response;
      try {
        response = JSON.parse(String(event.data));
      } catch {
        finish('Browser returned an invalid CDP response.');
        return;
      }
      if (response.id !== 1) return;
      if (response.error || response.result?.exceptionDetails || !response.result?.result) {
        finish('WebCAD method failed in the selected tab. Check that WebCAD is loaded and signed in.');
        return;
      }
      finish(null, response.result.result.value);
    };
    timer = setTimeout(() => finish('Timed out waiting for the selected WebCAD tab.'), CALL_TIMEOUT);
    try {
      socket = new globalThis.WebSocket(url);
      socket.addEventListener('open', open);
      socket.addEventListener('message', message);
      socket.addEventListener('error', failed);
      socket.addEventListener('close', closed);
    } catch {
      failed();
    }
  });
}
