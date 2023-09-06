import { SCALE_FACTOR_BASE, U64_MAX } from "./constants";

/**
 * Calculate the digit precision loss based on the given maximum weight.
 *
 * @param maxWeight
 * @returns
 */
export const getDigitShift = (maxWeight: bigint) => {
  let digitShift = 0;
  while (
    (maxWeight * U64_MAX) / SCALE_FACTOR_BASE / BigInt(10 ** digitShift) >
    U64_MAX
  ) {
    digitShift += 1;
  }
  return digitShift;
};
