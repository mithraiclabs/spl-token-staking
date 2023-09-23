import * as anchor from "@coral-xyz/anchor";
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

/**
 * Batch request AccountInfo for StakeDepositReceipts
 */
export const getNextUnusedStakeReceiptNonce = async (
  connection: anchor.web3.Connection,
  programId: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  stakePoolKey: anchor.web3.PublicKey
) => {
  const pageSize = 10;
  const maxIndex = 4_294_967_295;
  const maxPage = Math.ceil(maxIndex / pageSize);
  for (let page = 0; page <= maxPage; page++) {
    const startIndex = page * pageSize;
    const stakeReceiptKeys: anchor.web3.PublicKey[] = [];
    // derive keys for batch
    for (let i = startIndex; i < startIndex + pageSize; i++) {
      const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          owner.toBuffer(),
          stakePoolKey.toBuffer(),
          new anchor.BN(i).toArrayLike(Buffer, "le", 4),
          Buffer.from("stakeDepositReceipt", "utf-8"),
        ],
        programId
      );
      stakeReceiptKeys.push(stakeReceiptKey);
    }
    // fetch page of AccountInfo for stake receipts
    const accounts = await connection.getMultipleAccountsInfo(stakeReceiptKeys);
    const indexWithinPage = accounts.findIndex((a) => !a);
    if (indexWithinPage > -1) {
      return startIndex + indexWithinPage;
    }
  }
  throw new Error("No more nonces available");
};
