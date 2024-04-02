import * as anchor from "@coral-xyz/anchor";
import { SPL_TOKEN_PROGRAM_ID } from "@coral-xyz/spl-token";
import { SCALE_FACTOR_BASE } from "./constants";
import { SplTokenStaking } from "./idl";
import { SplTokenStakingV0 } from "./idl_v0";

/**
 * Initialize the StakePool and set configuration parameters.
 * @param program
 * @param mint
 * @param nonce
 * @param baseWeight
 * @param maxWeight
 * @param minDuration
 * @param maxDuration
 * @param authority - defaults to `program.provider.publicKey`
 * @param registar - Registrar key if this StakePool uses SPL-Governance
 * @param tokenProgram
 */
export const initStakePool = async (
  program: anchor.Program<SplTokenStaking | SplTokenStakingV0>,
  mint: anchor.Address,
  nonce = 0,
  maxWeight = new anchor.BN(SCALE_FACTOR_BASE.toString()),
  minDuration = new anchor.BN(0),
  maxDuration = new anchor.BN("18446744073709551615"),
  authority?: anchor.Address,
  registrar: anchor.web3.PublicKey | null = null,
  tokenProgram: anchor.web3.PublicKey = SPL_TOKEN_PROGRAM_ID
) => {
  const _authority = authority
    ? new anchor.web3.PublicKey(authority)
    : program.provider.publicKey;
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
      new anchor.web3.PublicKey(mint).toBuffer(),
      _authority.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
    program.programId
  );
  await program.methods
    .initializeStakePool(nonce, maxWeight, minDuration, maxDuration, registrar)
    .accounts({
      payer: program.provider.publicKey,
      authority: _authority,
      stakePool: stakePoolKey,
      mint,
      vault: vaultKey,
      tokenProgram: tokenProgram,
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
 * @param authority
 * @param tokenProgram
 * @returns
 */
export const addRewardPool = async (
  program: anchor.Program<SplTokenStaking | SplTokenStakingV0>,
  stakePoolNonce: number,
  stakePoolMint: anchor.Address,
  rewardMint: anchor.web3.PublicKey,
  rewardPoolIndex = 0,
  authority?: anchor.Address,
  tokenProgram: anchor.web3.PublicKey = SPL_TOKEN_PROGRAM_ID,
) => {
  const _authority = authority
    ? new anchor.web3.PublicKey(authority)
    : program.provider.publicKey;
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
      new anchor.web3.PublicKey(stakePoolMint).toBuffer(),
      _authority.toBuffer(),
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
      payer: program.provider.publicKey,
      authority: _authority,
      rewardMint,
      stakePool: stakePoolKey,
      rewardVault: rewardVaultKey,
      tokenProgram: tokenProgram,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
};

/**
 * Returns the Anchor method builder for the Stake (aka Deposit) instruction.
 * @param program
 * @param payer
 * @param owner
 * @param mint
 * @param stakePoolKey
 * @param from
 * @param amount
 * @param duration
 * @param receiptNonce
 * @param rewardVaults
 * @returns
 */
export const createStakeBuilder = (
  program: anchor.Program<SplTokenStaking | SplTokenStakingV0>,
  payer: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
  stakePoolKey: anchor.Address,
  from: anchor.Address,
  amount: anchor.BN,
  duration: anchor.BN,
  receiptNonce: number,
  rewardVaults: anchor.web3.PublicKey[] = []
) => {
  const _stakePoolKey =
    typeof stakePoolKey === "string"
      ? new anchor.web3.PublicKey(stakePoolKey)
      : stakePoolKey;
  const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [_stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
    program.programId
  );
  const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      owner.toBuffer(),
      _stakePoolKey.toBuffer(),
      new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
      Buffer.from("stakeDepositReceipt", "utf-8"),
    ],
    program.programId
  );

  return program.methods
    .deposit(receiptNonce, amount, duration)
    .accounts({
      payer,
      owner,
      mint: mint,
      from,
      stakePool: stakePoolKey,
      vault: vaultKey,
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
    );
};
/**
 * Generate the instruction to Deposit (aka Stake).
 * @param program
 * @param payer
 * @param owner
 * @param mint
 * @param stakePoolKey
 * @param from
 * @param amount
 * @param duration
 * @param receiptNonce
 * @param rewardVaults
 * @returns
 */
export const createStakeInstruction = async (
  program: anchor.Program<SplTokenStaking | SplTokenStakingV0>,
  payer: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
  stakePoolkey: anchor.Address,
  from: anchor.Address,
  amount: anchor.BN,
  duration: anchor.BN,
  receiptNonce: number,
  rewardVaults: anchor.web3.PublicKey[] = []
) => {
  return createStakeBuilder(
    program,
    payer,
    owner,
    mint,
    stakePoolkey,
    from,
    amount,
    duration,
    receiptNonce,
    rewardVaults
  ).instruction();
};

/**
 * Stake with an existing StakePool.
 * @param program
 * @param payer
 * @param owner
 * @param stakePoolKey
 * @param from
 * @param amount
 * @param duration
 * @param receiptNonce
 * @param rewardVaults
 * @param options
 */
export const deposit = async (
  program: anchor.Program<SplTokenStaking | SplTokenStakingV0>,
  payer: anchor.web3.PublicKey,
  owner: anchor.web3.PublicKey,
  mint: anchor.web3.PublicKey,
  stakePoolKey: anchor.Address,
  from: anchor.Address,
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
  return createStakeBuilder(
    program,
    payer,
    owner,
    mint,
    stakePoolKey,
    from,
    amount,
    duration,
    receiptNonce,
    rewardVaults
  )
    .preInstructions(options.preInstructions)
    .postInstructions(options.postInstructions)
    .rpc({ skipPreflight: true });
};

/* Governance plugin related instructions */
export const createRegistrar = async (
  program: anchor.Program<SplTokenStaking>,
  realmAddress: anchor.Address,
  realmGoverningTokenMint: anchor.Address,
  governanceProgramId: anchor.Address,
  realmAuthority: anchor.Address
) => {
  const [registrarKey, registrarBump] =
    anchor.web3.PublicKey.findProgramAddressSync(
      [
        new anchor.web3.PublicKey(realmAddress).toBuffer(),
        new anchor.web3.PublicKey(realmGoverningTokenMint).toBuffer(),
        Buffer.from("registrar", "utf-8"),
      ],
      program.programId
    );
  await program.methods
    .createRegistrar(registrarBump)
    .accounts({
      payer: program.provider.publicKey,
      registrar: registrarKey,
      realm: realmAddress,
      governanceProgramId,
      realmGoverningTokenMint,
      realmAuthority,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .rpc({ skipPreflight: true });
};
