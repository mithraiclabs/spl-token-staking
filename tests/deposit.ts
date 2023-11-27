import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import { assert } from "chai";
import {
  rewardMint1,
  mintToBeStaked,
  createDepositorSplAccounts,
  TEST_MINT_DECIMALS,
} from "./hooks";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
} from "@solana/spl-token";
import {
  SCALE_FACTOR_BASE,
  SCALE_FACTOR_BASE_BN,
  SplTokenStaking,
  addRewardPool,
  calculateStakeWeight,
  getDigitShift,
  getNextUnusedStakeReceiptNonce,
  initStakePool,
} from "@mithraic-labs/token-staking";
import { assertBNEqual, assertKeysEqual } from "./genericTests";

const scaleFactorBN = new anchor.BN(SCALE_FACTOR_BASE.toString());

describe("deposit", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgram = splTokenProgram({ programId: TOKEN_PROGRAM_ID });
  const depositor = new anchor.web3.Keypair();

  const stakePoolNonce = 7; // TODO unique global nonce generation?
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
  const stakeMintAccountKey = getAssociatedTokenAddressSync(
    stakeMint,
    depositor.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  const mintToBeStakedAccount = getAssociatedTokenAddressSync(
    mintToBeStaked,
    depositor.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  const deposit1Amount = new anchor.BN(5_000_000_000);
  const deposit2Amount = new anchor.BN(1_000_000_000);
  const maxWeight = new anchor.BN(4 * parseInt(SCALE_FACTOR_BASE.toString()));
  const minDuration = new anchor.BN(1000);
  const maxDuration = new anchor.BN(4 * 31536000);
  const digitShift = getDigitShift(
    BigInt(maxWeight.toString()),
    TEST_MINT_DECIMALS
  );

  before(async () => {
    // set up depositor account and stake pool account
    await Promise.all([
      createDepositorSplAccounts(program, depositor, stakePoolNonce),
      initStakePool(
        program,
        mintToBeStaked,
        stakePoolNonce,
        maxWeight,
        minDuration,
        maxDuration
      ),
    ]);
    // add reward pool to the initialized stake pool
    await addRewardPool(program, stakePoolNonce, mintToBeStaked, rewardMint1);
  });

  it("First Deposit (5) successful", async () => {
    const nextNonce = await getNextUnusedStakeReceiptNonce(
      program.provider.connection,
      program.programId,
      depositor.publicKey,
      stakePoolKey
    );
    assert.equal(nextNonce, 0);
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(nextNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );
    const mintToBeStakedAccountBefore =
      await tokenProgram.account.account.fetch(mintToBeStakedAccount);

    await program.methods
      .deposit(nextNonce, deposit1Amount, minDuration)
      .accounts({
        payer: depositor.publicKey,
        owner: depositor.publicKey,
        from: mintToBeStakedAccount,
        stakePool: stakePoolKey,
        vault: vaultKey,
        stakeMint,
        destination: stakeMintAccountKey,
        stakeDepositReceipt: stakeReceiptKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([depositor])
      .rpc({ skipPreflight: true });
    const [
      mintToBeStakedAccountAfter,
      vault,
      stakeMintAccount,
      stakeReceipt,
      stakePool,
    ] = await Promise.all([
      tokenProgram.account.account.fetch(mintToBeStakedAccount),
      tokenProgram.account.account.fetch(vaultKey),
      tokenProgram.account.account.fetch(stakeMintAccountKey),
      program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
      program.account.stakePool.fetch(stakePoolKey),
    ]);
    assertBNEqual(
      mintToBeStakedAccountBefore.amount.sub(deposit1Amount),
      mintToBeStakedAccountAfter.amount
    );
    assertBNEqual(
      stakeMintAccount.amount,
      deposit1Amount.div(new anchor.BN(10 ** digitShift))
    );
    assertBNEqual(vault.amount, deposit1Amount);
    assertKeysEqual(stakeReceipt.stakePool, stakePoolKey);
    assertKeysEqual(stakeReceipt.owner, depositor.publicKey);
    assertKeysEqual(stakeReceipt.payer, depositor.publicKey);
    assertBNEqual(stakeReceipt.depositAmount, deposit1Amount);
    stakeReceipt.claimedAmounts.forEach((claimed, index) => {
      assert.equal(claimed.toString(), "0", `claimed index ${index} failed`);
    });
    assertBNEqual(stakeReceipt.lockupDuration, minDuration);
    // May be off by 1-2 seconds
    let now = Date.now() / 1000;
    assert.approximately(stakeReceipt.depositTimestamp.toNumber(), now, 2);
    assertBNEqual(
      stakeReceipt.effectiveStake,
      deposit1Amount.mul(scaleFactorBN)
    );
    assertBNEqual(
      stakePool.totalWeightedStake,
      deposit1Amount.mul(scaleFactorBN)
    );
  });

  it("Second Deposit (1) recalculates effective reward per stake", async () => {
    const nextNonce = await getNextUnusedStakeReceiptNonce(
      program.provider.connection,
      program.programId,
      depositor.publicKey,
      stakePoolKey
    );
    assert.equal(nextNonce, 1);
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(nextNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );

    const rewardsTransferAmount = new anchor.BN(10_000_000_000);
    const rewardsPerEffectiveStake = rewardsTransferAmount.div(deposit1Amount);
    const transferIx = createTransferInstruction(
      getAssociatedTokenAddressSync(rewardMint1, program.provider.publicKey),
      rewardVaultKey,
      program.provider.publicKey,
      rewardsTransferAmount.toNumber()
    );

    await program.methods
      .deposit(nextNonce, deposit2Amount, minDuration)
      .accounts({
        payer: depositor.publicKey,
        owner: depositor.publicKey,
        from: mintToBeStakedAccount,
        stakeMint,
        stakePool: stakePoolKey,
        vault: vaultKey,
        destination: stakeMintAccountKey,
        stakeDepositReceipt: stakeReceiptKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        {
          pubkey: rewardVaultKey,
          isWritable: false,
          isSigner: false,
        },
      ])
      .preInstructions([transferIx])
      .signers([depositor])
      .rpc({ skipPreflight: true });
    const [stakeMintAccount, vault, stakeReceipt, stakePool] =
      await Promise.all([
        tokenProgram.account.account.fetch(stakeMintAccountKey),
        tokenProgram.account.account.fetch(vaultKey),
        program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
        program.account.stakePool.fetch(stakePoolKey),
      ]);
    assertBNEqual(vault.amount, deposit1Amount.add(deposit2Amount));
    assertBNEqual(
      stakeMintAccount.amount,
      deposit1Amount.add(deposit2Amount).div(new anchor.BN(10 ** digitShift))
    );
    assertKeysEqual(stakeReceipt.stakePool, stakePoolKey);
    assertBNEqual(stakeReceipt.depositAmount, deposit2Amount);
    assertKeysEqual(stakeReceipt.owner, depositor.publicKey);
    assertKeysEqual(stakeReceipt.payer, depositor.publicKey);
    stakeReceipt.claimedAmounts.forEach((claimed, index) => {
      if (index === 0) {
        // RewardPool 0 should have some claimed amount, so must assert non zero
        assert.equal(
          claimed.toString(),
          rewardsPerEffectiveStake.mul(scaleFactorBN).toString(),
          "incorrect rewards per effective stake"
        );
      } else {
        assert.equal(claimed.toString(), "0", `claimed index ${index} failed`);
      }
    });
    let now = Date.now() / 1000;
    assert.approximately(stakeReceipt.depositTimestamp.toNumber(), now, 2);
    assertBNEqual(
      stakeReceipt.effectiveStake,
      deposit2Amount.mul(scaleFactorBN)
    );
    assertBNEqual(stakeReceipt.lockupDuration, minDuration);

    assertBNEqual(
      stakePool.totalWeightedStake,
      deposit1Amount.mul(scaleFactorBN).add(deposit2Amount.mul(scaleFactorBN))
    );
  });

  it("should scale weight based on lockup duration", async () => {
    const nextNonce = await getNextUnusedStakeReceiptNonce(
      program.provider.connection,
      program.programId,
      depositor.publicKey,
      stakePoolKey
    );
    assert.equal(nextNonce, 2);
    const receiptNonce1 = 2;
    const receiptNonce2 = 3;
    const getStakeReceiptKey = (nonce: number) =>
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          depositor.publicKey.toBuffer(),
          stakePoolKey.toBuffer(),
          new anchor.BN(nonce).toArrayLike(Buffer, "le", 4),
          Buffer.from("stakeDepositReceipt", "utf-8"),
        ],
        program.programId
      );
    const [stakeReceiptKey1] = getStakeReceiptKey(receiptNonce1);
    const [stakeReceiptKey2] = getStakeReceiptKey(receiptNonce2);
    const stakeMintAccountBefore1 = await tokenProgram.account.account.fetch(
      stakeMintAccountKey
    );
    await program.methods
      .deposit(receiptNonce1, deposit2Amount, maxDuration)
      .accounts({
        payer: depositor.publicKey,
        owner: depositor.publicKey,
        from: mintToBeStakedAccount,
        stakePool: stakePoolKey,
        vault: vaultKey,
        stakeMint,
        destination: stakeMintAccountKey,
        stakeDepositReceipt: stakeReceiptKey1,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        {
          pubkey: rewardVaultKey,
          isWritable: false,
          isSigner: false,
        },
      ])
      .signers([depositor])
      .rpc({ skipPreflight: true });
    const [stakeReceipt1, stakeMintAccountAfter1] = await Promise.all([
      program.account.stakeDepositReceipt.fetch(stakeReceiptKey1),
      tokenProgram.account.account.fetch(stakeMintAccountKey),
    ]);
    assertBNEqual(
      stakeReceipt1.effectiveStake,
      stakeReceipt1.depositAmount.mul(maxWeight)
    );
    assertBNEqual(
      stakeMintAccountAfter1.amount,
      // should be 4x the deposit amount
      stakeMintAccountBefore1.amount.add(
        deposit2Amount
          .mul(maxWeight)
          .div(scaleFactorBN)
          .div(new anchor.BN(10 ** digitShift))
      )
    );

    const duration2 = maxDuration.div(new anchor.BN(2));

    await program.methods
      .deposit(receiptNonce2, deposit2Amount, duration2)
      .accounts({
        payer: depositor.publicKey,
        owner: depositor.publicKey,
        from: mintToBeStakedAccount,
        stakePool: stakePoolKey,
        vault: vaultKey,
        stakeMint,
        destination: stakeMintAccountKey,
        stakeDepositReceipt: stakeReceiptKey2,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        {
          pubkey: rewardVaultKey,
          isWritable: false,
          isSigner: false,
        },
      ])
      .signers([depositor])
      .rpc({ skipPreflight: true });
    const [stakeReceipt2, stakeMintAccountAfter2] = await Promise.all([
      program.account.stakeDepositReceipt.fetch(stakeReceiptKey2),
      tokenProgram.account.account.fetch(stakeMintAccountKey),
    ]);
    const weight = calculateStakeWeight(
      minDuration,
      maxDuration,
      SCALE_FACTOR_BASE_BN,
      maxWeight,
      duration2
    );
    assertBNEqual(
      stakeReceipt2.effectiveStake,
      stakeReceipt2.depositAmount.mul(weight)
    );
    assertBNEqual(
      stakeMintAccountAfter2.amount,
      // should be just under 2x the deposit amount
      stakeMintAccountAfter1.amount.add(
        deposit2Amount
          .mul(weight)
          .div(scaleFactorBN)
          .div(new anchor.BN(10 ** digitShift))
      )
    );
  });

  it("Bad token account supplied - fails", async () => {
    const nextNonce = 4;
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(nextNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );
    const [badStakePool] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        new anchor.BN(9).toArrayLike(Buffer, "le", 1),
        mintToBeStaked.toBuffer(),
        program.provider.publicKey.toBuffer(),
        Buffer.from("stakePool", "utf-8"),
      ],
      program.programId
    );
    const [badRewardVault] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        badStakePool.toBuffer(),
        rewardMint1.toBuffer(),
        Buffer.from("rewardVault", "utf-8"),
      ],
      program.programId
    );

    const rewardsTransferAmount = new anchor.BN(10_000_000_000);
    const transferIx = createTransferInstruction(
      getAssociatedTokenAddressSync(rewardMint1, program.provider.publicKey),
      rewardVaultKey,
      program.provider.publicKey,
      rewardsTransferAmount.toNumber()
    );
    try {
      await program.methods
        .deposit(nextNonce, deposit2Amount, minDuration)
        .accounts({
          payer: depositor.publicKey,
          owner: depositor.publicKey,
          from: mintToBeStakedAccount,
          stakeMint,
          stakePool: stakePoolKey,
          vault: vaultKey,
          destination: stakeMintAccountKey,
          stakeDepositReceipt: stakeReceiptKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts([
          {
            pubkey: badRewardVault,
            isWritable: false,
            isSigner: false,
          },
        ])
        .preInstructions([transferIx])
        .signers([depositor])
        .rpc();
    } catch (err) {
      assert.equal(err.error.errorCode.code, "InvalidRewardPoolVault");
      return;
    }
    assert.isTrue(false, "TX should have failed");
  });

  it("Duration less than minimum - fails", async () => {
    const nextNonce = 4;
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(nextNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );

    const rewardsTransferAmount = new anchor.BN(10_000_000_000);
    const transferIx = createTransferInstruction(
      getAssociatedTokenAddressSync(rewardMint1, program.provider.publicKey),
      rewardVaultKey,
      program.provider.publicKey,
      rewardsTransferAmount.toNumber()
    );
    try {
      await program.methods
        .deposit(nextNonce, deposit2Amount, new anchor.BN(50))
        .accounts({
          payer: depositor.publicKey,
          owner: depositor.publicKey,
          from: mintToBeStakedAccount,
          stakeMint,
          stakePool: stakePoolKey,
          vault: vaultKey,
          destination: stakeMintAccountKey,
          stakeDepositReceipt: stakeReceiptKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .remainingAccounts([
          {
            pubkey: rewardVaultKey,
            isWritable: false,
            isSigner: false,
          },
        ])
        .preInstructions([transferIx])
        .signers([depositor])
        .rpc();
    } catch (err) {
      assert.equal(err.error.errorCode.code, "DurationTooShort");
      return;
    }
    assert.isTrue(false, "TX should have failed");
  });

  it("Duration larger than max - clamps to max", async () => {
    /**
     * min is 1000 seconds
     * max is 4 weeks (4 * 31536000) = 126144000
     * duration is 126144000 - 1000 = 126143000
     * values exceeding max duration should clamp to max
     */
    const nextNonce = 4;
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(nextNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );

    const rewardsTransferAmount = new anchor.BN(10_000_000_000);
    const transferIx = createTransferInstruction(
      getAssociatedTokenAddressSync(rewardMint1, program.provider.publicKey),
      rewardVaultKey,
      program.provider.publicKey,
      rewardsTransferAmount.toNumber()
    );
    const stakeMintAccountBefore = await tokenProgram.account.account.fetch(
      stakeMintAccountKey
    );
    await program.methods
      .deposit(nextNonce, deposit2Amount, maxDuration.muln(2))
      .accounts({
        payer: depositor.publicKey,
        owner: depositor.publicKey,
        from: mintToBeStakedAccount,
        stakeMint,
        stakePool: stakePoolKey,
        vault: vaultKey,
        destination: stakeMintAccountKey,
        stakeDepositReceipt: stakeReceiptKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        {
          pubkey: rewardVaultKey,
          isWritable: false,
          isSigner: false,
        },
      ])
      .preInstructions([transferIx])
      .signers([depositor])
      .rpc();
    const [receipt, stakeMintAccountAfter] = await Promise.all([
      program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
      tokenProgram.account.account.fetch(stakeMintAccountKey),
    ]);

    assertBNEqual(receipt.lockupDuration, maxDuration);
    assertBNEqual(receipt.effectiveStake, receipt.depositAmount.mul(maxWeight));
    assertBNEqual(
      stakeMintAccountAfter.amount,
      stakeMintAccountBefore.amount.add(
        deposit2Amount
          .mul(maxWeight)
          .div(scaleFactorBN)
          .div(new anchor.BN(10 ** digitShift))
      )
    );
  });

  it("should allow staking for different owner", async () => {
    const depositAmount = new anchor.BN(1_000_000_000);
    // should mint stake represenation to the owner wallet
    const owner = new anchor.web3.Keypair();
    const nextNonce = await getNextUnusedStakeReceiptNonce(
      program.provider.connection,
      program.programId,
      owner.publicKey,
      stakePoolKey
    );
    assert.equal(nextNonce, 0);
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        owner.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(nextNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );
    const stakeMintAccountKey = getAssociatedTokenAddressSync(
      stakeMint,
      owner.publicKey,
      false,
      TOKEN_PROGRAM_ID
    );
    const createStakeMintAcctIx = createAssociatedTokenAccountInstruction(
      depositor.publicKey,
      stakeMintAccountKey,
      owner.publicKey,
      stakeMint
    );
    const mintToBeStakedAccountBefore =
      await tokenProgram.account.account.fetch(mintToBeStakedAccount);

    await program.methods
      .deposit(nextNonce, depositAmount, minDuration)
      .accounts({
        payer: depositor.publicKey,
        owner: owner.publicKey,
        from: mintToBeStakedAccount,
        stakePool: stakePoolKey,
        vault: vaultKey,
        stakeMint,
        destination: stakeMintAccountKey,
        stakeDepositReceipt: stakeReceiptKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .preInstructions([createStakeMintAcctIx])
      .remainingAccounts([
        {
          pubkey: rewardVaultKey,
          isWritable: false,
          isSigner: false,
        },
      ])
      .signers([depositor])
      .rpc({ skipPreflight: true });

    const [mintToBeStakedAccountAfter, stakeMintAccount, stakeReceipt] =
      await Promise.all([
        tokenProgram.account.account.fetch(mintToBeStakedAccount),
        tokenProgram.account.account.fetch(stakeMintAccountKey),
        program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
      ]);
    assertKeysEqual(stakeReceipt.owner, owner.publicKey);
    assertBNEqual(stakeReceipt.depositAmount, depositAmount);
    assertKeysEqual(stakeReceipt.payer, depositor.publicKey);
    assertBNEqual(
      stakeMintAccount.amount,
      depositAmount.div(new anchor.BN(10 ** digitShift))
    );
    assertBNEqual(
      mintToBeStakedAccountAfter.amount,
      mintToBeStakedAccountBefore.amount.sub(depositAmount)
    );
  });
});
