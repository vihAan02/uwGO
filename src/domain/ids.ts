/** Small, dependency-free stable hash (djb2) rendered in base36. Not cryptographic; used for stable ids. */
export function stableId(...parts: (string | number | undefined | null)[]): string {
  const s = parts.map((p) => (p === undefined || p === null ? "" : String(p))).join("|");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
