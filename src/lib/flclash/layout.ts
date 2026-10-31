export interface DashboardLayout {
  columns: 1 | 2 | 4;
  compact: boolean;
  showTables: boolean;
  gap: number;
}

/**
 * FlClash dashboard breakpoints use the content width (window minus sidebar):
 * <640 mobile, <860 two columns, otherwise four. Compact shrinks every fixed
 * card row when either dimension is tight.
 */
export function dashboardLayout(width: number, height: number): DashboardLayout {
  if (width < 640) {
    return { columns: 1, compact: true, showTables: false, gap: 8 };
  }
  if (width < 860) {
    return { columns: 2, compact: false, showTables: false, gap: width < 800 ? 12 : 16 };
  }
  return {
    columns: 4,
    compact: width < 1040 || height < 824,
    showTables: true,
    gap: 16,
  };
}
