import * as anchor from "@coral-xyz/anchor";
import { SPL_TOKEN_PROGRAM_ID } from "@coral-xyz/spl-token";
import { SplTokenStaking } from "@mithraic-labs/token-staking";
import {
  GOVERNANCE_PROGRAM_SEED,
  SPL_GOVERNANCE_IDL,
} from "@mithraic-labs/spl-governance";
import {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";

/**
 * Stake with an existing StakePool.
 * @param program
 * @param stakePoolNonce
 * @param depositor
 * @param vaultMintAccount
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
  amount: anchor.BN,
  duration: anchor.BN,
  receiptNonce: number,
  voterWeightRecord: anchor.Address,
  rewardVaults: anchor.web3.PublicKey[] = [],
  tokenProgram: anchor.web3.PublicKey = SPL_TOKEN_PROGRAM_ID
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
      payer: depositor.publicKey,
      owner: depositor.publicKey,
      mint: stakePoolMint,
      from: vaultMintAccount,
      stakePool: stakePoolKey,
      vault: vaultKey,
      voterWeightRecord,
      stakeDepositReceipt: stakeReceiptKey,
      tokenProgram: tokenProgram,
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
};

export const createRealm = (
  program: anchor.Program<typeof SPL_GOVERNANCE_IDL>,
  realmName: string,
  realmGoverningTokenMint: anchor.web3.PublicKey,
  realmAuthority: anchor.web3.PublicKey,
  voterWeightAddinAddress?: anchor.web3.PublicKey
) => {
  const [realmAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
      Buffer.from(realmName, "utf-8"),
    ],
    program.programId
  );
  const [communityTokenHoldingAddress] =
    anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
        realmAddress.toBuffer(),
        realmGoverningTokenMint.toBuffer(),
      ],
      program.programId
    );
  const [realmConfigAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("realm-config", "utf-8"), realmAddress.toBuffer()],
    program.programId
  );

  return program.methods
    .createRealm(realmName, {
      communityTokenConfigArgs: {
        useVoterWeightAddin: !!voterWeightAddinAddress,
        useMaxVoterWeightAddin: false,
        tokenType: { liquid: {} },
      },
      councilTokenConfigArgs: {
        useVoterWeightAddin: false,
        useMaxVoterWeightAddin: false,
        tokenType: { liquid: {} },
      },
      useCouncilMint: false,
      minCommunityWeightToCreateGovernance: new anchor.BN(100),
      communityMintMaxVoteWeightSource: { absolute: [new anchor.BN(5)] },
    })
    .accounts({
      realmAddress,
      realmAuthority,
      communityTokenMint: realmGoverningTokenMint,
      communityTokenHoldingAddress,
      payer: program.provider.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
      tokenProgram: TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    })
    .remainingAccounts([
      {
        pubkey: realmConfigAddress,
        isSigner: false,
        isWritable: true,
      },
      // since `communityTokenConfigArgs.useVoterWeightAddin` is true, we must append the program ID
      ...(voterWeightAddinAddress
        ? [
            {
              pubkey: voterWeightAddinAddress,
              isSigner: false,
              isWritable: false,
            },
          ]
        : []),
    ])
    .rpc({ skipPreflight: true });
};
