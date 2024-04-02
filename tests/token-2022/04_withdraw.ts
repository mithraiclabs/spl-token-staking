import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import {
  createDepositorSplAccounts,
  mintToBeStaked,
  rewardMint1,
} from "./hooks22";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  addRewardPool,
  fetchVoterWeightRecord,
  initStakePool,
} from "@mithraic-labs/token-staking";
import { deposit } from ".././utils";
import { assertBNEqual } from ".././genericTests";
import { SplTokenStaking } from "../../target/types/spl_token_staking";

describe("withdraw", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgram = TOKEN_2022_PROGRAM_ID;
  const tokenProgramInstance = splTokenProgram({ programId: tokenProgram });
  const depositor1 = new anchor.web3.Keypair();
  const depositor2 = new anchor.web3.Keypair();
  const stakePoolNonce = 5;
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
      mintToBeStaked.toBuffer(),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
    program.programId
  );
  const [rewardVaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      stakePoolKey.toBuffer(),
      rewardMint1.toBuffer(),
      Buffer.from("rewardVault", "utf-8"),
    ],
    program.programId
  );
  const mintToBeStakedAccountKey = getAssociatedTokenAddressSync(
    mintToBeStaked,
    depositor1.publicKey,
    undefined,
    tokenProgram
  );
  const depositorReward1AccountKey = getAssociatedTokenAddressSync(
    rewardMint1,
    depositor1.publicKey,
    undefined,
    tokenProgram
  );
  const [voterWeightRecordKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      stakePoolKey.toBuffer(),
      depositor1.publicKey.toBuffer(),
      Buffer.from("voterWeightRecord", "utf-8"),
    ],
    program.programId
  );

  before(async () => {
    // set up depositor account and stake pool account
    await Promise.all([
      createDepositorSplAccounts(program, depositor1, stakePoolNonce),
      createDepositorSplAccounts(program, depositor2, stakePoolNonce),
      initStakePool(
        program,
        mintToBeStaked,
        stakePoolNonce,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        tokenProgram
      ),
    ]);
    // add reward pool to the initialized stake pool
    await Promise.all([
      addRewardPool(
        program,
        stakePoolNonce,
        mintToBeStaked,
        rewardMint1,
        undefined,
        undefined,
        tokenProgram
      ),
      program.methods
        .createVoterWeightRecord()
        .accounts({
          owner: depositor1.publicKey,
          registrar: null,
          stakePool: stakePoolKey,
          voterWeightRecord: voterWeightRecordKey,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc(),
    ]);
  });

  it("withdraw unlocked tokens", async () => {
    const receiptNonce = 0;
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor1.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );
    const [
      stakePoolBefore,
      depositerMintAccountBefore,
      voterWeightRecordBefore,
    ] = await Promise.all([
      program.account.stakePool.fetch(stakePoolKey),
      tokenProgramInstance.account.account.fetch(mintToBeStakedAccountKey),
      fetchVoterWeightRecord(program, voterWeightRecordKey),
    ]);
    // deposit 1 token
    await deposit(
      program,
      stakePoolNonce,
      mintToBeStaked,
      depositor1,
      mintToBeStakedAccountKey,
      new anchor.BN(1_000_000_000),
      new anchor.BN(0),
      receiptNonce,
      voterWeightRecordKey,
      undefined,
      tokenProgram
    );

    await program.methods
      .withdraw()
      .accounts({
        claimBase: {
          owner: depositor1.publicKey,
          stakePool: stakePoolKey,
          stakeDepositReceipt: stakeReceiptKey,
          tokenProgram: tokenProgram,
        },
        vault: vaultKey,
        voterWeightRecord: voterWeightRecordKey,
        destination: mintToBeStakedAccountKey,
        mint: mintToBeStaked,
      })
      .remainingAccounts([
        {
          pubkey: rewardVaultKey,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: depositorReward1AccountKey,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: rewardMint1,
          isWritable: false,
          isSigner: false,
        },
      ])
      .signers([depositor1])
      .rpc({ skipPreflight: true });

    const [
      stakePoolAfter,
      depositerMintAccount,
      vaultAfter,
      stakeDepositReceipt,
      voterWeightRecordAfter,
    ] = await Promise.all([
      program.account.stakePool.fetch(stakePoolKey),
      tokenProgramInstance.account.account.fetch(mintToBeStakedAccountKey),
      tokenProgramInstance.account.account.fetch(vaultKey),
      program.provider.connection.getAccountInfo(stakeReceiptKey),
      fetchVoterWeightRecord(program, voterWeightRecordKey),
    ]);
    assertBNEqual(
      voterWeightRecordBefore.voterWeight,
      voterWeightRecordAfter.voterWeight
    );
    assertBNEqual(
      stakePoolBefore.totalWeightedStake,
      stakePoolAfter.totalWeightedStake
    );
    assertBNEqual(
      depositerMintAccount.amount,
      depositerMintAccountBefore.amount
    );
    assertBNEqual(vaultAfter.amount, 0);
    assert.isNull(
      stakeDepositReceipt,
      "StakeDepositReceipt account not closed"
    );
  });
});
