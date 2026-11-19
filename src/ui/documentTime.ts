/** Document list timestamps are always local time, DD.MM.YYYY HH:mm:ss, independent of UI language. */
export function documentTime(value: number): string {
  const d = new Date(value);
  if (!Number.isFinite(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
