// Configurations (Onshape): variants of a Part Studio from a table. Each input is a list of options (rows); the
// chosen option sets the configured parameters (columns) of the features — an expression or a checkbox of a
// feature, its suppression, a variable's value. A variable input sets one variable to any value typed for it.
// What is built is the features as the chosen options have them.

import type { AssemblyInstance, ConfigInput, Feature, FeatureOf, PartStudioTab } from './types';

/** A configured parameter: `featureId/param`; `featureId/suppressed` — whether the feature is suppressed. */
export const configKey = (featureId: string, param: string) => `${featureId}/${param}`;

export function splitConfigKey(key: string): { featureId: string; param: string } {
  const i = key.indexOf('/');
  return { featureId: key.slice(0, i), param: key.slice(i + 1) };
}

type Configured = Pick<PartStudioTab, 'features' | 'configuration' | 'configChoice'>;

/** The option of `input` chosen in `choice` (the first one by default; a variable input has none). */
export function chosenOption(input: ConfigInput, choice?: Record<string, string>) {
  return input.options.find((o) => o.id === choice?.[input.id]) ?? input.options[0];
}

/** The variable feature a variable input sets. */
export function inputVariable(features: Feature[], input: ConfigInput): FeatureOf<'variable'> | undefined {
  if (input.kind !== 'variable' || !input.params[0]) return undefined;
  const id = splitConfigKey(input.params[0]).featureId;
  return features.find((f): f is FeatureOf<'variable'> => f.id === id && f.type === 'variable');
}

/** An input's name: a variable input is its variable, "#length". */
export function inputName(features: Feature[], input: ConfigInput): string {
  const v = inputVariable(features, input);
  return v ? `#${v.params.name}` : input.name;
}

/** What `choice` makes of an input, for people: the option's name, a variable input's value (its own by default). */
export function chosenLabel(features: Feature[], input: ConfigInput, choice?: Record<string, string>): string {
  if (input.kind === 'variable') return choice?.[input.id] || (inputVariable(features, input)?.params.value ?? '');
  return chosenOption(input, choice)?.name ?? '';
}

/** The key of a Part Studio as a configuration of its own builds it: "studio#input=option,…" (the id alone without one). */
export function sourceKey(inst: Pick<AssemblyInstance, 'studioId' | 'configuration'>): string {
  const pairs = Object.entries(inst.configuration ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return pairs.length ? `${inst.studioId}#${pairs.map(([k, v]) => `${k}=${v}`).join(',')}` : inst.studioId;
}

/** A Part Studio as an instance's (a drawing view's) own configuration builds it (its id: the source key). */
export function variantStudio(studio: PartStudioTab, configuration?: Record<string, string>): PartStudioTab {
  if (!configuration || !Object.keys(configuration).length) return studio;
  return { ...studio, id: sourceKey({ studioId: studio.id, configuration }), configChoice: { ...studio.configChoice, ...configuration } };
}

/** A sketch dimension as a configured parameter: `dim:<constraint id>`. */
export const DIM = 'dim:';

/** A feature's own value of a parameter, as a table cell has it. */
export function ownValue(f: Feature, param: string): string | undefined {
  if (param === 'suppressed') return String(!!f.suppressed);
  if (param.startsWith(DIM)) return f.type === 'sketch' ? f.params.constraints.find((c) => c.id === param.slice(DIM.length))?.value : undefined;
  const v = (f.params as unknown as Record<string, unknown>)[param];
  return typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' ? String(v) : undefined;
}

/** Configured values for the chosen options: featureId → parameter → value (a later input wins). */
export function configOverrides(inputs: ConfigInput[] | undefined, choice?: Record<string, string>): Map<string, Record<string, string>> {
  const out = new Map<string, Record<string, string>>();
  for (const input of inputs ?? []) {
    if (input.kind === 'variable') {
      // the value typed for the variable (none: its own)
      const v = choice?.[input.id];
      if (v && input.params[0]) {
        const { featureId, param } = splitConfigKey(input.params[0]);
        out.set(featureId, { ...out.get(featureId), [param]: v });
      }
      continue;
    }
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
    if (param.startsWith(DIM)) {
      // a dimension of a sketch: its value
      const id = param.slice(DIM.length);
      if (out.type === 'sketch' && out.params.constraints.some((c) => c.id === id && c.value !== v))
        out = { ...out, params: { ...out.params, constraints: out.params.constraints.map((c) => (c.id === id ? { ...c, value: v } : c)) } };
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
 * chosen option's cell (a variable input's: its value now) — in a draft of the studio. False when it is not
 * configured (set the feature itself).
 */
export function setConfigured(studio: Configured, featureId: string, param: string, value: string): boolean {
  const key = configKey(featureId, param);
  const input = owner(studio, key);
  if (input?.kind === 'variable') {
    studio.configChoice = { ...studio.configChoice, [input.id]: value };
    return true;
  }
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

/** Drop the configured parameters of features that are gone (and the variable inputs of variables that are). */
export function pruneConfiguration(studio: Configured) {
  const ids = new Set(studio.features.map((f) => f.id));
  for (const input of studio.configuration ?? []) {
    const gone = input.params.filter((k) => !ids.has(splitConfigKey(k).featureId));
    if (!gone.length) continue;
    input.params = input.params.filter((k) => !gone.includes(k));
    for (const cells of Object.values(input.values)) for (const k of gone) delete cells[k];
  }
  const orphans = (studio.configuration ?? []).filter((i) => i.kind === 'variable' && !i.params.length);
  if (!orphans.length) return;
  studio.configuration = studio.configuration!.filter((i) => !orphans.includes(i));
  if (studio.configChoice) for (const i of orphans) delete studio.configChoice[i.id];
  if (!studio.configuration.length) delete studio.configuration;
}
