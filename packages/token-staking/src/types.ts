import { IdlAccounts, web3 } from "@coral-xyz/anchor";
import { SplTokenStaking } from "./idl";

export type StakePool = IdlAccounts<SplTokenStaking>["stakePool"];
export type StakeDepositReceipt =
  IdlAccounts<SplTokenStaking>["stakeDepositReceipt"];
export type StakeDepositReceiptData = StakeDepositReceipt & {
  address: web3.PublicKey;
};
