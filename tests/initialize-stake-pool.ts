import * as anchor from "@coral-xyz/anchor";
import { SPL_TOKEN_PROGRAM_ID } from "@coral-xyz/spl-token";
import { SingleSidedStaking } from "../target/types/single_sided_staking";
import { assert } from "chai";
import { mintToBeStaked } from "./hooks";

describe("initialize-stake-pool", () => {
  const program = anchor.workspace
    .SingleSidedStaking as anchor.Program<SingleSidedStaking>;

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
    const digitShift = -1;
    await program.methods
      .initializeStakePool(nonce, digitShift)
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
    assert.equal(stakePool.digitShift, digitShift);
    stakePool.rewardPools.forEach(rewardPool => {
      assert.isTrue(rewardPool.rewardVault.equals(anchor.web3.PublicKey.default));
      assert.isTrue(rewardPool.rewardsPerEffectiveStake.eq(new anchor.BN(0)));
      assert.isTrue(rewardPool.lastAmount.eq(new anchor.BN(0)));
    })
  });
});
