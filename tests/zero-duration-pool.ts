import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import {
  SCALE_FACTOR_BASE_BN,
  SplTokenStaking,
  getNextUnusedStakeReceiptNonce,
  initStakePool,
} from "@mithraic-labs/token-staking";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createDepositorSplAccounts, mintToBeStaked } from "./hooks";
import { assertBNEqual } from "./genericTests";

describe("zero-duration-pool", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgram = splTokenProgram({ programId: TOKEN_PROGRAM_ID });
  const depositor = new anchor.web3.Keypair();
  const stakePoolNonce = 21;
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
  const mintToBeStakedAccount = getAssociatedTokenAddressSync(
    mintToBeStaked,
    depositor.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  const stakeMintAccountKey = getAssociatedTokenAddressSync(
    stakeMint,
    depositor.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );

  before(async () => {
    // set up depositor account and stake pool account
    await Promise.all([
      createDepositorSplAccounts(program, depositor, stakePoolNonce),
      initStakePool(
        program,
        mintToBeStaked,
        stakePoolNonce,
        SCALE_FACTOR_BASE_BN,
        new anchor.BN(0),
        new anchor.BN(0)
      ),
    ]);
  });

  it("should successfully deposit to pool with 0 min & max duration", async () => {
    const depositAmount = new anchor.BN(1_000_000_000);
    const nextNonce = await getNextUnusedStakeReceiptNonce(
      program.provider.connection,
      program.programId,
      depositor.publicKey,
      stakePoolKey
    );
    const [stakeReceiptKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        depositor.publicKey.toBuffer(),
        stakePoolKey.toBuffer(),
        new anchor.BN(nextNonce).toArrayLike(Buffer, "le", 4),
        Buffer.from("stakeDepositReceipt", "utf-8"),
      ],
      program.programId
    );

    const [mintToBeStakedAccountBefore, stakeMintAccountBefore] =
      await Promise.all([
        tokenProgram.account.account.fetch(mintToBeStakedAccount),
        tokenProgram.account.account.fetch(stakeMintAccountKey),
      ]);

    await program.methods
      .deposit(nextNonce, depositAmount, new anchor.BN(0))
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

    const [mintToBeStakedAccountAfter, stakeMintAccountAfter] =
      await Promise.all([
        tokenProgram.account.account.fetch(mintToBeStakedAccount),
        tokenProgram.account.account.fetch(stakeMintAccountKey),
      ]);
    assertBNEqual(
      mintToBeStakedAccountBefore.amount.sub(mintToBeStakedAccountAfter.amount),
      depositAmount
    );
    assertBNEqual(
      stakeMintAccountAfter.amount.sub(stakeMintAccountBefore.amount),
      depositAmount
    );
  });
});
