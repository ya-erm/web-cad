// Materials of parts (Onshape: Assign material) — a library of common ones with their densities, for the mass in
// measurements and in the agent's summary, and the material's name for the bill of materials and title blocks.

import type { PartMeta } from './types';

export interface MaterialDef {
  /** Stable key (the agent API: `material: "aluminum"`). */
  id: string;
  /** English name (translated for display). */
  name: string;
  /** g/cm³ (typical value). */
  density: number;
}

export const MATERIALS: MaterialDef[] = [
  { id: 'steel', name: 'Steel', density: 7.85 },
  { id: 'stainless', name: 'Stainless steel', density: 7.93 },
  { id: 'castIron', name: 'Cast iron', density: 7.2 },
  { id: 'aluminum', name: 'Aluminum', density: 2.7 },
  { id: 'brass', name: 'Brass', density: 8.5 },
  { id: 'bronze', name: 'Bronze', density: 8.8 },
  { id: 'copper', name: 'Copper', density: 8.96 },
  { id: 'titanium', name: 'Titanium', density: 4.51 },
  { id: 'pla', name: 'PLA', density: 1.24 },
  { id: 'abs', name: 'ABS', density: 1.04 },
  { id: 'petg', name: 'PETG', density: 1.27 },
  { id: 'nylon', name: 'Nylon (PA6)', density: 1.14 },
  { id: 'pc', name: 'Polycarbonate', density: 1.2 },
  { id: 'acrylic', name: 'Acrylic (PMMA)', density: 1.18 },
  { id: 'pine', name: 'Wood (pine)', density: 0.5 },
  { id: 'plywood', name: 'Plywood', density: 0.6 },
  { id: 'glass', name: 'Glass', density: 2.5 },
];

/** A part with no material is steel for its mass (as before materials). */
export const DEFAULT_DENSITY = 7.85;

/** The library material by id or name (English or as shown), case-insensitive. */
export function findMaterial(key: string, translate: (s: string) => string = (s) => s): MaterialDef | undefined {
  const k = key.trim().toLowerCase();
  return MATERIALS.find((m) => m.id.toLowerCase() === k || m.name.toLowerCase() === k || translate(m.name).toLowerCase() === k);
}

/** A part's density, g/cm³: its own, else steel. */
export function partDensity(meta: PartMeta | undefined): number {
  return meta?.density && meta.density > 0 ? meta.density : DEFAULT_DENSITY;
}

/** Mass, kg, of a volume in mm³ at a density in g/cm³. */
export function massKg(volumeMm3: number, density: number): number {
  return (volumeMm3 / 1000) * density / 1000;
}
