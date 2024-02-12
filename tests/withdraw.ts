import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import { SplTokenStaking } from "../target/types/spl_token_staking";
import {
  createDepositorSplAccounts,
  mintToBeStaked,
  rewardMint1,
} from "./hooks";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";
import { addRewardPool, initStakePool } from "@mithraic-labs/token-staking";
import { deposit } from "./utils";
import { assertBNEqual } from "./genericTests";

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

  it("withdraw unlocked tokens", async () => {
    const receiptNonce = 0;
    const depositAmount = new anchor.BN(1_000_000_000);
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
      mintToBeStaked,
      depositor1,
      mintToBeStakedAccountKey,
      stakeMintAccountKey,
      depositAmount,
      new anchor.BN(0),
      receiptNonce
    );

    await program.methods
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
      .signers([depositor1])
      .rpc({ skipPreflight: true });

    const [
      stakePoolAfter,
      depositerMintAccount,
      sTokenAccountAfter,
      vaultAfter,
      stakeDepositReceipt,
    ] = await Promise.all([
      program.account.stakePool.fetch(stakePoolKey),
      tokenProgramInstance.account.account.fetch(mintToBeStakedAccountKey),
      tokenProgramInstance.account.account.fetch(stakeMintAccountKey),
      tokenProgramInstance.account.account.fetch(vaultKey),
      program.provider.connection.getAccountInfo(stakeReceiptKey),
    ]);
    assertBNEqual(
      stakePoolBefore.totalWeightedStake,
      stakePoolAfter.totalWeightedStake
    );
    assertBNEqual(
      depositerMintAccount.amount,
      depositerMintAccountBefore.amount
    );
    assertBNEqual(sTokenAccountAfter.amount, sTokenAccountBefore.amount.add(depositAmount));
    assertBNEqual(vaultAfter.amount, 0);
    assert.isNull(
      stakeDepositReceipt,
      "StakeDepositReceipt account not closed"
    );
  });

  it("withdraw claims unclaimed rewards", async () => {
    const receiptNonce = 1;
    const depositAmount = new anchor.BN(1_000_000_000);
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
      mintToBeStaked,
      depositor1,
      mintToBeStakedAccountKey,
      stakeMintAccountKey,
      depositAmount,
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
        claimBase: {
          owner: depositor1.publicKey,
          stakePool: stakePoolKey,
          stakeDepositReceipt: stakeReceiptKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        },
        vault: vaultKey,
        stakeMint,
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
      .signers([depositor1])
      .rpc({ skipPreflight: true });

    const [
      stakePoolAfter,
      depositerMintAccount,
      sTokenAccountAfter,
      vaultAfter,
      depositorReward1AccountAfter,
    ] = await Promise.all([
      program.account.stakePool.fetch(stakePoolKey),
      tokenProgramInstance.account.account.fetch(mintToBeStakedAccountKey),
      tokenProgramInstance.account.account.fetch(stakeMintAccountKey),
      tokenProgramInstance.account.account.fetch(vaultKey),
      tokenProgramInstance.account.account.fetch(depositorReward1AccountKey),
    ]);
    assertBNEqual(
      stakePoolBefore.totalWeightedStake,
      stakePoolAfter.totalWeightedStake
    );
    assertBNEqual(
      depositerMintAccount.amount,
      depositerMintAccountBefore.amount
    );
    assertBNEqual(sTokenAccountAfter.amount, sTokenAccountBefore.amount.add(depositAmount));
    assertBNEqual(vaultAfter.amount, 0);
    assertBNEqual(depositorReward1AccountAfter.amount, totalReward1);
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
      mintToBeStaked,
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
          claimBase: {
            owner: depositor1.publicKey,
            stakePool: stakePoolKey,
            stakeDepositReceipt: stakeReceiptKey,
            tokenProgram: TOKEN_PROGRAM_ID,
          },
          vault: vaultKey,
          stakeMint,
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
        .signers([depositor1])
        .rpc();
    } catch (err) {
      assert.equal(err.error.errorCode.code, "StakeStillLocked");
      return;
    }
    assert.isTrue(false, "TX should have failed");
  });

  describe("After burning stake_mint tokens", () => {
    const receiptNonce = 3;
    before(async () => {
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
        receiptNonce,
        [rewardVaultKey]
      );
      const stakeMintTokenAccount =
        await tokenProgramInstance.account.account.fetch(stakeMintAccountKey);

      // Burn the staking tokens
      await tokenProgramInstance.methods
        .burn(stakeMintTokenAccount.amount)
        .accounts({
          account: stakeMintAccountKey,
          mint: stakeMint,
          authority: depositor1.publicKey,
        })
        .signers([depositor1])
        .rpc();
    });

    it("should still withdraw", async () => {
      const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
        [
          depositor1.publicKey.toBuffer(),
          stakePoolKey.toBuffer(),
          new anchor.BN(receiptNonce).toArrayLike(Buffer, "le", 4),
          Buffer.from("stakeDepositReceipt", "utf-8"),
        ],
        program.programId
      );
      const [stakePoolBefore, stakeReceipt, depositerMintAccountBefore, sTokenAccountBefore, vaultBefore] =
        await Promise.all([
          program.account.stakePool.fetch(stakePoolKey),
          program.account.stakeDepositReceipt.fetch(stakeReceiptKey),
          tokenProgramInstance.account.account.fetch(mintToBeStakedAccountKey),
          tokenProgramInstance.account.account.fetch(stakeMintAccountKey, 'processed'),
          tokenProgramInstance.account.account.fetch(vaultKey),
        ]);
      assert.equal(sTokenAccountBefore.amount.toString(), "0");

      // Withdraw
      try {
        await program.methods
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
          .signers([depositor1])
          .rpc({ skipPreflight: true });
      } catch (err) {
        console.error(err);
        assert.ok(false);
      }

      const [
        stakePoolAfter,
        depositerMintAccount,
        sTokenAccountAfter,
        vaultAfter,
        stakeDepositReceipt,
      ] = await Promise.all([
        program.account.stakePool.fetch(stakePoolKey),
        tokenProgramInstance.account.account.fetch(mintToBeStakedAccountKey),
        tokenProgramInstance.account.account.fetch(stakeMintAccountKey, 'processed'),
        tokenProgramInstance.account.account.fetch(vaultKey),
        program.provider.connection.getAccountInfo(stakeReceiptKey),
      ]);
      assertBNEqual(
        stakePoolBefore.totalWeightedStake.sub(stakeReceipt.effectiveStake),
        stakePoolAfter.totalWeightedStake
      );
      assertBNEqual(
        depositerMintAccount.amount,
        depositerMintAccountBefore.amount.add(stakeReceipt.depositAmount)
      );
      // No change to the stake token because it's not burning
      assertBNEqual(sTokenAccountAfter.amount, sTokenAccountBefore.amount);
      assertBNEqual(vaultAfter.amount, vaultBefore.amount.sub(stakeReceipt.depositAmount));
      assert.isNull(
        stakeDepositReceipt,
        "StakeDepositReceipt account not closed"
      );
    });
  });
});
