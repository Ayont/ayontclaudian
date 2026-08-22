/**
 * Bare semver compare (optional leading v). Returns >0 if a > b, <0 if a < b, 0 if equal.
 *
 * Implements the precedence rules that matter for version ordering (SemVer 2.0.0
 * §11). Numeric segments compare numerically, then a pre-release sorts below its
 * own release line, and finally pre-release identifiers compare left to right —
 * numeric identifiers numerically, alphanumeric identifiers lexicographically.
 */
export function compareSemver(a: string, b: string): number {
  const strip = (value: string): string => value.replace(/^v/i, '').trim();

  const leftCore = strip(a);
  const rightCore = strip(b);

  const leftDash = leftCore.indexOf('-');
  const rightDash = rightCore.indexOf('-');

  const leftVersion = leftDash === -1 ? leftCore : leftCore.slice(0, leftDash);
  const rightVersion = rightDash === -1 ? rightCore : rightCore.slice(0, rightDash);

  const leftParts = leftVersion.split('.').map((part) => {
    const num = parseInt(part, 10);
    return Number.isNaN(num) ? 0 : num;
  });
  const rightParts = rightVersion.split('.').map((part) => {
    const num = parseInt(part, 10);
    return Number.isNaN(num) ? 0 : num;
  });

  const len = Math.max(leftParts.length, rightParts.length);
  for (let index = 0; index < len; index += 1) {
    const ai = leftParts[index] ?? 0;
    const bi = rightParts[index] ?? 0;
    if (ai !== bi) {
      return ai - bi;
    }
  }

  const leftPre = leftDash === -1 ? null : leftCore.slice(leftDash + 1);
  const rightPre = rightDash === -1 ? null : rightCore.slice(rightDash + 1);

  // A release (no pre-release) outranks the same line with a pre-release.
  if (leftPre === null && rightPre !== null) return 1;
  if (leftPre !== null && rightPre === null) return -1;
  if (leftPre === null && rightPre === null) return 0;

  // Compare pre-release identifiers left to right.
  const leftIds = (leftPre ?? '').split('.');
  const rightIds = (rightPre ?? '').split('.');
  const idLen = Math.max(leftIds.length, rightIds.length);
  for (let index = 0; index < idLen; index += 1) {
    const li = leftIds[index];
    const ri = rightIds[index];
    // More identifiers means higher precedence when all shared ones are equal.
    if (li === undefined && ri !== undefined) return -1;
    if (li !== undefined && ri === undefined) return 1;

    const leftIsNumeric = /^[0-9]+$/.test(li ?? '');
    const rightIsNumeric = /^[0-9]+$/.test(ri ?? '');
    if (li === ri) continue;
    // Numeric identifiers always have lower precedence than alphanumeric ones.
    if (leftIsNumeric && !rightIsNumeric) return -1;
    if (!leftIsNumeric && rightIsNumeric) return 1;
    if (leftIsNumeric && rightIsNumeric) {
      // Compare numeric identifiers numerically (numeric fields never carry leading zeros).
      const ln = parseInt(li ?? '0', 10);
      const rn = parseInt(ri ?? '0', 10);
      if (ln !== rn) return ln - rn;
    } else {
      // Compare alphanumeric identifiers lexicographically.
      if ((li ?? '') < (ri ?? '')) return -1;
      if ((li ?? '') > (ri ?? '')) return 1;
    }
  }
  return 0;
}

/** First x.y.z (optional pre-release) in CLI or npm output. */
export function parseCliVersion(output: string): string | null {
  const match = output.match(/(\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/);
  return match?.[1] ?? null;
}
