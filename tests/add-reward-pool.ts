import * as anchor from "@coral-xyz/anchor";
import { splTokenProgram } from "@coral-xyz/spl-token";
import { airdropSol, mintToBeStaked, rewardMint1, rewardMint2 } from "./hooks";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";
import { SplTokenStaking, initStakePool } from "@mithraic-labs/token-staking";
import { assertBNEqual, assertKeysEqual } from "./genericTests";

describe("add-reward-pool", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgramInstance = splTokenProgram({ programId: TOKEN_PROGRAM_ID });
  const stakePoolNonce = 3;

  before(async () => {
    await initStakePool(program, mintToBeStaked, stakePoolNonce);
  });

  it("RewardPool added to StakePool", async () => {
    const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
        mintToBeStaked.toBuffer(),
        program.provider.publicKey.toBuffer(),
        Buffer.from("stakePool", "utf-8"),
      ],
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
    const rewardPoolIndex = 0;
    await program.methods
      .addRewardPool(rewardPoolIndex)
      .accounts({
        authority: program.provider.publicKey,
        rewardMint: rewardMint1,
        stakePool: stakePoolKey,
        rewardVault: rewardVaultKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    const [rewardVault, stakePool] = await Promise.all([
      tokenProgramInstance.account.account.fetch(rewardVaultKey),
      program.account.stakePool.fetch(stakePoolKey),
    ]);
    assertKeysEqual(rewardVault.mint, rewardMint1);
    assertKeysEqual(rewardVault.owner, stakePoolKey);
    assertKeysEqual(
      stakePool.rewardPools[rewardPoolIndex].rewardVault,
      rewardVaultKey
    );
    assertBNEqual(stakePool.rewardPools[rewardPoolIndex].lastAmount, 0);
    assertBNEqual(
      stakePool.rewardPools[rewardPoolIndex].rewardsPerEffectiveStake,
      0
    );
  });

  it("Fail to add RewardPool from incorrect authority", async () => {
    const badAuthority = anchor.web3.Keypair.generate();
    await airdropSol(program.provider.connection, badAuthority.publicKey, 2);
    const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
        mintToBeStaked.toBuffer(),
        program.provider.publicKey.toBuffer(),
        Buffer.from("stakePool", "utf-8"),
      ],
      program.programId
    );
    const [rewardVaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        stakePoolKey.toBuffer(),
        rewardMint2.toBuffer(),
        Buffer.from("rewardVault", "utf-8"),
      ],
      program.programId
    );

    const rewardPoolIndex = 1;
    try {
      await program.methods
        .addRewardPool(rewardPoolIndex)
        .accounts({
          authority: badAuthority.publicKey,
          rewardMint: rewardMint2,
          stakePool: stakePoolKey,
          rewardVault: rewardVaultKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([badAuthority])
        .rpc();
    } catch (err) {
      assert.equal(err.error.errorCode.code, "InvalidAuthority");
      return;
    }
    assert.isTrue(false, "TX should have failed");
  });

  it("Fail to add RewardPool to occupied index", async () => {
    const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
        mintToBeStaked.toBuffer(),
        program.provider.publicKey.toBuffer(),
        Buffer.from("stakePool", "utf-8"),
      ],
      program.programId
    );
    const [rewardVaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        stakePoolKey.toBuffer(),
        rewardMint2.toBuffer(),
        Buffer.from("rewardVault", "utf-8"),
      ],
      program.programId
    );
    const rewardPoolIndex = 0;
    try {
      await program.methods
        .addRewardPool(rewardPoolIndex)
        .accounts({
          authority: program.provider.publicKey,
          rewardMint: rewardMint2,
          stakePool: stakePoolKey,
          rewardVault: rewardVaultKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
    } catch (err) {
      assert.equal(err.error.errorCode.code, "RewardPoolIndexOccupied");
      return;
    }
    assert.isTrue(false, "TX should have failed");
  });

  it("Should add RewardPool to StakePool from external authority", async () => {
    const stakePoolNonce = 200;
    const authority = new anchor.web3.Keypair();
    await initStakePool(
      program,
      mintToBeStaked,
      stakePoolNonce,
      undefined,
      undefined,
      undefined,
      authority.publicKey
    );
    const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
        mintToBeStaked.toBuffer(),
        authority.publicKey.toBuffer(),
        Buffer.from("stakePool", "utf-8"),
      ],
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
    const rewardPoolIndex = 0;
    await program.methods
      .addRewardPool(rewardPoolIndex)
      .accounts({
        payer: program.provider.publicKey,
        authority: authority.publicKey,
        rewardMint: rewardMint1,
        stakePool: stakePoolKey,
        rewardVault: rewardVaultKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    const [rewardVault, stakePool] = await Promise.all([
      tokenProgramInstance.account.account.fetch(rewardVaultKey),
      program.account.stakePool.fetch(stakePoolKey),
    ]);
    assertKeysEqual(rewardVault.mint, rewardMint1);
    assertKeysEqual(rewardVault.owner, stakePoolKey);
    assertKeysEqual(
      stakePool.rewardPools[rewardPoolIndex].rewardVault,
      rewardVaultKey
    );
    assertBNEqual(stakePool.rewardPools[rewardPoolIndex].lastAmount, 0);
    assertBNEqual(
      stakePool.rewardPools[rewardPoolIndex].rewardsPerEffectiveStake,
      0
    );
  });
});
