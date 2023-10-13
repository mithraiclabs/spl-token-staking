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
import { deposit } from "./utils";
import { assertBNEqual } from "./genericTests";
import { Transaction } from "@solana/web3.js";

describe("claim-all", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgram = splTokenProgram({ programId: TOKEN_PROGRAM_ID });
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
      stakeMintAccountKey,
      new anchor.BN(1_000_000_000),
      new anchor.BN(0),
      receiptNonce
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
    assertBNEqual(depositerReward1Account.amount, totalReward1);
    assertBNEqual(stakeReceipt.claimedAmounts[0], totalReward1);
    assertBNEqual(stakePool.rewardPools[0].lastAmount, 0);
    assertBNEqual(
      stakePool.rewardPools[0].rewardsPerEffectiveStake,
      totalReward1 // scale weight =1
    );
  });

  it("Claim rewards split among multiple depositors", async () => {
    const receipt1Nonce = 0;
    const receipt2Nonce = 0;
    const getStakeReceiptKey = (pubkey: anchor.web3.PublicKey) =>
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          pubkey.toBuffer(),
          stakePoolKey.toBuffer(),
          new anchor.BN(receipt1Nonce).toArrayLike(Buffer, "le", 4),
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
    const depositerReward1AccountKey2 = getAssociatedTokenAddressSync(
      rewardMint1,
      depositor2.publicKey
    );
    const [stake1ReceiptKey] = getStakeReceiptKey(depositor1.publicKey);
    const [stake2ReceiptKey] = getStakeReceiptKey(depositor2.publicKey);

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
    const createDepositor2Reward1AccountIx =
      createAssociatedTokenAccountInstruction(
        program.provider.publicKey,
        depositerReward1AccountKey2,
        depositor2.publicKey,
        rewardMint1,
        TOKEN_PROGRAM_ID
      );
    // transfer 1 reward token to RewardPool at index 0
    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction()
        .add(transferIx)
        .add(createDepositor2Reward1AccountIx)
    );

    const [
      depositerReward1AccountBefore,
      depositerReward1AccountBefore2,
      stakeReceipt2Before,
    ] = await Promise.all([
      tokenProgram.account.account.fetch(depositerReward1AccKey),
      tokenProgram.account.account.fetch(depositerReward1AccountKey2),
      program.account.stakeDepositReceipt.fetch(stake2ReceiptKey),
    ]);
    // User 2 gets claim credit (but not funds) for the claims that occured before they deposited
    assertBNEqual(stakeReceipt2Before.claimedAmounts[0], totalReward1);

    await Promise.all([
      program.methods
        .claimAll()
        .accounts({
          claimBase: {
            owner: depositor1.publicKey,
            stakePool: stakePoolKey,
            stakeDepositReceipt: stake1ReceiptKey,
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
        .rpc({ skipPreflight: true }),
      program.methods
        .claimAll()
        .accounts({
          claimBase: {
            owner: depositor2.publicKey,
            stakePool: stakePoolKey,
            stakeDepositReceipt: stake2ReceiptKey,
          },
        })
        .signers([depositor2])
        .remainingAccounts([
          {
            pubkey: rewardVaultKey,
            isWritable: true,
            isSigner: false,
          },
          {
            pubkey: depositerReward1AccountKey2,
            isWritable: true,
            isSigner: false,
          },
        ])
        .rpc({ skipPreflight: true }),
    ]);

    const [
      depositerReward1Account,
      depositerReward1Account2,
      stake1Receipt,
      stake2Receipt,
      stakePool,
    ] = await Promise.all([
      tokenProgram.account.account.fetch(depositerReward1AccKey),
      tokenProgram.account.account.fetch(depositerReward1AccountKey2),
      program.account.stakeDepositReceipt.fetch(stake1ReceiptKey),
      program.account.stakeDepositReceipt.fetch(stake2ReceiptKey),
      program.account.stakePool.fetch(stakePoolKey),
    ]);
    // user 1 should have had reward token account balance increase by half of the transferred
    // rewards.
    let reward1Expected = depositerReward1AccountBefore.amount.add(
      new anchor.BN(totalReward1 / 2)
    );
    assertBNEqual(depositerReward1Account.amount, reward1Expected);
    assertBNEqual(stake1Receipt.claimedAmounts[0], reward1Expected);

    assertBNEqual(stakePool.rewardPools[0].lastAmount, 0);
    assertBNEqual(
      stakePool.rewardPools[0].rewardsPerEffectiveStake,
      reward1Expected
    );

    // User 2 gains the same, but they already got claim credit for the rewards they missed
    let reward2Expected = depositerReward1AccountBefore2.amount.add(
      new anchor.BN(totalReward1 / 2)
    );
    assertBNEqual(depositerReward1Account2.amount, reward2Expected);
    assertBNEqual(
      stake2Receipt.claimedAmounts[0],
      totalReward1 + totalReward1 / 2
    );
  });

  it("Should not change balance if user has already claimed rewards", async () => {
    const receipt1Nonce = 0;
    const getStakeReceiptKey = (pubkey: anchor.web3.PublicKey) =>
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          pubkey.toBuffer(),
          stakePoolKey.toBuffer(),
          new anchor.BN(receipt1Nonce).toArrayLike(Buffer, "le", 4),
          Buffer.from("stakeDepositReceipt", "utf-8"),
        ],
        program.programId
      );
    const [stake1ReceiptKey] = getStakeReceiptKey(depositor1.publicKey);

    const depositerReward1AccountBefore =
      await tokenProgram.account.account.fetch(depositerReward1AccKey);

    await program.methods
      .claimAll()
      .accounts({
        claimBase: {
          owner: depositor1.publicKey,
          stakePool: stakePoolKey,
          stakeDepositReceipt: stake1ReceiptKey,
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

    const [depositerReward1Account, stake1Receipt] = await Promise.all([
      tokenProgram.account.account.fetch(depositerReward1AccKey),
      program.account.stakeDepositReceipt.fetch(stake1ReceiptKey),
    ]);
    // user 1 should have the same amount when claiming after already claimed (from prev. tests)
    assertBNEqual(
      depositerReward1Account.amount,
      depositerReward1AccountBefore.amount
    );
    assertBNEqual(
      stake1Receipt.claimedAmounts[0],
      depositerReward1Account.amount
    );
  });

  it("should collect multiple rewards", async () => {
    await addRewardPool(
      program,
      stakePoolNonce,
      mintToBeStaked,
      rewardMint2,
      1
    );
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
    const [reward2VaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        stakePoolKey.toBuffer(),
        rewardMint2.toBuffer(),
        Buffer.from("rewardVault", "utf-8"),
      ],
      program.programId
    );

    const totalReward1 = 1_000_000_000;
    const totalReward2 = 1_000_000_000;
    const transferIx = createTransferInstruction(
      getAssociatedTokenAddressSync(rewardMint1, program.provider.publicKey),
      rewardVaultKey,
      program.provider.publicKey,
      totalReward1
    );
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
    // transfer 1 reward token to RewardPool at index 0
    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction()
        .add(transferIx)
        .add(transferIx2)
        .add(createDepositorReward2AccountIx)
    );

    const [depositerReward1AccountBefore, depositerReward2AccountBefore] =
      await Promise.all([
        tokenProgram.account.account.fetch(depositerReward1AccKey),
        tokenProgram.account.account.fetch(depositerReward2AccountKey),
      ]);

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

    const [depositerReward1Account, depositerReward2Account] =
      await Promise.all([
        tokenProgram.account.account.fetch(depositerReward1AccKey),
        tokenProgram.account.account.fetch(depositerReward2AccountKey),
      ]);
    // NOTE: must divide rewards by 2 because of previous test and depositor2
    assert.equal(
      depositerReward1Account.amount.toNumber(),
      depositerReward1AccountBefore.amount
        .add(new anchor.BN(totalReward1 / 2))
        .toNumber()
    );
    assert.equal(
      depositerReward2Account.amount.toNumber(),
      depositerReward2AccountBefore.amount
        .add(new anchor.BN(totalReward2 / 2))
        .toNumber()
    );
  });

  // Note: Eventually, the u128 will overflow and fail at checked_add, but this is unlikely to occur
  // in practice, since it would many multiples of u64::max distributions.
  it("Big reward doesn't overflow", async () => {
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
    const [reward2VaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        stakePoolKey.toBuffer(),
        rewardMint2.toBuffer(),
        Buffer.from("rewardVault", "utf-8"),
      ],
      program.programId
    );
    const depositerReward2AccountKey = getAssociatedTokenAddressSync(
      rewardMint2,
      depositor1.publicKey
    );

    // about half of u64 max (18_446_744_073_709_551_614)
    const totalRewardBN = new anchor.BN("9446744073709551614");
    const totalReward1 = BigInt("9446744073709551614");

    for (let i = 0; i < 10; i++) {
      const [rewardVault] = await Promise.all([
        tokenProgram.account.account.fetch(rewardVaultKey),
      ]);
      let toFund = BigInt(totalRewardBN.sub(rewardVault.amount).toString());

      const fundIx = createMintToInstruction(
        rewardMint1,
        rewardVaultKey,
        program.provider.publicKey,
        toFund
      );

      // mint reward tokens
      try {
        await program.provider.sendAndConfirm(
          new anchor.web3.Transaction().add(fundIx)
        );
      } catch (err) {
        console.log(err);
        // This can fail, we don't care...
      }

      const [stake1ReceiptBefore] = await Promise.all([
        program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
      ]);

      await program.provider.sendAndConfirm(
        new Transaction().add(
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
            .instruction()
        ),
        [depositor1]
      );

      const [depositerReward1Acc] = await Promise.all([
        tokenProgram.account.account.fetch(depositerReward1AccKey),
      ]);

      // Burn the rewards so the token account itself doesn't overflow
      try {
        await program.provider.sendAndConfirm(
          new Transaction().add(
            createBurnInstruction(
              depositerReward1AccKey,
              rewardMint1,
              depositor1.publicKey,
              BigInt(depositerReward1Acc.amount.toString())
            )
          ),
          [depositor1]
        );
      } catch (err) {
        //this can fail, we don't care
      }

      const [stake1Receipt] = await Promise.all([
        program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
      ]);
      console.log(
        "claimed before: " +
          stake1ReceiptBefore.claimedAmounts[0].toString() +
          " after " +
          stake1Receipt.claimedAmounts[0].toString() +
          " diff " +
          stake1Receipt.claimedAmounts[0]
            .sub(stake1ReceiptBefore.claimedAmounts[0])
            .toString()
      );
    }

    //assertBNEqual(stake1Receipt.claimedAmounts[0], totalReward1);
  });
});
