/** Escape regex metacharacters so user search text is treated literally (SEC-17). */
export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
