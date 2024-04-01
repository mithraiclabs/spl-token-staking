import * as anchor from "@coral-xyz/anchor";
import { SPL_TOKEN_PROGRAM_ID, splTokenProgram } from "@coral-xyz/spl-token";
import { SplTokenStaking } from "../../target/types/spl_token_staking";
import { assert } from "chai";
import { mintToBeStaked } from "./hooks22";
import {
  SCALE_FACTOR_BASE,
  createRegistrar,
} from "@mithraic-labs/token-staking";
import {
  AccountLayout,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccount,
  createAssociatedTokenAccountInstruction,
  createInitializeAccountInstruction,
  getAssociatedTokenAddressSync,
  getMint,
} from "@solana/spl-token";
import {
  assertBNEqual,
  assertKeyDefault,
  assertKeysEqual,
} from "../genericTests";
import { createRealm } from "../utils";
import {
  GOVERNANCE_PROGRAM_ID,
  GOVERNANCE_PROGRAM_SEED,
  createSplGovernanceProgram,
} from "@mithraic-labs/spl-governance";

describe("initialize-stake-pool", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const tokenProgram = TOKEN_2022_PROGRAM_ID;
  const tokenProgramInstance = splTokenProgram({ programId: tokenProgram });
  const splGovernance = createSplGovernanceProgram(
    // @ts-ignore
    program._provider.wallet,
    program.provider.connection,
    GOVERNANCE_PROGRAM_ID
  );
  const realmName = "init-stakepool-realm";
  const [realmAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
      Buffer.from(realmName, "utf-8"),
    ],
    splGovernance.programId
  );
  const realmGoverningTokenMint = mintToBeStaked;
  const [registrarKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      realmAddress.toBuffer(),
      realmGoverningTokenMint.toBuffer(),
      Buffer.from("registrar", "utf-8"),
    ],
    program.programId
  );

  before(async () => {
    // TODO currently governance is incompatible...
    // console.log("realm");
    // // create realm and registrar
    // const realmAuthority = program.provider.publicKey;
    // await createRealm(
    //   // @ts-ignore
    //   splGovernance,
    //   realmName,
    //   realmGoverningTokenMint,
    //   realmAuthority,
    //   program.programId
    // );
    // console.log("register");
    // await createRegistrar(
    //   // @ts-ignore
    //   program,
    //   realmAddress,
    //   realmGoverningTokenMint,
    //   splGovernance.programId,
    //   realmAuthority
    // );
  });

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
    const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
      program.programId
    );

    const minDuration = new anchor.BN(0);
    const maxDuration = new anchor.BN(31536000); // 1 year in seconds
    const baseWeight = new anchor.BN(SCALE_FACTOR_BASE.toString());
    const maxWeight = new anchor.BN(4 * parseInt(SCALE_FACTOR_BASE.toString()));

    let initIx = await program.methods
      .initializeStakePool(
        nonce,
        maxWeight,
        minDuration,
        maxDuration,
        registrarKey
      )
      .accounts({
        authority: program.provider.publicKey,
        stakePool: stakePoolKey,
        mint: mintToBeStaked,
        vault: vaultKey,
        tokenProgram: tokenProgram,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .instruction();
    try {
      await program.provider.sendAndConfirm(
        new anchor.web3.Transaction().add(
         // initTokenAccIx,
          initIx
        )
      );
    } catch (err) {
      console.log(err);
    }
    const [vault, stakePool] = await Promise.all([
      tokenProgramInstance.account.account.fetch(vaultKey),
      program.account.stakePool.fetch(stakePoolKey),
    ]);

    /*
      Shift 1 computed (see `getDigitShift`):
      max: 4_000_000_000n, base: 1_000_000_000n
      4,000,000,000 * 18446744073709551615 / 1,000,000,000 / 10^0 > 18446744073709551615
      4,000,000,000 * 18446744073709551615 / 1,000,000,000 / 10^1 < 18446744073709551615
    */
    assertKeysEqual(vault.owner, stakePoolKey);
    assert.isNotNull(vault);
    assertKeysEqual(stakePool.authority, program.provider.publicKey);
    assertKeysEqual(stakePool.mint, mintToBeStaked);
    assertKeysEqual(stakePool.vault, vaultKey);
    assertKeysEqual(stakePool.registrar, registrarKey);
    assertKeysEqual(stakePool.creator, program.provider.publicKey);
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
});
