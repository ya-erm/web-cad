import type { Engine } from './engine';

let engine: Engine | null = null;

export function setEngine(e: Engine | null) {
  engine = e;
}

export function getEngine(): Engine | null {
  return engine;
}
