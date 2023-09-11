import { IdlAccounts } from "@coral-xyz/anchor";
import { SplTokenStaking } from "./idl";

export type StakePool = IdlAccounts<SplTokenStaking>["stakePool"];
export type StakeDepositReceipt =
  IdlAccounts<SplTokenStaking>["stakeDepositReceipt"];
