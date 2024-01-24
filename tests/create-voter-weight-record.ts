import * as anchor from "@coral-xyz/anchor";
import {
  SplTokenStaking,
  SplTokenStakingIDL,
  VOTER_WEIGHT_RECORD_LAYOUT,
  initStakePool,
} from "@mithraic-labs/token-staking";
import {
  assertBNEqual,
  assertKeysEqual,
} from "./genericTests";
import {
  GOVERNANCE_PROGRAM_ID,
  GOVERNANCE_PROGRAM_SEED,
  createSplGovernanceProgram,
} from "@mithraic-labs/spl-governance";
import { mintToBeStaked } from "./hooks";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { assert } from "chai";

describe("create-voter-weight-record", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const splGovernance = createSplGovernanceProgram(
    // @ts-ignore
    program._provider.wallet,
    program.provider.connection,
    GOVERNANCE_PROGRAM_ID
  );
  const realmName = "update-voter-weight-realm";
  const [realmAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
      Buffer.from(realmName, "utf-8"),
    ],
    splGovernance.programId
  );
  const realmGoverningTokenMint = mintToBeStaked;
  const [registrarKey, registrarBump] =
    anchor.web3.PublicKey.findProgramAddressSync(
      [
        realmAddress.toBuffer(),
        realmGoverningTokenMint.toBuffer(),
        Buffer.from("registrar", "utf-8"),
      ],
      program.programId
    );
  const stakePoolNonce = 9;
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
      mintToBeStaked.toBuffer(),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const communityTokenMint = mintToBeStaked;
  const realmAuthority = splGovernance.provider.publicKey;

  before(async () => {
    const [communityTokenHoldingAddress] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
          realmAddress.toBuffer(),
          communityTokenMint.toBuffer(),
        ],
        splGovernance.programId
      );
    const [realmConfigAddress] = anchor.web3.PublicKey.findProgramAddressSync(
      [Buffer.from("realm-config", "utf-8"), realmAddress.toBuffer()],
      splGovernance.programId
    );
    await Promise.all([
      splGovernance.methods
        // @ts-ignore
        .createRealm(realmName, {
          communityTokenConfigArgs: {
            useVoterWeightAddin: true,
            useMaxVoterWeightAddin: false,
            tokenType: { liquid: {} },
          },
          councilTokenConfigArgs: {
            useVoterWeightAddin: false,
            useMaxVoterWeightAddin: false,
            tokenType: { liquid: {} },
          },
          useCouncilMint: false,
          minCommunityWeightToCreateGovernance: new anchor.BN(100),
          communityMintMaxVoteWeightSource: { absolute: [new anchor.BN(5)] },
        })
        .accounts({
          realmAddress,
          realmAuthority,
          communityTokenMint,
          communityTokenHoldingAddress,
          payer: splGovernance.provider.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        })
        .remainingAccounts([
          {
            pubkey: realmConfigAddress,
            isSigner: false,
            isWritable: true,
          },
          // since `communityTokenConfigArgs.useVoterWeightAddin` is true, we must append the program ID
          {
            pubkey: program.programId,
            isSigner: false,
            isWritable: false,
          },
        ])
        .rpc(),
      initStakePool(program, mintToBeStaked, stakePoolNonce),
    ]);

    // create registrar
    await program.methods
      .createRegistrar(registrarBump)
      .accounts({
        payer: program.provider.publicKey,
        registrar: registrarKey,
        realm: realmAddress,
        governanceProgramId: splGovernance.programId,
        realmGoverningTokenMint,
        realmAuthority,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
  });

  it("Create voter weight record", async () => {
    const [voterWeightRecordKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        registrarKey.toBuffer(),
        stakePoolKey.toBuffer(),
        program.provider.publicKey.toBuffer(),
        Buffer.from("voterWeightRecord", "utf-8"),
      ],
      program.programId
    );
    await program.methods
      .createVoterWeightRecord()
      .accounts({
        owner: program.provider.publicKey,
        registrar: registrarKey,
        stakePool: stakePoolKey,
        voterWeightRecord: voterWeightRecordKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    const voterWeightRecordInfo =
      await program.provider.connection.getAccountInfo(voterWeightRecordKey);
    const voterWeightRecord = VOTER_WEIGHT_RECORD_LAYOUT.decode(
      voterWeightRecordInfo.data
    );
    assertKeysEqual(voterWeightRecord.realm, realmAddress);
    assertKeysEqual(voterWeightRecord.governingTokenMint, communityTokenMint);
    assertKeysEqual(
      voterWeightRecord.governingTokenOwner,
      program.provider.publicKey
    );
    assertBNEqual(voterWeightRecord.voterWeight, 0);
    assert.isNull(voterWeightRecord.voterWeightExpiry);
    assert.deepEqual(voterWeightRecord.weightAction, { castVote: {} });
    assert.isNull(voterWeightRecord.weightActionTarget);
  });
});
