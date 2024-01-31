import * as anchor from "@coral-xyz/anchor";
import { SplTokenStaking } from "../target/types/spl_token_staking";
import { assert } from "chai";
import { mintToBeStaked } from "./hooks";
import { initStakePool } from "@mithraic-labs/token-staking";
import { assertKeysEqual } from "./genericTests";

describe("transfer-authority", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const stakePoolNonce = 8;
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
      mintToBeStaked.toBuffer(),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const newAuthority = new anchor.web3.Keypair();

  before(async () => {
    await initStakePool(program, mintToBeStaked, stakePoolNonce);
  });

  it("Transfer StakePool authority", async () => {
    const stakePoolBefore = await program.account.stakePool.fetch(stakePoolKey);
    assertKeysEqual(stakePoolBefore.authority, program.provider.publicKey);
    await program.methods
      .transferAuthority()
      .accounts({
        authority: program.provider.publicKey,
        stakePool: stakePoolKey,
        newAuthority: newAuthority.publicKey,
      })
      .rpc();
    const stakePool = await program.account.stakePool.fetch(stakePoolKey);
    assertKeysEqual(stakePool.creator, stakePoolBefore.creator);
    assertKeysEqual(stakePool.authority, newAuthority.publicKey);
  });

  it("Non-authority cannot transfer StakePool authority", async () => {
    const badAuthority = new anchor.web3.Keypair();
    const stakePoolBefore = await program.account.stakePool.fetch(stakePoolKey);
    assertKeysEqual(stakePoolBefore.authority, newAuthority.publicKey);
    try {
      await program.methods
        .transferAuthority()
        .accounts({
          authority: badAuthority.publicKey,
          stakePool: stakePoolKey,
          newAuthority: badAuthority.publicKey,
        })
        .signers([badAuthority])
        .rpc();
    } catch (err) {
      assert.equal(err.error.errorCode.code, "InvalidAuthority");
      return;
    }
    assert.isTrue(false, "TX should have failed");
  });
});
