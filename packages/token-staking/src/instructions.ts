import * as anchor from "@coral-xyz/anchor";
import { SPL_TOKEN_PROGRAM_ID } from "@coral-xyz/spl-token";
import { SCALE_FACTOR_BASE } from "./constants";
import { SplTokenStaking } from "./idl";

/**
 * Initialize the StakePool and set configuration parameters.
 * @param program
 * @param mint
 * @param nonce
 * @param baseWeight
 * @param maxWeight
 * @param minDuration
 * @param maxDuration
 */
export const initStakePool = async (
  program: anchor.Program<SplTokenStaking>,
  mint: anchor.Address,
  nonce = 0,
  baseWeight = new anchor.BN(SCALE_FACTOR_BASE.toString()),
  maxWeight = new anchor.BN(SCALE_FACTOR_BASE.toString()),
  minDuration = new anchor.BN(0),
  maxDuration = new anchor.BN("18446744073709551615")
) => {
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
      new anchor.web3.PublicKey(mint).toBuffer(),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const [stakeMintKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("stakeMint", "utf-8")],
    program.programId
  );
  const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
    program.programId
  );
  await program.methods
    .initializeStakePool(nonce, baseWeight, maxWeight, minDuration, maxDuration)
    .accounts({
      authority: program.provider.publicKey,
      stakePool: stakePoolKey,
      stakeMint: stakeMintKey,
      mint,
      vault: vaultKey,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
};

/**
 * Add a RewardPool to an existing StakePool.
 * @param program
 * @param stakePoolNonce
 * @param stakePoolMint
 * @param rewardMint
 * @param rewardPoolIndex
 * @returns
 */
export const addRewardPool = async (
  program: anchor.Program<SplTokenStaking>,
  stakePoolNonce: number,
  stakePoolMint: anchor.Address,
  rewardMint: anchor.web3.PublicKey,
  rewardPoolIndex = 0
) => {
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
      new anchor.web3.PublicKey(stakePoolMint).toBuffer(),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const [rewardVaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      stakePoolKey.toBuffer(),
      rewardMint.toBuffer(),
      Buffer.from("rewardVault", "utf-8"),
    ],
    program.programId
  );
  return program.methods
    .addRewardPool(rewardPoolIndex)
    .accounts({
      authority: program.provider.publicKey,
      rewardMint,
      stakePool: stakePoolKey,
      rewardVault: rewardVaultKey,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
};

/**
 * Stake with an existing StakePool.
 * @param program
 * @param stakePoolNonce
 * @param stakePoolMint
 * @param from
 * @param stakeMintAccount
 * @param amount
 * @param duration
 * @param receiptNonce
 * @param rewardVaults
 * @param options
 */
export const deposit = async (
  program: anchor.Program<SplTokenStaking>,
  stakePoolNonce: number,
  stakePoolMint: anchor.Address,
  from: anchor.Address,
  stakeMintAccount: anchor.Address,
  amount: anchor.BN,
  duration: anchor.BN,
  receiptNonce: number,
  rewardVaults: anchor.web3.PublicKey[] = [],
  options: {
    preInstructions?: anchor.web3.TransactionInstruction[];
    postInstructions?: anchor.web3.TransactionInstruction[];
  } = {
    preInstructions: [],
    postInstructions: [],
  }
) => {
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
      new anchor.web3.PublicKey(stakePoolMint).toBuffer(),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
    program.programId
  );
  const [stakeMint] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("stakeMint", "utf-8")],
    program.programId
  );
  const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      program.provider.publicKey.toBuffer(),
      stakePoolKey.toBuffer(),
      new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
      Buffer.from("stakeDepositReceipt", "utf-8"),
    ],
    program.programId
  );

  return program.methods
    .deposit(receiptNonce, amount, duration)
    .accounts({
      owner: program.provider.publicKey,
      from,
      stakePool: stakePoolKey,
      vault: vaultKey,
      stakeMint,
      destination: stakeMintAccount,
      stakeDepositReceipt: stakeReceiptKey,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .remainingAccounts(
      rewardVaults.map((rewardVaultKey) => ({
        pubkey: rewardVaultKey,
        isWritable: false,
        isSigner: false,
      }))
    )
    .preInstructions(options.preInstructions)
    .postInstructions(options.postInstructions)
    .rpc({ skipPreflight: true });
};
