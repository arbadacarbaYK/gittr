/** Compact header labels so the nav stays one line on a phone. */
export function navItemShortTitle(item: {
  title: string;
  shortTitle?: string;
}): string {
  return (item.shortTitle || item.title).trim();
}
