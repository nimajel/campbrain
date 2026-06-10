/**
 * Normalize shouty provider site names for display: title-case fully-uppercase
 * words (≥2 letters), leave mixed-case words, single letters, digit-bearing
 * tokens, and #-prefixed site codes untouched, and collapse whitespace.
 */
export function formatSiteName(raw: string): string {
  return raw
    .trim()
    .split(/\s+/)
    .map((word) => {
      const letters = word.replace(/[^A-Za-z]/g, '');
      if (letters.length < 2) return word;
      if (/\d/.test(word)) return word;
      if (!/^[A-Za-z]/.test(word)) return word; // "#GTC" and other code tokens
      if (word !== word.toUpperCase()) return word;
      return word.charAt(0) + word.slice(1).toLowerCase();
    })
    .join(' ');
}
