import * as anchor from "@coral-xyz/anchor";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import _chunk from "lodash.chunk";
import bs58 from "bs58";
import {
  SCALE_FACTOR_BASE,
  SCALE_FACTOR_BASE_BN,
  STAKE_DEPOSIT_RECEIPT_DISCRIMINATOR,
  U64_MAX,
} from "./constants";
import { SplTokenStaking } from "./idl";
import { StakeDepositReceiptData, StakePool } from "./types";

/**
 * Calculate the digit precision loss based on the given maximum weight.
 *
 * @param maxWeight
 * @param maxShift - the decimals of the native mint govern the max allowable shift, as negative
 * exponents are not allowed. Can ignore if you are VERY CONFIDENT your shift will not overflow.
 * @returns
 */
export const getDigitShift = (maxWeight: bigint, maxShift: number = 999) => {
  if (maxShift == 0) {
    return 0;
  }

  let digitShift = 0;
  while (
    (maxWeight * U64_MAX) / SCALE_FACTOR_BASE / BigInt(10 ** digitShift) >
    U64_MAX
  ) {
    digitShift += 1;
    if (digitShift == maxShift) {
      return maxShift;
    }
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
  if (durationSpan.eq(new anchor.BN(0))) {
    return baseWeight;
  }
  const durationExceedingMin = duration.sub(minDuration);
  const normalizedWeight = durationExceedingMin
    .mul(SCALE_FACTOR_BASE_BN)
    .div(durationSpan);
  const weightDiff = maxWeight.sub(baseWeight);

  return anchor.BN.max(
    baseWeight.add(normalizedWeight.mul(weightDiff).div(SCALE_FACTOR_BASE_BN)),
    baseWeight
  );
};

export const fetchChunkedListOfStakeReceiptKeysWithinTimeFrame = async (
  program: anchor.Program<SplTokenStaking>,
  stakePool: anchor.Address,
  startTime: number | string = 0,
  endTime: number | string = Number.MAX_SAFE_INTEGER,
  pageCount = 50
) => {
  const startTimeBN = new anchor.BN(startTime);
  const endTimeBN = new anchor.BN(endTime);
  const discriminatorFilter = {
    // ensure it's `StakeDepositReceipt`
    memcmp: {
      offset: 0,
      bytes: bs58.encode(STAKE_DEPOSIT_RECEIPT_DISCRIMINATOR),
    },
  };
  const stakePoolFilter = {
    // filter by `StakePool` address
    memcmp: {
      offset: 8 + 32 + 32,
      bytes: new anchor.web3.PublicKey(stakePool).toBase58(),
    },
  };
  // pre-fetch addresses without data, so we can paginate
  const accountInfos = await program.provider.connection.getProgramAccounts(
    program.programId,
    {
      // only fetch the `deposit_timestamp` value, so we can further filter
      dataSlice: { offset: 8 + 32 + 32 + 32 + 8, length: 8 },
      filters: [discriminatorFilter, stakePoolFilter],
    }
  );
  // Filter fetched accounts by the `deposit_timestamp`
  const accountInfosWithinTimeframe = accountInfos.filter((a) => {
    const timeInSeconds = new anchor.BN(a.account.data, "le");
    return timeInSeconds.gte(startTimeBN) && timeInSeconds.lte(endTimeBN);
  });
  const keyList = accountInfosWithinTimeframe.map((a) => a.pubkey);

  // allow 50 per fetchMultiple
  return _chunk(keyList, pageCount);
};

/**
 * Fetch an chunked array of StakeReceipts by StakePool and optionally
 * filtered by `deposit_timestamp` using an inclusive start and end time.
 * @param program
 * @param stakePool
 * @param startTime - (in seconds) inclusive startTime to filter `deposit_timestamp`
 * @param endTime - (in seconds) inclusive endTime to filter `deposit_timestamp`
 * @returns
 */
export const fetchStakeReceiptsOfStakersWithinTimeFrame = async (
  program: anchor.Program<SplTokenStaking>,
  stakePool: anchor.Address,
  startTime: number | string = 0,
  endTime: number | string = Number.MAX_SAFE_INTEGER
) => {
  // allow 50 per fetchMultiple
  const chunkedKeys = await fetchChunkedListOfStakeReceiptKeysWithinTimeFrame(
    program,
    stakePool,
    startTime,
    endTime
  );
  const chunkedStakeReceipts = await Promise.all(
    chunkedKeys.map((keys) =>
      program.account.stakeDepositReceipt.fetchMultiple(keys)
    )
  );

  return chunkedStakeReceipts;
};
