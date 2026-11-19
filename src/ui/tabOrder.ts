/** Move existing identities, preserving the tab objects and returning the original array for a no-op. */
export function reorderTabs<T extends { id: string }>(tabs: T[], source: string, target: string, after: boolean): T[] {
  const from = tabs.findIndex((tab) => tab.id === source);
  const to = tabs.findIndex((tab) => tab.id === target);
  if (from < 0 || to < 0 || from === to || tabs.filter((tab) => tab.id === source).length !== 1 || tabs.filter((tab) => tab.id === target).length !== 1) return tabs;
  const next = tabs.slice();
  next.splice(from, 1);
  const index = next.findIndex((tab) => tab.id === target) + (after ? 1 : 0);
  next.splice(index, 0, tabs[from]);
  return next.every((tab, i) => tab === tabs[i]) ? tabs : next;
}
