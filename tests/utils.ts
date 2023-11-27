import * as anchor from "@coral-xyz/anchor";
import { SPL_TOKEN_PROGRAM_ID } from "@coral-xyz/spl-token";
import { SplTokenStaking } from "@mithraic-labs/token-staking";

/**
 * Stake with an existing StakePool.
 * @param program
 * @param stakePoolNonce
 * @param depositor
 * @param vaultMintAccount
 * @param stakeMintAccount
 * @param amount
 * @param duration
 * @param receiptNonce
 * @param rewardVaults
 */
export const deposit = async (
  program: anchor.Program<SplTokenStaking>,
  stakePoolNonce: number,
  stakePoolMint: anchor.Address,
  depositor: anchor.web3.Keypair,
  vaultMintAccount: anchor.Address,
  stakeMintAccount: anchor.Address,
  amount: anchor.BN,
  duration: anchor.BN,
  receiptNonce: number,
  rewardVaults: anchor.web3.PublicKey[] = []
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
      depositor.publicKey.toBuffer(),
      stakePoolKey.toBuffer(),
      new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
      Buffer.from("stakeDepositReceipt", "utf-8"),
    ],
    program.programId
  );
try{
  await program.methods
    .deposit(receiptNonce, amount, duration)
    .accounts({
      payer: depositor.publicKey,
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
    .rpc();
}catch(err)
{console.log(err);}
};
