import * as anchor from "@coral-xyz/anchor";
import { SPL_TOKEN_PROGRAM_ID } from "@coral-xyz/spl-token";
import { SplTokenStaking } from "../target/types/spl_token_staking";
import { assert } from "chai";
import { mintToBeStaked } from "./hooks";
import { SCALE_FACTOR_BASE } from "./utils";

describe("initialize-stake-pool", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;

  const nonce = 1;
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const [stakeMintKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("stakeMint", "utf-8")],
    program.programId
  );
  const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
    program.programId
  );

  it("StakePool initialized", async () => {
    const minDuration = new anchor.BN(0);
    const maxDuration = new anchor.BN(31536000); // 1 year in seconds
    const baseWeight = new anchor.BN(1 * SCALE_FACTOR_BASE);
    const maxWeight = new anchor.BN(4 * SCALE_FACTOR_BASE);
    await program.methods
      .initializeStakePool(
        nonce,
        baseWeight,
        maxWeight,
        minDuration,
        maxDuration
      )
      .accounts({
        authority: program.provider.publicKey,
        stakePool: stakePoolKey,
        stakeMint: stakeMintKey,
        mint: mintToBeStaked,
        vault: vaultKey,
        tokenProgram: SPL_TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    const [stakeMintAccount, vault, stakePool] = await Promise.all([
      program.provider.connection.getAccountInfo(stakeMintKey),
      program.provider.connection.getAccountInfo(vaultKey),
      program.account.stakePool.fetch(stakePoolKey),
    ]);
    assert.isNotNull(stakeMintAccount);
    assert.isNotNull(vault);
    assert.isTrue(stakePool.authority.equals(program.provider.publicKey));
    assert.isTrue(stakePool.stakeMint.equals(stakeMintKey));
    assert.isTrue(stakePool.vault.equals(vaultKey));
    assert.isTrue(stakePool.totalWeightedStake.eq(new anchor.BN(0)));
    assert.equal(stakePool.baseWeight.toString(), baseWeight.toString());
    assert.equal(stakePool.maxWeight.toString(), maxWeight.toString());
    assert.equal(stakePool.minDuration.toString(), minDuration.toString());
    assert.equal(stakePool.maxDuration.toString(), maxDuration.toString());
    stakePool.rewardPools.forEach((rewardPool) => {
      assert.isTrue(
        rewardPool.rewardVault.equals(anchor.web3.PublicKey.default)
      );
      assert.isTrue(rewardPool.rewardsPerEffectiveStake.eq(new anchor.BN(0)));
      assert.isTrue(rewardPool.lastAmount.eq(new anchor.BN(0)));
    });
  });
});
