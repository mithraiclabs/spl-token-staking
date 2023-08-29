import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import { SingleSidedStaking } from "../target/types/single_sided_staking";
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
import { SCALE_FACTOR_BASE, addRewardPool, initStakePool } from "./utils";

const scaleFactorBN = new anchor.BN(SCALE_FACTOR_BASE);

describe("deposit", () => {
  const program = anchor.workspace
    .SingleSidedStaking as anchor.Program<SingleSidedStaking>;
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

  before(async () => {
    // set up depositor account and stake pool account
    await Promise.all([
      createDepositorSplAccounts(program, depositor, stakePoolNonce),
      initStakePool(program, mintToBeStaked, stakePoolNonce),
    ]);
    // add reward pool to the initialized stake pool
    await Promise.all([addRewardPool(program, stakePoolNonce, rewardMint1)]);
  });

  it("First Deposit (5) successful", async () => {
    const receiptNonce = 0;
    const duration = new anchor.BN(1000);
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
      .deposit(receiptNonce, deposit1Amount, duration)
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
    assert.equal(stakeMintAccount.amount.toString(), deposit1Amount.toString());
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
      deposit1Amount.toString()
    );
    assert.equal(stakeReceipt.lockupDuration.toString(), duration.toString());

    assert.equal(
      stakePool.totalWeightedStake.toString(),
      deposit1Amount.toString()
    );
  });

  it("Second Deposit (1) recalculates effective reward per stake", async () => {
    const receiptNonce = 1;
    const duration = new anchor.BN(1000);
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
      .deposit(receiptNonce, deposit2Amount, duration)
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
      deposit1Amount.add(deposit2Amount).toString()
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
          rewardsPerEffectiveStake
            .mul(scaleFactorBN)
            .mul(scaleFactorBN)
            .toString(),
          "incorrect rewwards per effective stake"
        );
      } else {
        assert.equal(claimed.toString(), "0", `calimed index ${index} failed`);
      }
    });
    assert.isTrue(stakeReceipt.depositTimestamp.gt(new anchor.BN(0)));
    assert.equal(
      stakeReceipt.effectiveStake.toString(),
      deposit2Amount.toString()
    );
    assert.equal(stakeReceipt.lockupDuration.toString(), duration.toString());

    assert.equal(
      stakePool.totalWeightedStake.toString(),
      deposit1Amount.add(deposit2Amount).toString()
    );
  });

  // it("should handle overflow", async () => {
  //   assert.isTrue(false);
  // });
});
