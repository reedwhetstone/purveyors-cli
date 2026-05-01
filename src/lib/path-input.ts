/** Normalize file and directory paths pasted into interactive CLI prompts. */
export function normalizePathInput(value: string): string {
  let normalized = value.trim();

  if (normalized.length >= 2) {
    const first = normalized[0];
    const last = normalized[normalized.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      normalized = normalized.slice(1, -1);
    }
  }

  return normalized.replace(/\\([\\ \"'()&;<>|?*\[\]{}$`!#~])/g, '$1');
}
