import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import { mintToBeStaked } from "./hooks";
import {
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { assert } from "chai";
import { assertBNEqual } from "./genericTests";
import { SplTokenStaking, initStakePool } from "@mithraic-labs/token-staking";
import { BN } from "bn.js";

describe("dangerously-mint-stake-mint", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgramInstance = splTokenProgram({ programId: TOKEN_PROGRAM_ID });
  const stakePoolNonce = 19;
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
      mintToBeStaked.toBuffer(),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const [stakeMint] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("stakeMint", "utf-8")],
    program.programId
  );

  before(async () => {
    await initStakePool(program as any, mintToBeStaked, stakePoolNonce);
  });

  it("StakePool authority mints stake mint", async () => {
    const stakePoolAuthority = program.provider.publicKey;
    const amount = new BN(1000);
    const stakeMintAccountKey = getAssociatedTokenAddressSync(
      stakeMint,
      stakePoolAuthority,
      false,
      TOKEN_PROGRAM_ID
    );
    const createMintToBeStakedAccountIx =
      createAssociatedTokenAccountInstruction(
        program.provider.publicKey,
        stakeMintAccountKey,
        stakePoolAuthority,
        stakeMint,
        TOKEN_PROGRAM_ID
      );
    await program.methods
      .dangerouslyMintStakeMint(amount)
      .accounts({
        payer: stakePoolAuthority,
        authority: stakePoolAuthority,
        stakeMint,
        stakePool: stakePoolKey,
        destination: stakeMintAccountKey,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions([createMintToBeStakedAccountIx])
      .rpc();
    const [stakeMintAcct] = await Promise.all([
      tokenProgramInstance.account.account.fetch(stakeMintAccountKey),
    ]);
    assertBNEqual(stakeMintAcct.amount, amount);
  });

  it("Should fail with bad authority", async () => {
    const badUser = anchor.web3.Keypair.generate();
    const stakePoolAuthority = badUser.publicKey;
    const amount = new BN(1000);
    const stakeMintAccountKey = getAssociatedTokenAddressSync(
      stakeMint,
      stakePoolAuthority,
      false,
      TOKEN_PROGRAM_ID
    );
    const createMintToBeStakedAccountIx =
      createAssociatedTokenAccountInstruction(
        program.provider.publicKey,
        stakeMintAccountKey,
        stakePoolAuthority,
        stakeMint,
        TOKEN_PROGRAM_ID
      );
    try {
      await program.methods
        .dangerouslyMintStakeMint(amount)
        .accounts({
          payer: program.provider.publicKey,
          authority: stakePoolAuthority,
          stakeMint,
          stakePool: stakePoolKey,
          destination: stakeMintAccountKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions([createMintToBeStakedAccountIx])
        .signers([badUser])
        .rpc();
      assert.ok(false);
    } catch (err) {
      assert.equal(err.error.errorCode.code, "InvalidAuthority");
      return;
    }
  });
});
