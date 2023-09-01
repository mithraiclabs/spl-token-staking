import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import { SplTokenStaking } from "../target/types/spl_token_staking";
import { assert } from "chai";
import {
  rewardMint1,
  mintToBeStaked,
  createDepositorSplAccounts,
} from "./hooks";
import {
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  createTransferInstruction,
} from "@solana/spl-token";
import {
  SCALE_FACTOR_BASE,
  addRewardPool,
  getDigitShift,
  initStakePool,
} from "./utils";

const scaleFactorBN = new anchor.BN(SCALE_FACTOR_BASE);

describe("deposit", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgram = splTokenProgram({ programId: TOKEN_PROGRAM_ID });
  const depositor = new anchor.web3.Keypair();

  const stakePoolNonce = 3;
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
  const baseWeight = new anchor.BN(SCALE_FACTOR_BASE);
  const maxWeight = new anchor.BN(4 * SCALE_FACTOR_BASE);
  const minDuration = new anchor.BN(1000);
  const maxDuration = new anchor.BN(4 * 31536000);
  const durationDiff = maxDuration.sub(minDuration);
  const digitShift = getDigitShift(BigInt(maxWeight.toString()));

  before(async () => {
    // set up depositor account and stake pool account
    await Promise.all([
      createDepositorSplAccounts(program, depositor, stakePoolNonce),
      initStakePool(
        program,
        mintToBeStaked,
        stakePoolNonce,
        baseWeight,
        maxWeight,
        minDuration,
        maxDuration
      ),
    ]);
    // add reward pool to the initialized stake pool
    await Promise.all([addRewardPool(program, stakePoolNonce, rewardMint1)]);
  });

  it("First Deposit (5) successful", async () => {
    const receiptNonce = 0;
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );
    const mintToBeStakedAccountBefore =
      await tokenProgram.account.account.fetch(mintToBeStakedAccount);

    await program.methods
      .deposit(receiptNonce, deposit1Amount, minDuration)
      .accounts({
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
    assert.equal(
      mintToBeStakedAccountBefore.amount.sub(deposit1Amount).toString(),
      mintToBeStakedAccountAfter.amount.toString()
    );
    assert.equal(
      stakeMintAccount.amount.toString(),
      deposit1Amount.div(new anchor.BN(10 ** digitShift)).toString()
    );
    assert.equal(vault.amount.toString(), deposit1Amount.toString());
    assert.equal(stakeReceipt.stakePool.toString(), stakePoolKey.toString());
    assert.equal(
      stakeReceipt.depositAmount.toString(),
      deposit1Amount.toString()
    );
    assert.equal(stakeReceipt.owner.toString(), depositor.publicKey.toString());
    stakeReceipt.claimedAmounts.forEach((claimed, index) => {
      assert.equal(claimed.toString(), "0", `calimed index ${index} failed`);
    });
    assert.isTrue(stakeReceipt.depositTimestamp.gt(new anchor.BN(0)));
    assert.equal(
      stakeReceipt.effectiveStake.toString(),
      deposit1Amount.mul(scaleFactorBN).toString()
    );
    assert.equal(
      stakeReceipt.lockupDuration.toString(),
      minDuration.toString()
    );

    assert.equal(
      stakePool.totalWeightedStake.toString(),
      deposit1Amount.mul(scaleFactorBN).toString()
    );
  });

  it("Second Deposit (1) recalculates effective reward per stake", async () => {
    const receiptNonce = 1;
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
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
      .deposit(receiptNonce, deposit2Amount, minDuration)
      .accounts({
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
    assert.equal(
      vault.amount.toString(),
      deposit1Amount.add(deposit2Amount).toString()
    );
    assert.equal(
      stakeMintAccount.amount.toString(),
      deposit1Amount
        .add(deposit2Amount)
        .div(new anchor.BN(10 ** digitShift))
        .toString()
    );
    assert.equal(stakeReceipt.stakePool.toString(), stakePoolKey.toString());
    assert.equal(
      stakeReceipt.depositAmount.toString(),
      deposit2Amount.toString()
    );
    assert.equal(stakeReceipt.owner.toString(), depositor.publicKey.toString());
    stakeReceipt.claimedAmounts.forEach((claimed, index) => {
      if (index === 0) {
        // RewardPool 0 should have some claimed amount, so must assert non zero
        assert.equal(
          claimed.toString(),
          rewardsPerEffectiveStake.mul(scaleFactorBN).toString(),
          "incorrect rewwards per effective stake"
        );
      } else {
        assert.equal(claimed.toString(), "0", `calimed index ${index} failed`);
      }
    });
    assert.isTrue(stakeReceipt.depositTimestamp.gt(new anchor.BN(0)));
    assert.equal(
      stakeReceipt.effectiveStake.toString(),
      deposit2Amount.mul(scaleFactorBN).toString()
    );
    assert.equal(
      stakeReceipt.lockupDuration.toString(),
      minDuration.toString()
    );

    assert.equal(
      stakePool.totalWeightedStake.toString(),
      deposit1Amount
        .mul(scaleFactorBN)
        .add(deposit2Amount.mul(scaleFactorBN))
        .toString()
    );
  });

  it("should scale weight based on lockup duration", async () => {
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
    assert.equal(
      stakeReceipt1.effectiveStake.toString(),
      stakeReceipt1.depositAmount.mul(maxWeight).toString()
    );
    assert.equal(
      stakeMintAccountAfter1.amount.toString(),
      // should be 4x the deposit amount
      stakeMintAccountBefore1.amount
        .add(
          deposit2Amount
            .mul(maxWeight)
            .div(scaleFactorBN)
            .div(new anchor.BN(10 ** digitShift))
        )
        .toString()
    );

    await program.methods
      .deposit(receiptNonce2, deposit2Amount, maxDuration.div(new anchor.BN(2)))
      .accounts({
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
    const receipt2WeightRatio = maxDuration
      .div(new anchor.BN(2))
      .sub(minDuration)
      .mul(scaleFactorBN)
      .div(durationDiff);
    const weight = maxWeight.mul(receipt2WeightRatio).div(scaleFactorBN);
    assert.equal(
      stakeReceipt2.effectiveStake.toString(),
      stakeReceipt2.depositAmount.mul(weight).toString()
    );
    assert.equal(
      stakeMintAccountAfter2.amount.toString(),
      // should be just under 2x the deposit amount
      stakeMintAccountAfter1.amount
        .add(
          deposit2Amount
            .mul(weight)
            .div(scaleFactorBN)
            .div(new anchor.BN(10 ** digitShift))
        )
        .toString()
    );
  });
});
