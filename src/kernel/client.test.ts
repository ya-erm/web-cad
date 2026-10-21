// The geometry worker's client keeps going when the kernel fails: a fatal error (a WebAssembly trap, out of memory),
// an error the worker did not catch, or no answer for too long — the worker is started anew, the requests waiting
// fail instead of waiting forever, and the listeners hear it (to build the model again).

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkerRequest, WorkerResponse } from './protocol';

/** A worker that answers what the test tells it to. */
class FakeWorker {
  static all: FakeWorker[] = [];
  sent: WorkerRequest[] = [];
  terminated = false;
  onmessage: ((ev: { data: WorkerResponse }) => void) | null = null;
  onerror: ((ev: { message: string; preventDefault(): void }) => void) | null = null;
  constructor() {
    FakeWorker.all.push(this);
  }
  postMessage(req: WorkerRequest) {
    this.sent.push(req);
  }
  terminate() {
    this.terminated = true;
  }
  answer(msg: WorkerResponse) {
    this.onmessage?.({ data: msg });
  }
}

vi.stubGlobal('Worker', FakeWorker);
const { KernelClient, KernelRestartedError, KERNEL_HANG_MS } = await import('./client');

beforeEach(() => {
  FakeWorker.all = [];
  vi.useFakeTimers();
});
afterEach(() => vi.useRealTimers());

const build = (k: InstanceType<typeof KernelClient>) => k.build('ps', { units: { length: 'mm', angle: 'deg' }, features: [], partMeta: {}, upTo: 0 } as never);

describe('kernel client', () => {
  it('answers requests as the worker does', async () => {
    const k = new KernelClient();
    const w = FakeWorker.all[0];
    w.answer({ type: 'ready' });
    expect(k.isReady).toBe(true);
    const p = build(k);
    w.answer({ type: 'build', reqId: w.sent[0].reqId, parts: [] } as never);
    await expect(p).resolves.toMatchObject({ parts: [] });
    // an error of a geometry operation: that request fails, the worker stays
    const q = build(k);
    w.answer({ type: 'error', reqId: w.sent[1].reqId, message: 'Nothing to fillet' });
    await expect(q).rejects.toThrow('Nothing to fillet');
    expect(FakeWorker.all.length).toBe(1);
  });

  it('starts the worker anew after a fatal error; the other requests fail, the listeners hear why', async () => {
    const k = new KernelClient();
    const heard: string[] = [];
    k.restartListeners.add((r) => heard.push(r));
    const w = FakeWorker.all[0];
    const a = build(k);
    const b = k.measure({ studioKey: 'ps', refs: [] } as never);
    w.answer({ type: 'error', reqId: w.sent[0].reqId, message: 'memory access out of bounds', fatal: true });
    await expect(a).rejects.toThrow('memory access out of bounds');
    await expect(b).rejects.toBeInstanceOf(KernelRestartedError);
    expect(w.terminated).toBe(true);
    expect(FakeWorker.all.length).toBe(2);
    expect(heard).toEqual(['memory access out of bounds']);
    // the new worker: not ready until it says so, then it answers
    expect(k.isReady).toBe(false);
    const w2 = FakeWorker.all[1];
    w2.answer({ type: 'ready' });
    expect(k.isReady).toBe(true);
    const c = build(k);
    w2.answer({ type: 'build', reqId: w2.sent[0].reqId, parts: [] } as never);
    await expect(c).resolves.toMatchObject({ parts: [] });
  });

  it('starts the worker anew on an error it did not catch', async () => {
    const k = new KernelClient();
    const a = build(k);
    let prevented = false;
    vi.spyOn(console, 'error').mockImplementation(() => {});
    FakeWorker.all[0].onerror?.({ message: 'Aborted(OOM)', preventDefault: () => (prevented = true) });
    await expect(a).rejects.toBeInstanceOf(KernelRestartedError);
    expect(prevented).toBe(true);
    expect(FakeWorker.all.length).toBe(2);
  });

  it('takes a worker that does not answer for too long as hung', async () => {
    const k = new KernelClient();
    const heard: string[] = [];
    k.restartListeners.add((r) => heard.push(r));
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const a = build(k);
    const failed = expect(a).rejects.toBeInstanceOf(KernelRestartedError);
    // a long build is fine
    await vi.advanceTimersByTimeAsync(KERNEL_HANG_MS - 10_000);
    expect(FakeWorker.all.length).toBe(1);
    await vi.advanceTimersByTimeAsync(20_000);
    await failed;
    expect(FakeWorker.all.length).toBe(2);
    expect(heard).toEqual(['The geometry kernel did not answer for too long']);
    // nothing waiting: no watchdog
    await vi.advanceTimersByTimeAsync(KERNEL_HANG_MS * 2);
    expect(FakeWorker.all.length).toBe(2);
  });
});
