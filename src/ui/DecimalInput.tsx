// A plain number field that takes a decimal comma as well as a point ("2,5" = 2.5): type="number" refuses the comma
// in many browsers. What is typed stays as typed while the field is being edited.

import { useState, type InputHTMLAttributes } from 'react';
import { formatNumber, parseDecimal } from '../core/expr';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'type'> & {
  value: number | undefined;
  /** Decimals shown while the field is not being edited. */
  digits?: number;
  /** Each number typed (undefined — the field emptied); text that is not a number yet is not passed on. */
  onValue: (v: number | undefined) => void;
};

export function DecimalInput({ value, digits = 4, onValue, onBlur, ...rest }: Props) {
  const [draft, setDraft] = useState<string | null>(null);
  return (
    <input
      {...rest}
      type="text"
      inputMode="decimal"
      value={draft ?? (value === undefined ? '' : formatNumber(value, digits))}
      onChange={(e) => {
        const raw = e.target.value;
        setDraft(raw);
        if (!raw.trim()) return onValue(undefined);
        const n = parseDecimal(raw);
        if (Number.isFinite(n)) onValue(n);
      }}
      onBlur={(e) => {
        onBlur?.(e);
        setDraft(null);
      }}
    />
  );
}
