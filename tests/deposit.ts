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
  createRegistrar,
  fetchVoterWeightRecord,
  getDigitShift,
  getNextUnusedStakeReceiptNonce,
  initStakePool,
} from "@mithraic-labs/token-staking";
import { assertBNEqual, assertKeysEqual } from "./genericTests";
import {
  GOVERNANCE_PROGRAM_ID,
  GOVERNANCE_PROGRAM_SEED,
  createSplGovernanceProgram,
} from "@mithraic-labs/spl-governance";
import { createRealm } from "./utils";

const scaleFactorBN = new anchor.BN(SCALE_FACTOR_BASE.toString());

describe("deposit", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const splGovernance = createSplGovernanceProgram(
    // @ts-ignore
    program._provider.wallet,
    program.provider.connection,
    GOVERNANCE_PROGRAM_ID
  );
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
  const [rewardVaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      stakePoolKey.toBuffer(),
      rewardMint1.toBuffer(),
      Buffer.from("rewardVault", "utf-8"),
    ],
    program.programId
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
  const [voterWeightRecordKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      stakePoolKey.toBuffer(),
      depositor.publicKey.toBuffer(),
      Buffer.from("voterWeightRecord", "utf-8"),
    ],
    program.programId
  );
  const realmName = "deposit-realm";
  const [realmAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
      Buffer.from(realmName, "utf-8"),
    ],
    splGovernance.programId
  );
  const communityTokenMint = mintToBeStaked;
  const [registrarKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      realmAddress.toBuffer(),
      communityTokenMint.toBuffer(),
      Buffer.from("registrar", "utf-8"),
    ],
    program.programId
  );
  const realmAuthority = splGovernance.provider.publicKey;

  before(async () => {
    await createRealm(
      // @ts-ignore
      splGovernance,
      realmName,
      communityTokenMint,
      realmAuthority,
      program.programId
    );
    await createRegistrar(
      program,
      realmAddress,
      mintToBeStaked,
      GOVERNANCE_PROGRAM_ID,
      program.provider.publicKey
    );
    // set up depositor account and stake pool account
    await Promise.all([
      createDepositorSplAccounts(program, depositor, stakePoolNonce),
      initStakePool(
        program,
        mintToBeStaked,
        stakePoolNonce,
        maxWeight,
        minDuration,
        maxDuration,
        undefined,
        registrarKey
      ),
    ]);

    // add reward pool to the initialized stake pool
    await Promise.all([
      addRewardPool(program, stakePoolNonce, mintToBeStaked, rewardMint1),
      program.methods
        .createVoterWeightRecord()
        .accounts({
          owner: depositor.publicKey,
          registrar: registrarKey,
          stakePool: stakePoolKey,
          voterWeightRecord: voterWeightRecordKey,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc(),
    ]);
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
    const [mintToBeStakedAccountBefore, voterWeightRecordBefore] =
      await Promise.all([
        tokenProgram.account.account.fetch(mintToBeStakedAccount),
        fetchVoterWeightRecord(program, voterWeightRecordKey),
      ]);

    await program.methods
      .deposit(nextNonce, deposit1Amount, minDuration)
      .accounts({
        payer: depositor.publicKey,
        owner: depositor.publicKey,
        from: mintToBeStakedAccount,
        stakePool: stakePoolKey,
        vault: vaultKey,
        voterWeightRecord: voterWeightRecordKey,
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
      stakeReceipt,
      stakePool,
      voterWeightRecord,
    ] = await Promise.all([
      tokenProgram.account.account.fetch(mintToBeStakedAccount),
      tokenProgram.account.account.fetch(vaultKey),
      program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
      program.account.stakePool.fetch(stakePoolKey),
      fetchVoterWeightRecord(program, voterWeightRecordKey),
    ]);
    const weightedStakeAmount = deposit1Amount.div(
      new anchor.BN(10 ** digitShift)
    );
    assertBNEqual(
      voterWeightRecord.voterWeight.sub(voterWeightRecordBefore.voterWeight),
      weightedStakeAmount
    );
    assertBNEqual(
      mintToBeStakedAccountBefore.amount.sub(deposit1Amount),
      mintToBeStakedAccountAfter.amount
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
    const [nextNonce, voterWeightRecordBefore] = await Promise.all([
      getNextUnusedStakeReceiptNonce(
        program.provider.connection,
        program.programId,
        depositor.publicKey,
        stakePoolKey
      ),
      fetchVoterWeightRecord(program, voterWeightRecordKey),
    ]);
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
        stakePool: stakePoolKey,
        vault: vaultKey,
        voterWeightRecord: voterWeightRecordKey,
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
    const [vault, stakeReceipt, stakePool, voterWeightRecord] =
      await Promise.all([
        tokenProgram.account.account.fetch(vaultKey),
        program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
        program.account.stakePool.fetch(stakePoolKey),
        fetchVoterWeightRecord(program, voterWeightRecordKey),
      ]);
    const totalWeightedStakeAmount = deposit1Amount
      .add(deposit2Amount)
      .div(new anchor.BN(10 ** digitShift));
    assertBNEqual(vault.amount, deposit1Amount.add(deposit2Amount));
    assertBNEqual(voterWeightRecord.voterWeight, totalWeightedStakeAmount);
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
    const [voterWeightRecordBefore1] = await Promise.all([
      fetchVoterWeightRecord(program, voterWeightRecordKey),
    ]);
    await program.methods
      .deposit(receiptNonce1, deposit2Amount, maxDuration)
      .accounts({
        payer: depositor.publicKey,
        owner: depositor.publicKey,
        from: mintToBeStakedAccount,
        stakePool: stakePoolKey,
        vault: vaultKey,
        voterWeightRecord: voterWeightRecordKey,
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
    const [stakeReceipt1, voterWeightRecordAfter1] = await Promise.all([
      program.account.stakeDepositReceipt.fetch(stakeReceiptKey1),
      fetchVoterWeightRecord(program, voterWeightRecordKey),
    ]);
    const weightedStake = deposit2Amount
      .mul(maxWeight)
      .div(scaleFactorBN)
      .div(new anchor.BN(10 ** digitShift));
    assertBNEqual(
      stakeReceipt1.effectiveStake,
      stakeReceipt1.depositAmount.mul(maxWeight)
    );
    assertBNEqual(
      voterWeightRecordAfter1.voterWeight.sub(
        voterWeightRecordBefore1.voterWeight
      ),
      weightedStake
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
        voterWeightRecord: voterWeightRecordKey,
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
    const [stakeReceipt2, voterWeightRecordAfter2] = await Promise.all([
      program.account.stakeDepositReceipt.fetch(stakeReceiptKey2),
      fetchVoterWeightRecord(program, voterWeightRecordKey),
    ]);
    const weight = calculateStakeWeight(
      minDuration,
      maxDuration,
      SCALE_FACTOR_BASE_BN,
      maxWeight,
      duration2
    );
    const weightedStake2 = deposit2Amount
      .mul(weight)
      .div(scaleFactorBN)
      .div(new anchor.BN(10 ** digitShift));
    assertBNEqual(
      stakeReceipt2.effectiveStake,
      stakeReceipt2.depositAmount.mul(weight)
    );
    assertBNEqual(
      voterWeightRecordAfter2.voterWeight.sub(
        voterWeightRecordAfter1.voterWeight
      ),
      weightedStake2
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
          stakePool: stakePoolKey,
          vault: vaultKey,
          voterWeightRecord: voterWeightRecordKey,
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
          stakePool: stakePoolKey,
          vault: vaultKey,
          voterWeightRecord: voterWeightRecordKey,
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
    const [voterWeightRecordBefore] = await Promise.all([
      fetchVoterWeightRecord(program, voterWeightRecordKey),
    ]);
    await program.methods
      .deposit(nextNonce, deposit2Amount, maxDuration.muln(2))
      .accounts({
        payer: depositor.publicKey,
        owner: depositor.publicKey,
        from: mintToBeStakedAccount,
        stakePool: stakePoolKey,
        vault: vaultKey,
        voterWeightRecord: voterWeightRecordKey,
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
    const [receipt, voterWeightRecordAfter] = await Promise.all([
      program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
      fetchVoterWeightRecord(program, voterWeightRecordKey),
    ]);
    const weightedStake = deposit2Amount
      .mul(maxWeight)
      .div(scaleFactorBN)
      .div(new anchor.BN(10 ** digitShift));

    assertBNEqual(receipt.lockupDuration, maxDuration);
    assertBNEqual(receipt.effectiveStake, receipt.depositAmount.mul(maxWeight));
    assertBNEqual(
      voterWeightRecordAfter.voterWeight.sub(
        voterWeightRecordBefore.voterWeight
      ),
      weightedStake
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
    const [voterWeightRecordKey2] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          stakePoolKey.toBuffer(),
          owner.publicKey.toBuffer(),
          Buffer.from("voterWeightRecord", "utf-8"),
        ],
        program.programId
      );
    // create VWR for external owner
    await program.methods
      .createVoterWeightRecord()
      .accounts({
        owner: owner.publicKey,
        registrar: registrarKey,
        stakePool: stakePoolKey,
        voterWeightRecord: voterWeightRecordKey2,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc(),
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
    const [mintToBeStakedAccountBefore, voterWeightRecordBefore] =
      await Promise.all([
        tokenProgram.account.account.fetch(mintToBeStakedAccount),
        fetchVoterWeightRecord(program, voterWeightRecordKey2),
      ]);

    await program.methods
      .deposit(nextNonce, depositAmount, minDuration)
      .accounts({
        payer: depositor.publicKey,
        owner: owner.publicKey,
        from: mintToBeStakedAccount,
        stakePool: stakePoolKey,
        vault: vaultKey,
        voterWeightRecord: voterWeightRecordKey2,
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
      .signers([depositor])
      .rpc({ skipPreflight: true });

    const [
      mintToBeStakedAccountAfter,
      stakeReceipt,
      voterWeightRecordAfter,
    ] = await Promise.all([
      tokenProgram.account.account.fetch(mintToBeStakedAccount),
      program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
      fetchVoterWeightRecord(program, voterWeightRecordKey2),
    ]);
    const weightedStakeAmount = depositAmount.div(
      new anchor.BN(10 ** digitShift)
    );
    assertKeysEqual(stakeReceipt.owner, owner.publicKey);
    assertBNEqual(stakeReceipt.depositAmount, depositAmount);
    assertKeysEqual(stakeReceipt.payer, depositor.publicKey);
    assertBNEqual(
      voterWeightRecordAfter.voterWeight.sub(
        voterWeightRecordBefore.voterWeight
      ),
      weightedStakeAmount
    );
    assertBNEqual(
      mintToBeStakedAccountAfter.amount,
      mintToBeStakedAccountBefore.amount.sub(depositAmount)
    );
  });
});
