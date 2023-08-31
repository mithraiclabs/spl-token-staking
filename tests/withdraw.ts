import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import { SplTokenStaking } from "../target/types/spl_token_staking";
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
import { assert } from "chai";
import { addRewardPool, deposit, initStakePool } from "./utils";

describe("withdraw", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgramInstance = splTokenProgram({ programId: TOKEN_PROGRAM_ID });
  const depositor1 = new anchor.web3.Keypair();
  const depositor2 = new anchor.web3.Keypair();
  const stakePoolNonce = 5;
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
    await Promise.all([addRewardPool(program, stakePoolNonce, rewardMint1)]);
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
    const [stakePoolBefore, depositerMintAccountBefore, sTokenAccountBefore] =
      await Promise.all([
        program.account.stakePool.fetch(stakePoolKey),
        tokenProgramInstance.account.account.fetch(mintToBeStakedAccountKey),
        tokenProgramInstance.account.account.fetch(stakeMintAccountKey),
      ]);
    // deposit 1 token
    await deposit(
      program,
      stakePoolNonce,
      depositor1,
      mintToBeStakedAccountKey,
      stakeMintAccountKey,
      new anchor.BN(1_000_000_000),
      new anchor.BN(0),
      receiptNonce
    );

    await program.methods
      .withdraw()
      .accounts({
        owner: depositor1.publicKey,
        vault: vaultKey,
        stakeMint,
        stakePool: stakePoolKey,
        stakeDepositReceipt: stakeReceiptKey,
        from: stakeMintAccountKey,
        destination: mintToBeStakedAccountKey,
        tokenProgram: TOKEN_PROGRAM_ID,
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
      .signers([depositor1])
      .rpc({ skipPreflight: true });

    const [
      stakePoolAfter,
      depositerMintAccount,
      sTokenAccountAfter,
      vaultAfter,
      stakeMintAfter,
    ] = await Promise.all([
      program.account.stakePool.fetch(stakePoolKey),
      tokenProgramInstance.account.account.fetch(mintToBeStakedAccountKey),
      tokenProgramInstance.account.account.fetch(stakeMintAccountKey),
      tokenProgramInstance.account.account.fetch(vaultKey),
      tokenProgramInstance.account.mint.fetch(stakeMint),
    ]);
    assert.equal(
      stakePoolBefore.totalWeightedStake.toString(),
      stakePoolAfter.totalWeightedStake.toString()
    );
    assert.equal(
      depositerMintAccount.amount.toString(),
      depositerMintAccountBefore.amount.toString()
    );
    assert.equal(
      sTokenAccountAfter.amount.toString(),
      sTokenAccountBefore.amount.toString()
    );
    assert.equal(vaultAfter.amount.toString(), "0");
    assert.equal(stakeMintAfter.supply.toString(), "0");
  });

  it("withdraw claims unclaimed rewards", async () => {
    const receiptNonce = 1;
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor1.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );

    const [stakePoolBefore, depositerMintAccountBefore, sTokenAccountBefore] =
      await Promise.all([
        program.account.stakePool.fetch(stakePoolKey),
        tokenProgramInstance.account.account.fetch(mintToBeStakedAccountKey),
        tokenProgramInstance.account.account.fetch(stakeMintAccountKey),
      ]);
    // deposit 1 token
    await deposit(
      program,
      stakePoolNonce,
      depositor1,
      mintToBeStakedAccountKey,
      stakeMintAccountKey,
      new anchor.BN(1_000_000_000),
      new anchor.BN(0),
      receiptNonce,
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
        depositorReward1AccountKey,
        depositor1.publicKey,
        rewardMint1,
        TOKEN_PROGRAM_ID
      );
    await program.provider.sendAndConfirm(
      new anchor.web3.Transaction()
        .add(transferIx)
        .add(createDepositorReward1AccountIx)
    );

    await program.methods
      .withdraw()
      .accounts({
        owner: depositor1.publicKey,
        vault: vaultKey,
        stakeMint,
        stakePool: stakePoolKey,
        stakeDepositReceipt: stakeReceiptKey,
        from: stakeMintAccountKey,
        destination: mintToBeStakedAccountKey,
        tokenProgram: TOKEN_PROGRAM_ID,
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
      .signers([depositor1])
      .rpc({ skipPreflight: true });

    const [
      stakePoolAfter,
      depositerMintAccount,
      sTokenAccountAfter,
      vaultAfter,
      stakeMintAfter,
      depositorReward1AccountAfter,
    ] = await Promise.all([
      program.account.stakePool.fetch(stakePoolKey),
      tokenProgramInstance.account.account.fetch(mintToBeStakedAccountKey),
      tokenProgramInstance.account.account.fetch(stakeMintAccountKey),
      tokenProgramInstance.account.account.fetch(vaultKey),
      tokenProgramInstance.account.mint.fetch(stakeMint),
      tokenProgramInstance.account.account.fetch(depositorReward1AccountKey),
    ]);
    assert.equal(
      stakePoolBefore.totalWeightedStake.toString(),
      stakePoolAfter.totalWeightedStake.toString()
    );
    assert.equal(
      depositerMintAccount.amount.toString(),
      depositerMintAccountBefore.amount.toString()
    );
    assert.equal(
      sTokenAccountAfter.amount.toString(),
      sTokenAccountBefore.amount.toString()
    );
    assert.equal(vaultAfter.amount.toString(), "0");
    assert.equal(stakeMintAfter.supply.toString(), "0");
    assert.equal(
      depositorReward1AccountAfter.amount.toString(),
      new anchor.BN(totalReward1).toString()
    );
  });

  it("Fail to withdraw locked tokens", async () => {
    const receiptNonce = 2;
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
      depositor1,
      mintToBeStakedAccountKey,
      stakeMintAccountKey,
      new anchor.BN(1_000_000_000),
      new anchor.BN(1_000_000),
      receiptNonce,
      [rewardVaultKey]
    );
    try {
      await program.methods
        .withdraw()
        .accounts({
          owner: depositor1.publicKey,
          vault: vaultKey,
          stakeMint,
          stakePool: stakePoolKey,
          stakeDepositReceipt: stakeReceiptKey,
          from: stakeMintAccountKey,
          destination: mintToBeStakedAccountKey,
          tokenProgram: TOKEN_PROGRAM_ID,
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
        .signers([depositor1])
        .rpc({ skipPreflight: true });
    } catch (err) {
      assert.equal(err.code, 6009);
      return;
    }
    assert.isTrue(false, "TX should have faile");
  });
});
