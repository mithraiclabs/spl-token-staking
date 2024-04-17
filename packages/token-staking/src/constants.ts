import * as anchor from "@coral-xyz/anchor";

export const SCALE_FACTOR_BASE = 1_000_000_000n;
export const SCALE_FACTOR_BASE_BN = new anchor.BN(1_000_000_000);
export const U64_MAX = 18446744073709551615n;
export const DAY_IN_SECONDS = 24 * 60 * 60;
export const YEAR_IN_SECONDS = 365 * DAY_IN_SECONDS;
export const STAKE_DEPOSIT_RECEIPT_DISCRIMINATOR = [
  210, 98, 254, 196, 151, 68, 235, 0,
];
export const ESCAPE_HATCH_ENABLED = 1;

export const DEPOSITS_DISABLED = 4;
export const DEPOSIT_IGNORES_LP = 8;
export const WITHDRAW_IGNORES_LP = 16;

export const SPL_TOKEN_STAKING_ID_V0 =
  "STAKEkKzbdeKkqzKpLkNQD3SUuLgshDKCD7U8duxAbB";

export const SPL_TOKEN_STAKING_ID =
  "STAKEGztX7S1MUHxcQHieZhELCntb9Ys9BgUbeEtMu1";

/**
 * @deprecated
 * Use `SPL_TOKEN_STAKING_ID` instead
 */
export const SPL_TOKEN_STAKING_DEVNET_ID = SPL_TOKEN_STAKING_ID;
