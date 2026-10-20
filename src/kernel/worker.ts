/// <reference lib="webworker" />
// Geometry worker: owns the OpenCascade instance and one StudioBuilder per part studio.

import opencascade from 'replicad-opencascadejs';
import wasmUrl from 'replicad-opencascadejs/wasm?url';
import { setOC } from 'replicad';
import { StudioBuilder, assemblyStepOf, errorMessage, placedShape, stepOf, stlOf } from './build';
import { transferablesOf } from './meshing';
import { loadFonts } from '../sketch/text';
import type { WorkerRequest, WorkerResponse } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const builders = new Map<string, StudioBuilder>();
const builderFor = (key: string) => {
  let b = builders.get(key);
  if (!b) builders.set(key, (b = new StudioBuilder()));
  return b;
};

const ready = (async () => {
  // the fonts of sketch text come with the kernel (without them — no letters, the rest builds)
  const [oc] = await Promise.all([opencascade({ locateFile: () => wasmUrl }), loadFonts().catch(() => undefined)]);
  setOC(oc);
  self.postMessage({ type: 'ready' } satisfies WorkerResponse);
})();

const queue: WorkerRequest[] = [];
let running = false;

function post(msg: WorkerResponse, transfer: Transferable[] = []) {
  self.postMessage(msg, transfer);
}

async function handle(req: WorkerRequest) {
  switch (req.type) {
    case 'ping':
      post({ type: 'ping', reqId: req.reqId });
      return;
    case 'build': {
      // Derived features read the other Part Studios' builders (built before this request)
      const res = await builderFor(req.studioKey).build(req, (key) => builders.get(key));
      const transfer: Transferable[] = [];
      for (const p of res.parts) transfer.push(...transferablesOf(p));
      if (res.preview) {
        for (const p of res.preview.parts) transfer.push(...transferablesOf(p));
        if (res.preview.tool) transfer.push(...transferablesOf(res.preview.tool));
      }
      post(res, transfer);
      return;
    }
    case 'export': {
      // an assembly to STEP: its product tree — every part and sub-assembly once, the instances as placements
      if (req.assemblies?.length && req.format === 'step') {
        const data = await assemblyStepOf(req.assemblies, (studioKey, partId) => builderFor(studioKey).shapesFor([partId])[0], req.unit);
        post({ type: 'export', reqId: req.reqId, data, mime: 'model/step' }, [data.buffer as ArrayBuffer]);
        return;
      }
      // an assembly as one mesh: every instance is its Part Studio's part, placed; otherwise parts of one Part Studio
      const items = req.instances?.length
        ? req.instances.map((p) => {
            const it = builderFor(p.studioKey).shapesFor([p.partId])[0];
            if (!it) throw new Error(`Part is not built: ${p.name}`);
            return { name: p.name, color: it.color, shape: placedShape(it.shape, p) };
          })
        : builderFor(req.studioKey).shapesFor(req.partIds);
      let data: Uint8Array;
      let mime = 'application/octet-stream';
      if (req.format === 'step') {
        data = await stepOf(items, req.unit);
        mime = 'model/step';
      } else if (req.format === 'stl' || req.format === 'stl-ascii') {
        data = await stlOf(items, req.tolerance ?? 0.01, req.angularTolerance ?? 0.2, req.format === 'stl');
        mime = 'model/stl';
      } else {
        throw new Error(`Unsupported format ${req.format}`);
      }
      post({ type: 'export', reqId: req.reqId, data, mime }, [data.buffer as ArrayBuffer]);
      return;
    }
    case 'mesh': {
      const meshes = builderFor(req.studioKey).meshes(req.partIds, req.tolerance, req.angularTolerance);
      post(
        { type: 'mesh', reqId: req.reqId, meshes },
        meshes.flatMap((m) => [m.positions.buffer, m.normals.buffer, m.indices.buffer] as ArrayBuffer[]),
      );
      return;
    }
    case 'measure': {
      const r = builderFor(req.studioKey).measure(req.refs);
      post({ type: 'measure', reqId: req.reqId, ...r });
      return;
    }
    case 'projection': {
      const r = builderFor(req.studioKey).projection(req.partIds, req.orientation, req.hidden, { axes: req.axes, section: req.section, breakout: req.breakout });
      post({ type: 'projection', reqId: req.reqId, ...r });
      return;
    }
  }
}

async function pump() {
  if (running) return;
  running = true;
  await ready;
  while (queue.length) {
    const req = queue.shift()!;
    // Skip superseded builds of the same studio: only the latest matters.
    if (req.type === 'build' && queue.some((q) => q.type === 'build' && q.studioKey === req.studioKey)) {
      post({ type: 'error', reqId: req.reqId, message: 'superseded' });
      continue;
    }
    try {
      await handle(req);
    } catch (e) {
      post({ type: 'error', reqId: req.reqId, message: errorMessage(e) });
    }
  }
  running = false;
}

self.onmessage = (ev: MessageEvent<WorkerRequest>) => {
  queue.push(ev.data);
  void pump();
};
