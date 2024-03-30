import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import {
  createDepositorSplAccounts,
  mintToBeStaked,
  rewardMint1,
  rewardMint2,
} from "./hooks";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  addRewardPool,
  initStakePool,
  SplTokenStaking,
} from "@mithraic-labs/token-staking";
import { deposit } from "./utils";
import { assertBNEqual } from "./genericTests";

describe.only("multiple-rewards", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgram = splTokenProgram({ programId: TOKEN_PROGRAM_ID });
  const depositor1 = new anchor.web3.Keypair();
  const depositor2 = new anchor.web3.Keypair();
  const stakePoolNonce = 10;
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
      mintToBeStaked.toBuffer(),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const [stakeMint] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("stakeMint", "utf-8")],
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
    depositor1.publicKey
  );
  const stakeMintAccountKey = getAssociatedTokenAddressSync(
    stakeMint,
    depositor1.publicKey
  );
  const depositerReward1AccKey = getAssociatedTokenAddressSync(
    rewardMint1,
    depositor1.publicKey
  );

  before(async () => {
    // set up depositor account and stake pool account
    await Promise.all([
      createDepositorSplAccounts(program, depositor1, stakePoolNonce),
      createDepositorSplAccounts(program, depositor2, stakePoolNonce),
      initStakePool(program, mintToBeStaked, stakePoolNonce),
    ]);
    // add reward pool to the initialized stake pool
    await Promise.all([
      addRewardPool(program, stakePoolNonce, mintToBeStaked, rewardMint1),
    ]);
  });

  it("Should claim second reward even if first reward has none claimable", async () => {
    const receiptNonce = 0;
    const receipt2Nonce = 0;
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor1.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );
    const [depositor2StakeReceiptKey] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          depositor2.publicKey.toBuffer(),
          stakePoolKey.toBuffer(),
          new anchor.BN(receipt2Nonce).toArrayLike(Buffer, "le", 4),
          Buffer.from("stakeDepositReceipt", "utf-8"),
        ],
        program.programId
      );
    const mintToBeStakedAccountKey2 = getAssociatedTokenAddressSync(
      mintToBeStaked,
      depositor2.publicKey
    );
    const stakeMintAccountKey2 = getAssociatedTokenAddressSync(
      stakeMint,
      depositor2.publicKey
    );
    // deposit 1 token
    await deposit(
      program,
      stakePoolNonce,
      mintToBeStaked,
      depositor1,
      mintToBeStakedAccountKey,
      stakeMintAccountKey,
      new anchor.BN(1_000_000_000),
      new anchor.BN(0),
      receiptNonce
    );
    // Second user deposits same amount of user 1. They should
    // now receive the same amount of any future rewards deposited
    await deposit(
      program,
      stakePoolNonce,
      mintToBeStaked,
      depositor2,
      mintToBeStakedAccountKey2,
      stakeMintAccountKey2,
      new anchor.BN(1_000_000_000),
      new anchor.BN(0),
      receipt2Nonce,
      [rewardVaultKey]
    );

    const totalReward1 = 1_000_000_000;
    const transferIx = createTransferInstruction(
      getAssociatedTokenAddressSync(rewardMint1, program.provider.publicKey),
      rewardVaultKey,
      program.provider.publicKey,
      totalReward1
    );
    const createDepositorReward1AccountIx =
      createAssociatedTokenAccountInstruction(
        program.provider.publicKey,
        depositerReward1AccKey,
        depositor1.publicKey,
        rewardMint1,
        TOKEN_PROGRAM_ID
      );
    // transfer 1 reward token to RewardPool at index 0
    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction()
        .add(transferIx)
        .add(createDepositorReward1AccountIx)
    );

    // NOTE: we must pass an array of RewardPoolVault and user token accounts
    // as remaining accounts
    await program.methods
      .claimAll()
      .accounts({
        claimBase: {
          owner: depositor1.publicKey,
          stakePool: stakePoolKey,
          stakeDepositReceipt: stakeReceiptKey,
        },
      })
      .signers([depositor1])
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
      .rpc({ skipPreflight: true });

    const [depositerReward1Account, stakeReceipt, stakePool] =
      await Promise.all([
        tokenProgram.account.account.fetch(depositerReward1AccKey),
        program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
        program.account.stakePool.fetch(stakePoolKey),
      ]);
    assertBNEqual(depositerReward1Account.amount, totalReward1 / 2);
    assertBNEqual(stakeReceipt.claimedAmounts[0], totalReward1 / 2);
    assertBNEqual(stakePool.rewardPools[0].lastAmount, totalReward1 / 2);
    assertBNEqual(
      stakePool.rewardPools[0].rewardsPerEffectiveStake,
      totalReward1 / 2 // scale weight =1
    );

    // add second reward pool AFTER all reward 1 was claimed
    await addRewardPool(
      program,
      stakePoolNonce,
      mintToBeStaked,
      rewardMint2,
      1
    );
    const [reward2VaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        stakePoolKey.toBuffer(),
        rewardMint2.toBuffer(),
        Buffer.from("rewardVault", "utf-8"),
      ],
      program.programId
    );
    const totalReward2 = 500_000_000;
    const transferIx2 = createTransferInstruction(
      getAssociatedTokenAddressSync(rewardMint2, program.provider.publicKey),
      reward2VaultKey,
      program.provider.publicKey,
      totalReward2
    );
    const depositerReward2AccountKey = getAssociatedTokenAddressSync(
      rewardMint2,
      depositor1.publicKey
    );
    const createDepositorReward2AccountIx =
      createAssociatedTokenAccountInstruction(
        program.provider.publicKey,
        depositerReward2AccountKey,
        depositor1.publicKey,
        rewardMint2,
        TOKEN_PROGRAM_ID
      );
    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction()
        .add(transferIx2)
        .add(createDepositorReward2AccountIx)
    );

    const [depositerReward1AccountBefore, depositerReward2AccountBefore] =
      await Promise.all([
        tokenProgram.account.account.fetch(depositerReward1AccKey),
        tokenProgram.account.account.fetch(depositerReward2AccountKey),
      ]);

    await program.methods
      .claimAll()
      .accounts({
        claimBase: {
          owner: depositor1.publicKey,
          stakePool: stakePoolKey,
          stakeDepositReceipt: stakeReceiptKey,
        },
      })
      .signers([depositor1])
      .remainingAccounts([
        // reward 1
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
        // reward 2
        {
          pubkey: reward2VaultKey,
          isWritable: true,
          isSigner: false,
        },
        {
          pubkey: depositerReward2AccountKey,
          isWritable: true,
          isSigner: false,
        },
      ])
      .rpc({ skipPreflight: true });
    const [depositerReward1AccountAfter, depositerReward2AccountAfter] =
      await Promise.all([
        tokenProgram.account.account.fetch(depositerReward1AccKey),
        tokenProgram.account.account.fetch(depositerReward2AccountKey),
      ]);
    assertBNEqual(
      depositerReward1AccountBefore.amount,
      depositerReward1AccountAfter.amount
    );
    assertBNEqual(
      depositerReward2AccountBefore.amount.add(new anchor.BN(totalReward2 / 2)),
      depositerReward2AccountAfter.amount
    );
  });
});
