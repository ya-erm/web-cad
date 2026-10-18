// A configuration of its own for an assembly instance or a drawing view (Onshape): per input of the Part Studio,
// "As in the Part Studio" (it follows the option chosen there) or an option — a value for a variable input.

import { useEffect, useState } from 'react';
import type { PartStudioTab } from '../core/types';
import { chosenLabel, inputName } from '../core/config';
import { t } from '../i18n';

/** A value field: committed on Enter or when it loses focus; empty — as in the Part Studio. */
function ValueField({ value, placeholder, onCommit }: { value: string; placeholder: string; onCommit: (v: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <input
      type="text"
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => text.trim() !== value && onCommit(text.trim())}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') setText(value);
      }}
    />
  );
}

/** The inputs of `studio` with the options of `value` (input id → option id / value); `undefined` — none of its own. */
export function ConfigurationFields({ studio, value, onChange }: { studio: PartStudioTab; value?: Record<string, string>; onChange: (next: Record<string, string> | undefined) => void }) {
  const set = (inputId: string, v: string) => {
    const next = { ...value };
    if (v) next[inputId] = v;
    else delete next[inputId];
    onChange(Object.keys(next).length ? next : undefined);
  };
  return (
    <>
      {(studio.configuration ?? []).map((input) => {
        const asStudio = `${t('As in the Part Studio')} (${chosenLabel(studio.features, input, studio.configChoice)})`;
        return (
          <div className="fd-row fd-stacked" key={input.id}>
            <label>{inputName(studio.features, input)}</label>
            <div className="fd-control">
              {input.kind === 'variable' ? (
                <ValueField value={value?.[input.id] ?? ''} placeholder={asStudio} onCommit={(v) => set(input.id, v)} />
              ) : (
                <select value={value?.[input.id] ?? ''} onChange={(e) => set(input.id, e.target.value)}>
                  <option value="">{asStudio}</option>
                  {input.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          </div>
        );
      })}
    </>
  );
}
