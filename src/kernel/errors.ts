/** A failure of WebAssembly itself: the kernel's memory may no longer be usable. */
export function fatalKernelError(e: unknown): boolean {
  if (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) return true;
  const message = e instanceof Error ? e.message : typeof e === 'string' ? e : '';
  return /Aborted\(|out of memory|memory access out of bounds|unreachable|table index is out of bounds/i.test(message);
}
