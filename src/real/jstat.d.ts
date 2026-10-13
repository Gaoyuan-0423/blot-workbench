declare module "jstat" {
  const jStat: {
    ibeta(x: number, a: number, b: number): number;
    studentt: {
      cdf(x: number, degreesOfFreedom: number): number;
      inv(probability: number, degreesOfFreedom: number): number;
    };
  };
  export default jStat;
}
