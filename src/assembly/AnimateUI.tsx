// Animate a mate (Onshape Animate): run its free motion between two values — once, in a loop or back and forth.
// The frames are shown only; closing the animation puts the assembly back where it was.

import { useEffect } from 'react';
import { create } from 'zustand';
import type { AssemblyMate } from '../core/types';
import { activeAssembly, useDoc } from '../store/docStore';
import { useEditor } from '../store/editorStore';
import { requestRebuild } from '../store/rebuild';
import { LENGTH_FACTOR, formatNumber } from '../core/expr';
import { Icon } from '../ui/icons';
import { t } from '../i18n';
import { composeAssembly } from './compose';
import { animatableMotions, animatedAssembly, mateValues } from './mates';
import { useAssembly } from './sources';
import { NumField } from './AssemblyUI';

type Motion = 'turn' | 'slide';
type Mode = 'once' | 'loop' | 'bounce';

interface Anim {
  mateId: string;
  motion: Motion;
  /** Degrees for a turn, mm for a travel. */
  from: number;
  to: number;
  seconds: number;
  mode: Mode;
}

const useAnim = create<{ anim: Anim | null; playing: boolean; t: number; dir: 1 | -1 }>(() => ({ anim: null, playing: false, t: 0, dir: 1 }));

export function animationOpen() {
  return useAnim.getState().anim !== null;
}

/** Range of a motion to start with: the mate's limits, else a full turn / 20 mm from where it is now. */
function defaultRange(m: AssemblyMate, motion: Motion): [number, number] {
  const asm = activeAssembly(useDoc.getState().doc);
  const cur = asm ? mateValues(useAssembly.getState().sources, asm, m) : null;
  const lim = m.limits;
  if (motion === 'turn') {
    const a = Math.round(cur?.angle ?? 0);
    return [lim?.aMin ?? a, lim?.aMax ?? a + 360];
  }
  const z = Math.round((cur?.z ?? 0) * 1000) / 1000;
  return [lim?.zMin ?? z, lim?.zMax ?? z + 20];
}

export function startAnimation(m: AssemblyMate) {
  const motions = animatableMotions(m.type);
  if (!motions.length) return;
  const [from, to] = defaultRange(m, motions[0]);
  useEditor.getState().setSelection([]);
  useAnim.setState({ anim: { mateId: m.id, motion: motions[0], from, to, seconds: 4, mode: 'bounce' }, playing: true, t: 0, dir: 1 });
}

function closeAnimation() {
  useAnim.setState({ anim: null, playing: false, t: 0, dir: 1 });
  requestRebuild();
}

/** Keys of the animation: Esc closes it, Space plays / pauses. */
export function animationKey(e: KeyboardEvent): boolean {
  if (!useAnim.getState().anim) return false;
  if (e.key === 'Escape') closeAnimation();
  else if (e.code === 'Space') useAnim.setState((s) => ({ playing: !s.playing }));
  else return false;
  e.preventDefault();
  return true;
}

export function AnimateDialog() {
  const { anim, playing, t: pos } = useAnim();
  const doc = useDoc((s) => s.doc);
  const asm = activeAssembly(doc);
  const sources = useAssembly((s) => s.sources);
  const mate = asm?.mates?.find((m) => m.id === anim?.mateId);
  // play: advance along the range in real time
  useEffect(() => {
    if (!anim || !playing) return;
    let raf = 0;
    let last = performance.now();
    const step = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const s = useAnim.getState();
      let next = s.t + (s.dir * dt) / Math.max(0.1, anim.seconds);
      let dir = s.dir;
      let go = true;
      if (anim.mode === 'once' && next >= 1) [next, go] = [1, false];
      else if (anim.mode === 'loop') next -= Math.floor(next);
      else if (anim.mode === 'bounce' && next > 1) [next, dir] = [2 - next, -1];
      else if (anim.mode === 'bounce' && next < 0) [next, dir] = [-next, 1];
      useAnim.setState({ t: next, dir, playing: go });
      if (go) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [anim, playing]);
  // show the frame (counted from the assembly as it is in the document)
  useEffect(() => {
    if (!anim || !asm) return;
    const v = anim.from + (anim.to - anim.from) * pos;
    useEditor.setState({ build: composeAssembly(animatedAssembly(asm, sources, anim.mateId, anim.motion, v), sources).build });
  }, [anim, pos, asm, sources]);
  // the mate went away (deleted, undone)
  useEffect(() => {
    if (anim && asm && !mate) closeAnimation();
  }, [anim, asm, mate]);
  if (!anim || !asm || !doc || !mate) return null;
  const set = (patch: Partial<Anim>) => useAnim.setState({ anim: { ...anim, ...patch } });
  const unit = doc.units.length;
  const k = LENGTH_FACTOR[unit];
  const turn = anim.motion === 'turn';
  const shown = (v: number) => (turn ? v : v / k);
  const stored = (v: number) => (turn ? v : v * k);
  const suffix = turn ? '°' : unit;
  const motions = animatableMotions(mate.type);
  const value = anim.from + (anim.to - anim.from) * pos;
  return (
    <div
      className="feature-dialog animate-dialog"
      onKeyDown={(e) => {
        e.stopPropagation();
        // the fields keep their keys, but Esc closes the animation from anywhere in it
        if (e.key === 'Escape') closeAnimation();
      }}
    >
      <div className="fd-header">
        <Icon name="animate" size={18} />
        <span className="fd-title">
          {t('Animation')}: {mate.name}
        </span>
        <button className="icon-btn" title={`${t('Close')} (Esc)`} onClick={closeAnimation}>
          <Icon name="close" size={18} />
        </button>
      </div>
      <div className="fd-body">
        {motions.length > 1 && (
          <div className="fd-row">
            <label>{t('Motion')}</label>
            <div className="fd-control">
              <select
                value={anim.motion}
                onChange={(e) => {
                  const motion = e.target.value as Motion;
                  const [from, to] = defaultRange(mate, motion);
                  set({ motion, from, to });
                }}
              >
                {motions.map((m) => (
                  <option key={m} value={m}>
                    {m === 'turn' ? t('Turn about Z') : t('Travel along Z')}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}
        {(
          [
            ['from', t('From')],
            ['to', t('To')],
          ] as const
        ).map(([key, label]) => (
          <div className="fd-row" key={key}>
            <label>{label}</label>
            <div className="fd-control">
              <NumField value={Math.round(shown(anim[key]) * 1e6) / 1e6} onCommit={(v) => set({ [key]: stored(v) })} suffix={suffix} />
            </div>
          </div>
        ))}
        <div className="fd-row">
          <label>{t('Duration')}</label>
          <div className="fd-control">
            <NumField value={anim.seconds} onCommit={(v) => v > 0 && set({ seconds: v })} suffix={t('s')} />
          </div>
        </div>
        <div className="fd-row">
          <label>{t('Mode')}</label>
          <div className="fd-control">
            <select value={anim.mode} onChange={(e) => set({ mode: e.target.value as Mode })}>
              <option value="once">{t('Once')}</option>
              <option value="loop">{t('Loop')}</option>
              <option value="bounce">{t('Back and forth')}</option>
            </select>
          </div>
        </div>
        <div className="fd-row animate-controls">
          <button className="icon-btn" title={`${playing ? t('Pause') : t('Play')} (Space)`} onClick={() => useAnim.setState({ playing: !playing, ...(pos >= 1 && anim.mode === 'once' ? { t: 0 } : {}) })}>
            <Icon name={playing ? 'pause' : 'play'} size={18} />
          </button>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round(pos * 1000)}
            onChange={(e) => useAnim.setState({ t: Number(e.target.value) / 1000, playing: false })}
            aria-label={t('Now')}
          />
          <span className="animate-value">{`${formatNumber(shown(value), 2)}${turn ? '°' : ` ${unit}`}`}</span>
        </div>
        <div className="fd-hint">{t('The assembly goes back to where it was when you close the animation.')}</div>
      </div>
    </div>
  );
}
