// Variable suggestions while typing an expression (Onshape): "#" (and the start of a name) lists the variables the
// field can use under it; ↑ ↓ choose, Enter or Tab puts the name in, Esc closes the list. Plain DOM, so the feature
// dialogs (React) and the sketch's dimension box use the same.

import { useEffect, useRef, type RefObject } from 'react';
import { formatNumber, LENGTH_FACTOR, type VariableTable } from '../core/expr';
import type { CadDocument } from '../core/types';

export interface VarChoice {
  name: string;
  /** Its value as shown in the list: "40 mm", "30°", "2". */
  value: string;
}

/** The variables of a table, sorted by name, with their values in the document's units. */
export function varChoices(vars: VariableTable, units: CadDocument['units']): VarChoice[] {
  return Object.entries(vars)
    .map(([name, q]) => ({
      name,
      value:
        q.len === 1 && q.ang === 0
          ? `${formatNumber(q.v / LENGTH_FACTOR[units.length], 4)} ${units.length}`
          : q.len === 0 && q.ang === 1
            ? `${formatNumber((q.v * 180) / Math.PI, 4)}°`
            : formatNumber(q.v, 4),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** The "#name" being typed just before the caret: where it starts and its letters so far. */
export function typedVariable(text: string, caret: number): { start: number; prefix: string } | null {
  const m = /#([A-Za-z_][A-Za-z0-9_]*)?$/.exec(text.slice(0, caret));
  return m ? { start: caret - m[0].length, prefix: m[1] ?? '' } : null;
}

/** The choices for a prefix: the names starting with it, then those containing it (case aside). */
export function matchingVariables(choices: VarChoice[], prefix: string): VarChoice[] {
  const p = prefix.toLowerCase();
  const starts = choices.filter((c) => c.name.toLowerCase().startsWith(p));
  return [...starts, ...choices.filter((c) => !starts.includes(c) && c.name.toLowerCase().includes(p))];
}

/** Put a value into a field as typing does (React's controlled inputs see it as an input event). */
function setFieldValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set?.call(input, value);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Suggest variables in `input` (see above); returns the function that takes the suggestions off. */
export function attachVariableSuggest(input: HTMLInputElement, choices: () => VarChoice[]): () => void {
  let box: HTMLDivElement | null = null;
  let items: VarChoice[] = [];
  let active = 0;
  const close = () => {
    box?.remove();
    box = null;
    items = [];
  };
  const pick = (c: VarChoice) => {
    const caret = input.selectionStart ?? input.value.length;
    const tk = typedVariable(input.value, caret);
    if (!tk) return close();
    const before = input.value.slice(0, tk.start) + '#' + c.name;
    setFieldValue(input, before + input.value.slice(caret));
    input.setSelectionRange(before.length, before.length);
    close();
  };
  const render = () => {
    if (!box) {
      box = document.createElement('div');
      box.className = 'var-suggest';
      box.setAttribute('role', 'listbox');
      // the field keeps the focus (and does not commit on blur)
      box.addEventListener('mousedown', (e) => e.preventDefault());
      document.body.appendChild(box);
    }
    const r = input.getBoundingClientRect();
    box.style.left = `${r.left}px`;
    box.style.top = `${r.bottom + 2}px`;
    box.style.minWidth = `${Math.max(140, r.width)}px`;
    box.replaceChildren(
      ...items.map((c, i) => {
        const row = document.createElement('div');
        row.className = 'var-suggest-row' + (i === active ? ' active' : '');
        row.setAttribute('role', 'option');
        const name = document.createElement('span');
        name.className = 'name';
        name.textContent = `#${c.name}`;
        const value = document.createElement('span');
        value.className = 'value';
        value.textContent = c.value;
        row.append(name, value);
        row.addEventListener('mouseenter', () => {
          active = i;
          for (const [k, el] of [...box!.children].entries()) el.classList.toggle('active', k === i);
        });
        row.addEventListener('click', () => pick(c));
        return row;
      }),
    );
  };
  const update = () => {
    const tk = typedVariable(input.value, input.selectionStart ?? input.value.length);
    if (!tk || document.activeElement !== input) return close();
    const list = matchingVariables(choices(), tk.prefix);
    // nothing to add when the whole name is typed already
    if (!list.length || (list.length === 1 && list[0].name === tk.prefix)) return close();
    if (list.map((c) => c.name).join() !== items.map((c) => c.name).join()) active = 0;
    items = list;
    render();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!box || !items.length) return;
    const stop = () => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      stop();
      active = (active + (e.key === 'ArrowDown' ? 1 : items.length - 1)) % items.length;
      render();
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      stop();
      pick(items[active]);
    } else if (e.key === 'Escape') {
      stop();
      close();
    }
  };
  // before the field's own keys (the arrows step a number, Enter commits, Esc cancels)
  input.addEventListener('keydown', onKey, true);
  input.addEventListener('input', update);
  input.addEventListener('click', update);
  input.addEventListener('blur', close);
  return () => {
    input.removeEventListener('keydown', onKey, true);
    input.removeEventListener('input', update);
    input.removeEventListener('click', update);
    input.removeEventListener('blur', close);
    close();
  };
}

/** The suggestions on a React field; `choices` is read when the list opens (the latest variables). */
export function useVariableSuggest(ref: RefObject<HTMLInputElement | null>, choices: () => VarChoice[]) {
  const latest = useRef(choices);
  useEffect(() => {
    latest.current = choices;
  });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return attachVariableSuggest(el, () => latest.current());
  }, [ref]);
}
