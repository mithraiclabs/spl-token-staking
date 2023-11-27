import * as anchor from "@coral-xyz/anchor";
import { SPL_TOKEN_PROGRAM_ID, splTokenProgram } from "@coral-xyz/spl-token";
import { SplTokenStaking } from "../target/types/spl_token_staking";
import { assert } from "chai";
import { createDepositorSplAccounts } from "./hooks";
import {
  createInitializeMintInstruction,
  getAssociatedTokenAddressSync,
  MintLayout,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { SCALE_FACTOR_BASE, U64_MAX, initStakePool } from "@mithraic-labs/token-staking";

describe("decimal-overflow", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgram = splTokenProgram({ programId: TOKEN_PROGRAM_ID });
  const mintToBeStakedKeypair = anchor.web3.Keypair.generate();
  const mintToBeStaked = mintToBeStakedKeypair.publicKey;
  const depositor = new anchor.web3.Keypair();

  const stakePoolNonce = 20;
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
  const maxWeight = new anchor.BN(4 * parseInt(SCALE_FACTOR_BASE.toString()));
  const minDuration = new anchor.BN(1000);
  const maxDuration = new anchor.BN(4 * 31536000);

  before(async () => {
    const mintRentExemptBalance =
      await program.provider.connection.getMinimumBalanceForRentExemption(
        MintLayout.span
      );
    const tx = new anchor.web3.Transaction();
    // stake mint IXs
    tx.add(
      anchor.web3.SystemProgram.createAccount({
        fromPubkey: program.provider.publicKey,
        newAccountPubkey: mintToBeStaked,
        space: MintLayout.span,
        lamports: mintRentExemptBalance,
        programId: SPL_TOKEN_PROGRAM_ID,
      })
    );
    tx.add(
      createInitializeMintInstruction(
        mintToBeStaked,
        9,
        program.provider.publicKey,
        undefined
      )
    );
    await program.provider.sendAndConfirm(tx, [mintToBeStakedKeypair]);
    // set up depositor account and stake pool account
    await Promise.all([
      createDepositorSplAccounts(
        program,
        depositor,
        stakePoolNonce,
        mintToBeStaked,
        // max amount of u64
        U64_MAX
      ),
      initStakePool(
        program,
        mintToBeStaked,
        stakePoolNonce,
        maxWeight,
        minDuration,
        maxDuration
      ),
    ]);
  });

  it("Handles max token amount scaling", async () => {
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

    await program.methods
      .deposit(receiptNonce, new anchor.BN(U64_MAX.toString()), maxDuration)
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
    const [vault, stakeMintAccount] = await Promise.all([
      tokenProgram.account.account.fetch(vaultKey),
      tokenProgram.account.account.fetch(stakeMintAccountKey),
    ]);
    assert.equal(vault.amount.toString(), U64_MAX.toString());
    assert.equal(
      stakeMintAccount.amount.toString(),
      // we lose a digit of precision due to the max weight being greater than 1,
      // so we must divide by 10 after scaling.
      ((U64_MAX * BigInt(4)) / BigInt(10)).toString()
    );
  });
});
