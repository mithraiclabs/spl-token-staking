import * as anchor from "@coral-xyz/anchor";
import IDL from "../target/idl/single_sided_staking.json";
import { SingleSidedStaking } from "../target/types/single_sided_staking";
import { SPL_TOKEN_PROGRAM_ID } from "@coral-xyz/spl-token";

export const SCALE_FACTOR_BASE = 1_000_000_000;

export const getMaxNumberOfRewardPools = () =>
  (
    IDL.accounts.find((acc) => acc.name === "StakePool").type.fields as {
      name: string;
      type: any;
    }[]
  ).find((_type) => _type.name === "rewardPools").type.array[1];

export const initStakePool = async (
  program: anchor.Program<SingleSidedStaking>,
  mint: anchor.web3.PublicKey,
  nonce = 0,
  digitShift = 0
) => {
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
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
    .initializeStakePool(nonce, digitShift)
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

export const addRewardPool = async (
  program: anchor.Program<SingleSidedStaking>,
  stakePoolNonce: number,
  rewardMint: anchor.web3.PublicKey,
  rewardPoolIndex = 0
) => {
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
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

export const deposit = async (
  program: anchor.Program<SingleSidedStaking>,
  stakePoolNonce: number,
  depositor: anchor.web3.Keypair,
  vaultMintAccount: anchor.web3.PublicKey,
  stakeMintAccount: anchor.web3.PublicKey,
  amount: anchor.BN,
  duration: anchor.BN,
  receiptNonce: number,
  rewardVaults: anchor.web3.PublicKey[] = []
) => {
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
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
      depositor.publicKey.toBuffer(),
      stakePoolKey.toBuffer(),
      new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
      Buffer.from("stakeDepositReceipt", "utf-8"),
    ],
    program.programId
  );

  await program.methods
    .deposit(receiptNonce, amount, duration)
    .accounts({
      owner: depositor.publicKey,
      from: vaultMintAccount,
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
    .signers([depositor])
    .rpc({ skipPreflight: true });
};
