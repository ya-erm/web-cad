// Configurations (Onshape): variants of a Part Studio from a table. Each input is a list of options (rows); the
// chosen option sets the configured parameters (columns) of the features — an expression or a checkbox of a
// feature, its suppression, a variable's value. What is built is the features as the chosen options have them.

import type { ConfigInput, Feature, PartStudioTab } from './types';

/** A configured parameter: `featureId/param`; `featureId/suppressed` — whether the feature is suppressed. */
export const configKey = (featureId: string, param: string) => `${featureId}/${param}`;

export function splitConfigKey(key: string): { featureId: string; param: string } {
  const i = key.indexOf('/');
  return { featureId: key.slice(0, i), param: key.slice(i + 1) };
}

type Configured = Pick<PartStudioTab, 'features' | 'configuration' | 'configChoice'>;

/** The option of `input` chosen in `choice` (the first one by default). */
export function chosenOption(input: ConfigInput, choice?: Record<string, string>) {
  return input.options.find((o) => o.id === choice?.[input.id]) ?? input.options[0];
}

/** A feature's own value of a parameter, as a table cell has it. */
export function ownValue(f: Feature, param: string): string | undefined {
  if (param === 'suppressed') return String(!!f.suppressed);
  const v = (f.params as unknown as Record<string, unknown>)[param];
  return typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' ? String(v) : undefined;
}

/** Configured values for the chosen options: featureId → parameter → value (a later input wins). */
export function configOverrides(inputs: ConfigInput[] | undefined, choice?: Record<string, string>): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const input of inputs ?? []) {
    const opt = chosenOption(input, choice);
    const cells = opt ? input.values[opt.id] : undefined;
    if (!cells) continue;
    for (const key of input.params) {
      const v = cells[key];
      if (v === undefined) continue;
      const { featureId, param } = splitConfigKey(key);
      out.set(featureId, { ...out.get(featureId), [param]: v });
    }
  }
  return out;
}

/** A feature with configured values set (the same object when nothing changes). */
export function withValues(f: Feature, values: Record<string, string> | undefined): Feature {
  if (!values) return f;
  let out = f;
  for (const [param, v] of Object.entries(values)) {
    if (param === 'suppressed') {
      if (!!out.suppressed !== (v === 'true')) out = { ...out, suppressed: v === 'true' } as Feature;
      continue;
    }
    const cur = (out.params as unknown as Record<string, unknown>)[param];
    if (cur === undefined) continue;
    const next = typeof cur === 'boolean' ? v === 'true' : v;
    if (cur !== next) out = { ...out, params: { ...out.params, [param]: next } } as Feature;
  }
  return out;
}

/** The studio's features as the chosen configuration has them — what is built (`choice`: the studio's own). */
export function configuredFeatures(studio: Configured, choice = studio.configChoice): Feature[] {
  if (!studio.configuration?.length) return studio.features;
  const o = configOverrides(studio.configuration, choice);
  return studio.features.map((f) => withValues(f, o.get(f.id)));
}

/** The features of a Part Studio (if any) as its chosen configuration has them — for evaluating its variables. */
export const configuredOf = (studio: Configured | null | undefined): Feature[] => (studio ? configuredFeatures(studio) : []);

/** The input whose table sets parameter `key` now (the last one that configures it), if any. */
function owner(studio: Configured, key: string): ConfigInput | undefined {
  return [...(studio.configuration ?? [])].reverse().find((i) => i.params.includes(key));
}

/**
 * Set a parameter by hand (in a dialog, the feature list, the variable table): a configured one goes into the
 * chosen option's cell — in a draft of the studio. False when it is not configured (set the feature itself).
 */
export function setConfigured(studio: Configured, featureId: string, param: string, value: string): boolean {
  const key = configKey(featureId, param);
  const input = owner(studio, key);
  const opt = input && chosenOption(input, studio.configChoice);
  if (!input || !opt) return false;
  input.values[opt.id] = { ...input.values[opt.id], [key]: value };
  return true;
}

/** The configured parameters of a feature, with the input that sets each. */
export function configuredParams(studio: Configured, featureId: string): Map<string, ConfigInput> {
  const out = new Map<string, ConfigInput>();
  for (const input of studio.configuration ?? [])
    for (const key of input.params) {
      const { featureId: f, param } = splitConfigKey(key);
      if (f === featureId) out.set(param, input);
    }
  return out;
}

/**
 * A feature edited in its dialog (which shows its configured values) going back into a draft of the studio: what
 * was changed in a configured parameter goes into the chosen option's cell, and the feature keeps its own value.
 */
export function commitConfigured(studio: Configured, original: Feature, draft: Feature): Feature {
  const params = configuredParams(studio, original.id);
  if (!params.size) return draft;
  const shown = withValues(original, configOverrides(studio.configuration, studio.configChoice).get(original.id));
  let out = draft;
  for (const param of params.keys()) {
    const typed = ownValue(draft, param);
    if (typed === undefined) continue;
    if (typed !== ownValue(shown, param)) setConfigured(studio, original.id, param, typed);
    // the feature keeps its own value
    const own = ownValue(original, param)!;
    out = withValues(out, { [param]: own });
  }
  return out;
}

/** Drop the configured parameters of features that are gone. */
export function pruneConfiguration(studio: Configured) {
  const ids = new Set(studio.features.map((f) => f.id));
  for (const input of studio.configuration ?? []) {
    const gone = input.params.filter((k) => !ids.has(splitConfigKey(k).featureId));
    if (!gone.length) continue;
    input.params = input.params.filter((k) => !gone.includes(k));
    for (const cells of Object.values(input.values)) for (const k of gone) delete cells[k];
  }
}
