import * as anchor from "@coral-xyz/anchor";
import { SplTokenStaking } from "../target/types/spl_token_staking";
import {
  createDepositorSplAccounts,
  mintToBeStaked,
  rewardMint1,
} from "./hooks";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";
import {
  ESCAPE_HATCH_ENABLED,
  addRewardPool,
  initStakePool,
} from "@mithraic-labs/token-staking";
import { deposit } from "./utils";
import { assertParsedErrorStaking } from "./errors";

describe("escape hatch withdrawals", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const depositor1 = new anchor.web3.Keypair();
  const depositor2 = new anchor.web3.Keypair();
  const stakePoolNonce = 15;
  const receiptNonce = 2;
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
  const mintToBeStakedAccountKey = getAssociatedTokenAddressSync(
    mintToBeStaked,
    depositor1.publicKey
  );
  const stakeMintAccountKey = getAssociatedTokenAddressSync(
    stakeMint,
    depositor1.publicKey
  );
  const depositorReward1AccountKey = getAssociatedTokenAddressSync(
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

  it("Fail to withdraw locked tokens", async () => {
    // deposit 1 token
    await deposit(
      program,
      stakePoolNonce,
      mintToBeStaked,
      depositor1,
      mintToBeStakedAccountKey,
      stakeMintAccountKey,
      new anchor.BN(1_000_000_000),
      new anchor.BN(1_000_000),
      receiptNonce,
      [rewardVaultKey]
    );

    let ix = await withdrawIx(receiptNonce);
    try {
      await program.provider.sendAndConfirm(
        new anchor.web3.Transaction().add(ix),
        [depositor1]
      );
    } catch (err) {
      assertParsedErrorStaking(err, "Stake is still locked");
      return;
    }
    assert.isTrue(false, "TX should have failed");
  });

  it("Admin triggers the escape hatch ", async () => {
    let pool = await program.account.stakePool.fetch(stakePoolKey);
    assert.equal(pool.flags, 0);

    let escapeIx = await program.methods
      .setFlags(ESCAPE_HATCH_ENABLED)
      .accounts({
        authority: program.provider.publicKey,
        stakePool: stakePoolKey,
      })
      .instruction();
    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction().add(escapeIx)
    );

    pool = await program.account.stakePool.fetch(stakePoolKey);
    assert.equal(pool.flags, ESCAPE_HATCH_ENABLED);
  });

  it("Can now withdraw unlocked tokens", async () => {
    let ix = await withdrawIx(receiptNonce);
    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction().add(ix),
      [depositor1]
    );
    // TODO check balances...
  });

  it("Bad user tries to trigger the escape hatch - fails", async () => {
    let badUser = anchor.web3.Keypair.generate();

    let escapeIx = await program.methods
      .setFlags(ESCAPE_HATCH_ENABLED)
      .accounts({
        authority: badUser.publicKey,
        stakePool: stakePoolKey,
      })
      .instruction();

    try {
      await program.provider.sendAndConfirm(
        new anchor.web3.Transaction().add(escapeIx),
        [badUser]
      );
    } catch (err) {
      assertParsedErrorStaking(err, "Invalid StakePool authority");
      return;
    }
  });

  /**
   * A generic withdraw ix that notable is the same before/after escape hatch is engaged.
   * @returns
   */
  const withdrawIx = async (receiptNonce: number) => {
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor1.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );

    let ix = await program.methods
      .withdraw()
      .accounts({
        claimBase: {
          owner: depositor1.publicKey,
          stakePool: stakePoolKey,
          stakeDepositReceipt: stakeReceiptKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        vault: vaultKey,
        stakeMint,
        from: stakeMintAccountKey,
        destination: mintToBeStakedAccountKey,
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
      ])
      .instruction();
    return ix;
  };
});
