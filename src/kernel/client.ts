// UI-thread facade for the geometry worker.

import type {
  BuildRequest,
  BuildResult,
  ExportRequest,
  ExportResult,
  MeasureRequest,
  MeasureResult,
  MeshRequest,
  MeshResult,
  PlacedPart,
  ProjectionRequest,
  ProjectionResult,
  ViewAnchorRequest,
  ViewAnchorResult,
  ViewRefsRequest,
  ViewPartRequest,
  ViewPartResult,
  ViewRefsResult,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

type Pending = { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void };

type Omitted<T> = Omit<T, 'type' | 'reqId'>;

export class SupersededError extends Error {}

/**
 * The worker was started anew (its kernel failed or hung) while the request waited: nothing to report for it —
 * whoever needs the result asks again (the model is rebuilt).
 */
export class KernelRestartedError extends SupersededError {}

/** With requests waiting and no answer for this long, the kernel is taken as hung and started anew. */
export const KERNEL_HANG_MS = 180_000;

export class KernelClient {
  private worker!: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readyPromise!: Promise<void>;
  private resolveReady!: () => void;
  /** When the worker last answered (or a request was sent to an idle one): for the hang watchdog. */
  private lastSign = Date.now();
  private watchdog: ReturnType<typeof setInterval> | null = null;
  isReady = false;
  readyListeners = new Set<() => void>();
  /** The worker was started anew: why (the kernel failed, hung). Its builders are gone — build again. */
  restartListeners = new Set<(reason: string) => void>();

  constructor() {
    this.start();
  }

  private start() {
    this.isReady = false;
    this.readyPromise = new Promise((r) => (this.resolveReady = r));
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
    // an error the worker did not catch (its script, the kernel aborting): it cannot be trusted any more
    this.worker.onerror = (ev) => {
      console.error('Geometry worker error', ev);
      ev.preventDefault();
      this.restart(ev.message || 'The geometry kernel failed');
    };
  }

  /**
   * Start the worker anew: the requests waiting fail (`KernelRestartedError`), the listeners hear why (to rebuild
   * the model). Used when the kernel failed fatally or hung.
   */
  restart(reason: string) {
    console.warn('Restarting the geometry worker:', reason);
    this.worker.onmessage = null;
    this.worker.onerror = null;
    this.worker.terminate();
    const waiting = [...this.pending.values()];
    this.pending.clear();
    this.stopWatchdog();
    this.start();
    for (const p of waiting) p.reject(new KernelRestartedError(reason));
    this.restartListeners.forEach((l) => l(reason));
  }

  private onMessage(msg: WorkerResponse) {
    this.lastSign = Date.now();
    if (msg.type === 'ready') {
      this.isReady = true;
      this.resolveReady();
      this.readyListeners.forEach((l) => l());
      return;
    }
    if (msg.type === 'progress') return;
    const p = this.pending.get(msg.reqId);
    if (p) this.pending.delete(msg.reqId);
    if (!this.pending.size) this.stopWatchdog();
    if (msg.type === 'error') {
      p?.reject(msg.message === 'superseded' ? new SupersededError('superseded') : new Error(msg.message));
      // the kernel's own memory may be broken: a new one before the next request
      if (msg.fatal) this.restart(msg.message);
    } else p?.resolve(msg);
  }

  private stopWatchdog() {
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = null;
  }

  /** While requests wait: no answer for `KERNEL_HANG_MS` — the kernel hung (an operation that never ends). */
  private watch() {
    if (this.watchdog) return;
    this.lastSign = Date.now();
    this.watchdog = setInterval(() => {
      if (!this.pending.size) return this.stopWatchdog();
      if (Date.now() - this.lastSign > KERNEL_HANG_MS) this.restart('The geometry kernel did not answer for too long');
    }, 5000);
  }

  private send<R extends WorkerResponse>(req: Omitted<WorkerRequest> & { type: WorkerRequest['type'] }): Promise<R> {
    const reqId = this.nextId++;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (v: WorkerResponse) => void, reject });
      this.watch();
      this.worker.postMessage({ ...req, reqId } as WorkerRequest);
    });
  }

  ready() {
    return this.readyPromise;
  }

  build(studioKey: string, req: Omitted<BuildRequest>): Promise<BuildResult> {
    return this.send<BuildResult>({ ...req, type: 'build', studioKey } as never);
  }

  exportFile(req: Omitted<ExportRequest>): Promise<ExportResult> {
    return this.send<ExportResult>({ ...req, type: 'export' } as never);
  }

  mesh(req: Omitted<MeshRequest>): Promise<MeshResult> {
    return this.send<MeshResult>({ ...req, type: 'mesh' } as never);
  }

  measure(req: Omitted<MeasureRequest>): Promise<MeasureResult> {
    return this.send<MeasureResult>({ ...req, type: 'measure' } as never);
  }

  projection(req: Omitted<ProjectionRequest>): Promise<ProjectionResult> {
    return this.send<ProjectionResult>({ ...req, type: 'projection' } as never);
  }

  viewAnchor(req: Omitted<ViewAnchorRequest>): Promise<ViewAnchorResult> {
    return this.send<ViewAnchorResult>({ ...req, type: 'viewAnchor' } as never);
  }

  viewRefs(req: Omitted<ViewRefsRequest>): Promise<ViewRefsResult> {
    return this.send<ViewRefsResult>({ ...req, type: 'viewRefs' } as never);
  }

  viewPart(req: Omitted<ViewPartRequest>): Promise<ViewPartResult> {
    return this.send<ViewPartResult>({ ...req, type: 'viewPart' } as never);
  }

  /** Forget every builder (another document opened): the memory of their shapes goes back to the kernel. */
  reset(): Promise<unknown> {
    return this.send({ type: 'reset' } as never);
  }

  /** An assembly's parts placed as builder `studioKey`'s (its views on drawings project, cut and anchor them). */
  place(studioKey: string, instances: PlacedPart[]): Promise<unknown> {
    return this.send({ type: 'place', studioKey, instances } as never);
  }
}

let instance: KernelClient | null = null;

export function kernel(): KernelClient {
  if (!instance) instance = new KernelClient();
  return instance;
}
