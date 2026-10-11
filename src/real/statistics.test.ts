import { describe, expect, it } from "vitest";
import { pairedTTest } from "./statistics";

const observations = (control: number[], treatment: number[]) =>
  control.map((value, index) => ({
    id: String(index + 1),
    control: value,
    treatment: treatment[index],
  }));

// Independently evaluated with scipy.stats.ttest_rel(treatment, control), SciPy 1.18.1.
// Synthetic values only. CI tolerance accommodates jStat inverse-CDF approximation.
describe("two-sided paired t test", () => {
  it("does not export numeric underflow as an exact zero P-value", () => {
    const pairs = Array.from({ length: 500 }, (_, index) => ({
      id: String(index),
      control: 1,
      treatment: 2 + (index % 2 ? 1e-6 : -1e-6),
    }));
    const result = pairedTTest(pairs);
    expect(result.reason).toBe("numeric-error");
    expect(result.pValue).toBeNull();
  });
  it("preserves a small but representable Cauchy tail at n=2", () => {
    const result = pairedTTest(observations([1, 1], [2 - 1e-8, 2 + 1e-8]));
    expect(result.status).toBe("ok");
    expect(result.pValue).toBeGreaterThan(6.36e-9);
    expect(result.pValue).toBeLessThan(6.37e-9);
  });
  it.each([
    {
      control: [1, 2, 4],
      treatment: [0.4, 1.2, 2.5],
      t: -3.5429138863328515,
      p: 0.07125670793049461,
      ci: [-2.1406243482619773, 0.2072910149286441],
    },
    {
      control: [1, 3],
      treatment: [0.5, 2],
      t: -3,
      p: 0.20483276469913345,
      ci: [-3.9265511840436735, 2.4265511840436735],
    },
    {
      control: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
      treatment: [0.5, 1.5, 2.7, 3.8, 4.3, 5.5, 7.5, 7.2, 8.1, 8.8],
      t: -3.5017768444922814,
      p: 0.006704751445910551,
      ci: [-0.8394613575510002, -0.18053864244899986],
    },
  ])(
    "matches independent reference at n=$control.length",
    ({ control, treatment, t, p, ci }) => {
      const result = pairedTTest(observations(control, treatment));
      expect(result.status).toBe("ok");
      expect(result.df).toBe(control.length - 1);
      expect(result.t).toBeCloseTo(t, 12);
      expect(result.pValue).toBeCloseTo(p, 9);
      expect(result.ci95![0]).toBeCloseTo(ci[0], 7);
      expect(result.ci95![1]).toBeCloseTo(ci[1], 7);
    },
  );
  it("keeps P under common positive scaling and reversal, with signed difference CI", () => {
    const pairs = observations([1, 2, 4], [0.4, 1.2, 2.5]);
    const original = pairedTTest(pairs);
    const scaled = pairedTTest(
      pairs.map((pair) => ({
        ...pair,
        control: pair.control / 7,
        treatment: pair.treatment / 7,
      })),
    );
    const reversed = pairedTTest(
      pairs.map((pair) => ({
        ...pair,
        control: pair.treatment,
        treatment: pair.control,
      })),
    );
    expect(scaled.pValue).toBeCloseTo(original.pValue!, 12);
    expect(scaled.meanDifference).toBeCloseTo(original.meanDifference! / 7, 12);
    expect(reversed.pValue).toBeCloseTo(original.pValue!, 12);
    expect(reversed.t).toBeCloseTo(-original.t!, 12);
    expect(reversed.ci95![0]).toBeCloseTo(-original.ci95![1], 12);
  });
  it("reports P=1 for zero mean paired difference with nonzero variance", () => {
    const result = pairedTTest(observations([1, 1, 1], [0.5, 1, 1.5]));
    expect(result.pValue).toBeCloseTo(1, 12);
    expect(result.t).toBe(0);
  });
  it("does not silently drop invalid pairs, duplicate IDs or degenerate data", () => {
    expect(pairedTTest([]).reason).toBe("insufficient-pairs");
    expect(pairedTTest(observations([1], [2])).reason).toBe(
      "insufficient-pairs",
    );
    expect(pairedTTest(observations([1, 2], [NaN, 3])).reason).toBe(
      "invalid-values",
    );
    expect(
      pairedTTest([
        { id: "a", control: 1, treatment: 2 },
        { id: " a ", control: 3, treatment: 5 },
      ]).reason,
    ).toBe("duplicate-id");
    for (const treatment of [
      [1, 2, 3],
      [2, 3, 4],
    ]) {
      const result = pairedTTest(observations([1, 2, 3], treatment));
      expect(result.reason).toBe("zero-variance");
      expect(result.pValue).toBeNull();
    }
  });
});
