/** One upload lane per origin, shared by manual uploads and background tabs. */
const NAME = 'webcad-cloud-upload';
let database: Promise<IDBDatabase> | undefined;
function leaseDb() {
  return (database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open('webcad-cloud-coordination', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('leases');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}
async function lease(owner: string, release = false): Promise<boolean> {
  const db = await leaseDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('leases', 'readwrite'),
      store = transaction.objectStore('leases');
    let owned = false;
    const read = store.get(NAME);
    read.onsuccess = () => {
      const current = read.result as
        | {
            owner: string;
            expires: number;
          }
        | undefined;
      if (current?.owner === owner || (!release && (!current || current.expires < Date.now()))) {
        owned = true;
        if (release) store.delete(NAME);
        else store.put({ owner, expires: Date.now() + 360000 }, NAME);
      }
    };
    transaction.oncomplete = () => resolve(owned);
    transaction.onerror = transaction.onabort = () => reject(transaction.error);
  });
}
export async function withCloudUploadLock<T>(
  fn: (signal?: AbortSignal) => Promise<T>,
  options: {
    signal?: AbortSignal;
    ifAvailable?: boolean;
  } = {},
): Promise<T | undefined> {
  options.signal?.throwIfAborted();
  if (navigator.locks) {
    return navigator.locks.request(
      NAME,
      // Web Locks forbids signal together with ifAvailable. There is no queued wait to cancel.
      options.ifAvailable ? { ifAvailable: true } : options.signal ? { signal: options.signal } : {},
      (lock) => {
        options.signal?.throwIfAborted();
        return lock ? fn(options.signal) : Promise.resolve(undefined);
      },
    );
  }
  const owner = crypto.randomUUID();
  while (!(await lease(owner))) {
    if (options.ifAvailable) return undefined;
    options.signal?.throwIfAborted();
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const controller = new AbortController();
  const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
  const renew = setInterval(() => {
    void lease(owner)
      .then((owned) => {
        if (!owned) controller.abort();
      })
      .catch(() => controller.abort());
  }, 15000);
  try {
    signal.throwIfAborted();
    return await fn(signal);
  } finally {
    clearInterval(renew);
    await lease(owner, true);
  }
}
/** Read/write these only while owning the upload lane, so tabs share the quiet gap. */
export function cloudUploadSlotAvailable(owner: string, now: number, gap: number): boolean {
  try {
    const last = Number(localStorage.getItem('webcad.cloudUploadAt.' + owner) ?? 0);
    return !Number.isFinite(last) || now - last >= gap;
  } catch {
    return true;
  }
}
export function recordCloudUploadTime(owner: string, now: number): void {
  try {
    localStorage.setItem('webcad.cloudUploadAt.' + owner, String(now));
  } catch {
    /* The native lock still prevents overlapping requests. */
  }
}
