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
  ProjectionRequest,
  ProjectionResult,
  ViewAnchorRequest,
  ViewAnchorResult,
  ViewRefsRequest,
  ViewRefsResult,
  WorkerRequest,
  WorkerResponse,
} from './protocol';

type Pending = { resolve: (v: WorkerResponse) => void; reject: (e: Error) => void };

type Omitted<T> = Omit<T, 'type' | 'reqId'>;

export class SupersededError extends Error {}

class KernelClient {
  private worker: Worker;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private readyPromise: Promise<void>;
  private resolveReady!: () => void;
  isReady = false;
  readyListeners = new Set<() => void>();

  constructor() {
    this.readyPromise = new Promise((r) => (this.resolveReady = r));
    this.worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => this.onMessage(ev.data);
    this.worker.onerror = (ev) => console.error('Geometry worker error', ev);
  }

  private onMessage(msg: WorkerResponse) {
    if (msg.type === 'ready') {
      this.isReady = true;
      this.resolveReady();
      this.readyListeners.forEach((l) => l());
      return;
    }
    if (msg.type === 'progress') return;
    const p = this.pending.get(msg.reqId);
    if (!p) return;
    this.pending.delete(msg.reqId);
    if (msg.type === 'error') {
      p.reject(msg.message === 'superseded' ? new SupersededError('superseded') : new Error(msg.message));
    } else p.resolve(msg);
  }

  private send<R extends WorkerResponse>(req: Omitted<WorkerRequest> & { type: WorkerRequest['type'] }): Promise<R> {
    const reqId = this.nextId++;
    return new Promise<R>((resolve, reject) => {
      this.pending.set(reqId, { resolve: resolve as (v: WorkerResponse) => void, reject });
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
}

let instance: KernelClient | null = null;

export function kernel(): KernelClient {
  if (!instance) instance = new KernelClient();
  return instance;
}
