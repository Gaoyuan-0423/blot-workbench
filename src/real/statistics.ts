import jStat from "jstat";

export interface PairedObservation {
  id: string;
  control: number;
  treatment: number;
}
export interface PairedTestResult {
  method: "paired-t";
  alternative: "two-sided";
  inputBasis: "target/reference";
  n: number;
  df: number | null;
  t: number | null;
  pValue: number | null;
  meanDifference: number | null;
  ci95: [number, number] | null;
  status: "ok" | "unavailable";
  reason:
    | "insufficient-pairs"
    | "duplicate-id"
    | "invalid-values"
    | "zero-variance"
    | "numeric-error"
    | null;
  ids: string[];
}

/** Explicit paired, two-sided test of treatment minus control; never selects or drops pairs. */
export function pairedTTest(pairs: PairedObservation[]): PairedTestResult {
  const result: PairedTestResult = {
    method: "paired-t",
    alternative: "two-sided",
    inputBasis: "target/reference",
    n: pairs.length,
    df: pairs.length >= 2 ? pairs.length - 1 : null,
    t: null,
    pValue: null,
    meanDifference: null,
    ci95: null,
    status: "unavailable",
    reason: null,
    ids: pairs.map((pair) => pair.id.trim()),
  };
  if (
    result.ids.some((id) => !id) ||
    pairs.some(
      (pair) =>
        !Number.isFinite(pair.control) || !Number.isFinite(pair.treatment),
    )
  )
    return { ...result, reason: "invalid-values" };
  if (new Set(result.ids).size !== result.ids.length)
    return { ...result, reason: "duplicate-id" };
  if (pairs.length < 2) return { ...result, reason: "insufficient-pairs" };
  const differences = pairs.map((pair) => pair.treatment - pair.control);
  const scale = Math.max(...differences.map(Math.abs));
  if (!Number.isFinite(scale)) return { ...result, reason: "numeric-error" };
  if (scale === 0)
    return { ...result, meanDifference: 0, reason: "zero-variance" };
  // Scaling avoids overflow in squared differences and leaves t unchanged.
  const scaled = differences.map((value) => value / scale);
  const mean = scaled.reduce((sum, value) => sum + value, 0) / pairs.length;
  const variance =
    scaled.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
    (pairs.length - 1);
  result.meanDifference = mean * scale;
  if (variance === 0) return { ...result, reason: "zero-variance" };
  const standardError = Math.sqrt(variance / pairs.length);
  const t = mean / standardError;
  // Direct incomplete-beta tail avoids cancellation in jStat.studentt.cdf.
  // df=1 is Cauchy: this form also survives t*t overflow for extremely large t.
  const betaX = (1 / Math.hypot(1, t / Math.sqrt(result.df!))) ** 2;
  const scaledT2 = Math.abs(t) / Math.SQRT2;
  const hypotT2 = Math.hypot(1, scaledT2);
  const tail =
    result.df === 1
      ? (2 / Math.PI) * Math.atan2(1, Math.abs(t))
      : result.df === 2
        ? 1 / hypotT2 / (hypotT2 + scaledT2)
        : jStat.ibeta(betaX, result.df! / 2, 0.5);
  const pValue = tail <= 1 + 4 * Number.EPSILON ? Math.min(1, tail) : tail;
  const margin = jStat.studentt.inv(0.975, result.df!) * standardError;
  const ci95: [number, number] = [
    (mean - margin) * scale,
    (mean + margin) * scale,
  ];
  if (
    ![t, pValue, result.meanDifference, ...ci95].every(Number.isFinite) ||
    // A finite t has a strictly positive tail; underflow is not evidence of P=0.
    pValue <= 0 ||
    pValue > 1
  )
    return { ...result, reason: "numeric-error" };
  return { ...result, t, pValue, ci95, status: "ok" };
}
