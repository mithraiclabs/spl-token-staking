import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import { assert } from "chai";
import {
  rewardMint1,
  mintToBeStaked,
  createDepositorSplAccounts,
  TEST_MINT_DECIMALS,
} from "./hooks22";
import {
  getAssociatedTokenAddressSync,
  createTransferInstruction,
  createAssociatedTokenAccountInstruction,
  TOKEN_2022_PROGRAM_ID,
  getAccount,
} from "@solana/spl-token";
import {
  SCALE_FACTOR_BASE,
  SCALE_FACTOR_BASE_BN,
  addRewardPool,
  calculateStakeWeight,
  createRegistrar,
  fetchVoterWeightRecord,
  getDigitShift,
  getNextUnusedStakeReceiptNonce,
  initStakePool,
} from "@mithraic-labs/token-staking";
import { assertBNEqual, assertKeysEqual } from "../genericTests";
import {
  GOVERNANCE_PROGRAM_ID,
  GOVERNANCE_PROGRAM_SEED,
  createSplGovernanceProgram,
} from "@mithraic-labs/spl-governance";
import { createRealm } from "../utils";
import { SplTokenStaking } from "../../target/types/spl_token_staking";

const scaleFactorBN = new anchor.BN(SCALE_FACTOR_BASE.toString());

describe("deposit", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  // const splGovernance = createSplGovernanceProgram(
  //   // @ts-ignore
  //   program._provider.wallet,
  //   program.provider.connection,
  //   GOVERNANCE_PROGRAM_ID
  // );
  const tokenProgram = TOKEN_2022_PROGRAM_ID;
  const splTokenProgramInstance = splTokenProgram({ programId: tokenProgram });
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
    tokenProgram
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
  // const realmName = "deposit-realm";
  // const [realmAddress] = anchor.web3.PublicKey.findProgramAddressSync(
  //   [
  //     Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
  //     Buffer.from(realmName, "utf-8"),
  //   ],
  //   splGovernance.programId
  // );
  // const communityTokenMint = mintToBeStaked;
  const [registrarKey] = [anchor.web3.PublicKey.default];
  // anchor.web3.PublicKey.findProgramAddressSync(
  //   [
  //     realmAddress.toBuffer(),
  //     communityTokenMint.toBuffer(),
  //     Buffer.from("registrar", "utf-8"),
  //   ],
  //   program.programId
  // );
  // const realmAuthority = splGovernance.provider.publicKey;

  before(async () => {
    // TODO currently governance is incompatible with Token 2022...
    // await createRealm(
    //   // @ts-ignore
    //   splGovernance,
    //   realmName,
    //   communityTokenMint,
    //   realmAuthority,
    //   program.programId
    // );
    // await createRegistrar(
    //   program,
    //   realmAddress,
    //   mintToBeStaked,
    //   GOVERNANCE_PROGRAM_ID,
    //   program.provider.publicKey
    // );

    // set up depositor account and stake pool account

    await createDepositorSplAccounts(program, depositor, stakePoolNonce),
    await initStakePool(
      program,
      mintToBeStaked,
      stakePoolNonce,
      maxWeight,
      minDuration,
      maxDuration,
      undefined,
      registrarKey,
      tokenProgram
    );
    await addRewardPool(
      program,
      stakePoolNonce,
      mintToBeStaked,
      rewardMint1,
      undefined,
      undefined,
      tokenProgram
    );
    await program.methods
      .createVoterWeightRecord()
      .accounts({
        owner: depositor.publicKey,
        registrar: null, // TODO update when governance re-added.
        stakePool: stakePoolKey,
        voterWeightRecord: voterWeightRecordKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
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
        splTokenProgramInstance.account.account.fetch(mintToBeStakedAccount),
        fetchVoterWeightRecord(program, voterWeightRecordKey),
      ]);

    await program.methods
      .deposit(nextNonce, deposit1Amount, minDuration)
      .accounts({
        payer: depositor.publicKey,
        owner: depositor.publicKey,
        mint: mintToBeStaked,
        from: mintToBeStakedAccount,
        stakePool: stakePoolKey,
        vault: vaultKey,
        voterWeightRecord: voterWeightRecordKey,
        stakeDepositReceipt: stakeReceiptKey,
        tokenProgram: tokenProgram,
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
      splTokenProgramInstance.account.account.fetch(mintToBeStakedAccount),
      splTokenProgramInstance.account.account.fetch(vaultKey),
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
});
