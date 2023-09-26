import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { SCALE_FACTOR_BASE, SCALE_FACTOR_BASE_BN, U64_MAX } from "./constants";
import { SplTokenStaking } from "./idl";
import { StakeDepositReceiptData, StakePool } from "./types";

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
 * Request all of a wallet's StakeDepositReceipts.
 *
 * This can be an expensive request if the wallet has staked many times.
 * @param program
 * @param owner
 * @param stakePoolKey
 * @returns
 */
export const batchRequestStakeReceipts = async (
  program: anchor.Program<SplTokenStaking>,
  owner: anchor.web3.PublicKey,
  stakePoolKey: anchor.web3.PublicKey
) => {
  const pageSize = 10;
  const maxIndex = 4_294_967_295; // U32 MAX
  const maxPage = Math.ceil(maxIndex / pageSize);
  let decodedAccountBuffer: StakeDepositReceiptData[] = [];
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
        program.programId
      );
      stakeReceiptKeys.push(stakeReceiptKey);
    }
    // fetch page of AccountInfo for stake receipts
    const accountInfos =
      await program.provider.connection.getMultipleAccountsInfo(
        stakeReceiptKeys
      );
    const validAccounts = accountInfos
      .map((a, index) =>
        a
          ? {
              address: stakeReceiptKeys[index],
              ...a,
            }
          : null
      )
      .filter((a) => !!a) as (anchor.web3.AccountInfo<Buffer> & {
      address: anchor.web3.PublicKey;
    })[];
    const decodedAccounts = validAccounts.map((a) => ({
      address: a.address,
      ...program.coder.accounts.decode("stakeDepositReceipt", a.data),
    }));
    decodedAccountBuffer = [...decodedAccountBuffer, ...decodedAccounts];
    if (pageSize - validAccounts.length > 2) {
      // if there are more than 2 null accounts, we can assume we've reached the last page of StakeDepositReceipts.
      return decodedAccountBuffer;
    }
  }
  return decodedAccountBuffer;
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

/**
 * Filter StakePool's `rewardPools` for those that are initialized.
 * @param rewardPools
 * @returns
 */
export const getRewardPoolPublicKeys = (
  rewardPools: StakePool["rewardPools"]
) =>
  rewardPools
    .filter((rp) => !rp.rewardVault.equals(anchor.web3.PublicKey.default))
    .map((rp) => rp.rewardVault);

/**
 * List of remaining accounts for the `Withdraw` or `Claim` instructions.
 * @param rewardPools
 * @param mints
 * @param owner
 * @returns
 */
export const getRemainingAccountsForClaimOrWithdraw = (
  rewardPools: StakePool["rewardPools"],
  mints: (anchor.web3.PublicKey | null)[],
  owner: anchor.web3.PublicKey
) => {
  return rewardPools.reduce((acc, rp, index) => {
    const mint = mints[index];
    if (rp.rewardVault.equals(anchor.web3.PublicKey.default) || !mint) {
      return acc;
    }
    const tokenAccountKey = getAssociatedTokenAddressSync(mint, owner);
    acc.push({
      pubkey: rp.rewardVault,
      isWritable: true,
      isSigner: false,
    });
    acc.push({
      pubkey: tokenAccountKey,
      isWritable: true,
      isSigner: false,
    });
    return acc;
  }, [] as anchor.web3.AccountMeta[]);
};

/**
 * Calculate stake weight based on StakePool parameters.
 * @param minDuration
 * @param maxDuration
 * @param baseWeight
 * @param maxWeight
 * @param duration
 * @returns
 */
export const calculateStakeWeight = (
  minDuration: anchor.BN,
  maxDuration: anchor.BN,
  baseWeight: anchor.BN,
  maxWeight: anchor.BN,
  duration: anchor.BN
) => {
  const durationSpan = maxDuration.sub(minDuration);
  const durationExceedingMin = duration.sub(minDuration);
  return anchor.BN.max(
    durationExceedingMin
      .mul(SCALE_FACTOR_BASE_BN)
      .mul(maxWeight)
      .div(durationSpan)
      .div(SCALE_FACTOR_BASE_BN),
    baseWeight
  );
};
