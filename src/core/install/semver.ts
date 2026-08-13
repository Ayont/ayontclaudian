/**
 * Bare semver compare (optional leading v). Returns >0 if a > b, <0 if a < b, 0 if equal.
 */
export function compareSemver(a: string, b: string): number {
  const parse = (value: string): number[] =>
    value.replace(/^v/i, '')
      .split('.')
      .map((part) => {
        const num = parseInt(part, 10);
        return Number.isNaN(num) ? 0 : num;
      });
  const left = parse(a);
  const right = parse(b);
  const len = Math.max(left.length, right.length);
  for (let index = 0; index < len; index += 1) {
    const ai = left[index] ?? 0;
    const bi = right[index] ?? 0;
    if (ai !== bi) {
      return ai - bi;
    }
  }
  return 0;
}

/** First x.y.z (optional pre-release) in CLI or npm output. */
export function parseCliVersion(output: string): string | null {
  const match = output.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/);
  return match?.[1] ?? null;
}
