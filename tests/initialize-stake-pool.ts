import * as anchor from "@coral-xyz/anchor";
import { SPL_TOKEN_PROGRAM_ID, splTokenProgram } from "@coral-xyz/spl-token";
import { SplTokenStaking } from "../target/types/spl_token_staking";
import { assert } from "chai";
import { TEST_MINT_DECIMALS, mintToBeStaked } from "./hooks";
import { SCALE_FACTOR_BASE } from "@mithraic-labs/token-staking";
import { TOKEN_PROGRAM_ID, getMint } from "@solana/spl-token";
import {
  assertBNEqual,
  assertKeyDefault,
  assertKeysEqual,
} from "./genericTests";

describe("initialize-stake-pool", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
    const tokenProgramInstance = splTokenProgram({ programId: TOKEN_PROGRAM_ID });

  it("StakePool initialized - happy path", async () => {
    const nonce = 1;
    const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
        mintToBeStaked.toBuffer(),
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

    const minDuration = new anchor.BN(0);
    const maxDuration = new anchor.BN(31536000); // 1 year in seconds
    const baseWeight = new anchor.BN(SCALE_FACTOR_BASE.toString());
    const maxWeight = new anchor.BN(4 * parseInt(SCALE_FACTOR_BASE.toString()));
    await program.methods
      .initializeStakePool(nonce, maxWeight, minDuration, maxDuration)
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
      getMint(program.provider.connection, stakeMintKey),
      tokenProgramInstance.account.account.fetch(vaultKey),
      program.account.stakePool.fetch(stakePoolKey),
    ]);

    assert.isNotNull(stakeMintAccount);
    /*
      Shift 1 computed (see `getDigitShift`):
      max: 4_000_000_000n, base: 1_000_000_000n
      4,000,000,000 * 18446744073709551615 / 1,000,000,000 / 10^0 > 18446744073709551615
      4,000,000,000 * 18446744073709551615 / 1,000,000,000 / 10^1 < 18446744073709551615
    */
    assert.equal(stakeMintAccount.decimals, TEST_MINT_DECIMALS - 1);
    assertKeysEqual(stakeMintAccount.mintAuthority, stakePoolKey);
    assertKeysEqual(vault.owner, stakePoolKey);
    assert.isNotNull(vault);
    assertKeysEqual(stakePool.authority, program.provider.publicKey);
    assertKeysEqual(stakePool.mint, mintToBeStaked);
    assertKeysEqual(stakePool.stakeMint, stakeMintKey);
    assertKeysEqual(stakePool.vault, vaultKey);
    // Nothing staked yet
    assertBNEqual(new anchor.BN(stakePool.totalWeightedStake), 0);
    assertBNEqual(stakePool.baseWeight, baseWeight);
    assertBNEqual(stakePool.maxWeight, maxWeight);
    assertBNEqual(stakePool.minDuration, minDuration);
    assertBNEqual(stakePool.maxDuration, maxDuration);
    // Pools are blank/default
    stakePool.rewardPools.forEach((rewardPool) => {
      assertKeyDefault(rewardPool.rewardVault);
      assertBNEqual(new anchor.BN(rewardPool.rewardsPerEffectiveStake), 0);
      assertBNEqual(rewardPool.lastAmount, 0);
    });
  });

  // Note: When this occurs, storing all tokens will overflow, which may risk a soft lock.
  it("Max shifted weight scalar - saturating sub creates 0-decimal stake mint", async () => {
    const nonce = 2;
    const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
        mintToBeStaked.toBuffer(),
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

    const minDuration = new anchor.BN(0);
    const maxDuration = new anchor.BN(31536000); // 1 year in seconds
    // 10_000_000_000_000_000_000 exceeds the max shift of 1_000_000_000_000_000_000
    const maxWeight = new anchor.BN("10000000000000000000");
    await program.methods
      .initializeStakePool(
        nonce,
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
      getMint(program.provider.connection, stakeMintKey),
      program.provider.connection.getAccountInfo(vaultKey),
      program.account.stakePool.fetch(stakePoolKey),
    ]);
    /*
      Shift max computed:
      1_000_000_000_000_000_000 * 18446744073709551615 / 1,000,000,000 / 10^9 > 18446744073709551615
    */
    assert.equal(stakeMintAccount.decimals, 0);
  });
});
