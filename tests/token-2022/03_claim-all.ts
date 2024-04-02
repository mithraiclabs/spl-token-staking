import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import {
  createDepositorSplAccounts,
  mintToBeStaked,
  rewardMint1,
  rewardMint2,
} from "./hooks22";
import {
  TOKEN_2022_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createBurnInstruction,
  createMintToInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  addRewardPool,
  initStakePool,
  SplTokenStaking,
} from "@mithraic-labs/token-staking";
import { deposit } from ".././utils";
import { assertBNEqual } from ".././genericTests";
import { Transaction } from "@solana/web3.js";

describe("claim-all", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgram = TOKEN_2022_PROGRAM_ID;
  const splTokenProgramInstance = splTokenProgram({
    programId: TOKEN_2022_PROGRAM_ID,
  });
  const depositor1 = new anchor.web3.Keypair();
  const depositor2 = new anchor.web3.Keypair();
  const stakePoolNonce = 4;
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
      mintToBeStaked.toBuffer(),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
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
  const depositerReward1AccKey = getAssociatedTokenAddressSync(
    rewardMint1,
    depositor1.publicKey,
    undefined,
    tokenProgram
  );
  const [voterWeightRecordKey1] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      stakePoolKey.toBuffer(),
      depositor1.publicKey.toBuffer(),
      Buffer.from("voterWeightRecord", "utf-8"),
    ],
    program.programId
  );
  const [voterWeightRecordKey2] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      stakePoolKey.toBuffer(),
      depositor2.publicKey.toBuffer(),
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
          voterWeightRecord: voterWeightRecordKey1,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc(),
      program.methods
        .createVoterWeightRecord()
        .accounts({
          owner: depositor2.publicKey,
          registrar: null,
          stakePool: stakePoolKey,
          voterWeightRecord: voterWeightRecordKey2,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc(),
    ]);
  });

  it("Claim all owed rewards", async () => {
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
      voterWeightRecordKey1,
      undefined,
      tokenProgram
    );
    const totalReward1 = 1_000_000_000;
    const transferIx = createTransferInstruction(
      getAssociatedTokenAddressSync(
        rewardMint1,
        program.provider.publicKey,
        undefined,
        tokenProgram
      ),
      rewardVaultKey,
      program.provider.publicKey,
      totalReward1,
      [],
      tokenProgram
    );
    const createDepositorReward1AccountIx =
      createAssociatedTokenAccountInstruction(
        program.provider.publicKey,
        depositerReward1AccKey,
        depositor1.publicKey,
        rewardMint1,
        tokenProgram
      );
    // transfer 1 reward token to RewardPool at index 0
    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction()
        .add(transferIx)
        .add(createDepositorReward1AccountIx)
    );

    // NOTE: we must pass an array of RewardPoolVault and user token accounts
    // as remaining accounts
    let ix = await program.methods
      .claimAll()
      .accounts({
        claimBase: {
          owner: depositor1.publicKey,
          stakePool: stakePoolKey,
          rewardMint: rewardMint1,
          stakeDepositReceipt: stakeReceiptKey,
          tokenProgram: tokenProgram,
        },
      })
      .remainingAccounts([
        {
          pubkey: rewardVaultKey,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: depositerReward1AccKey,
          isWritable: true,
          isSigner: false,
        },
      ])
      .instruction();

      try{
    await program.provider.sendAndConfirm(new Transaction().add(ix), [
      depositor1,
    ]);
  }catch(err){
    console.log(err);
  }

    const [depositerReward1Account, stakeReceipt, stakePool] =
      await Promise.all([
        splTokenProgramInstance.account.account.fetch(depositerReward1AccKey),
        program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
        program.account.stakePool.fetch(stakePoolKey),
      ]);

    assertBNEqual(depositerReward1Account.amount, totalReward1);
    assertBNEqual(stakeReceipt.claimedAmounts[0], totalReward1);
    assertBNEqual(stakePool.rewardPools[0].lastAmount, 0);
    assertBNEqual(
      stakePool.rewardPools[0].rewardsPerEffectiveStake,
      totalReward1 // scale weight =1
    );
  });
});
