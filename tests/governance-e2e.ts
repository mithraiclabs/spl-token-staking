import * as anchor from "@coral-xyz/anchor";
import {
  GOVERNANCE_PROGRAM_ID,
  GOVERNANCE_PROGRAM_SEED,
  createSplGovernanceProgram,
} from "@mithraic-labs/spl-governance";
import {
  SplTokenStaking,
  createRegistrar,
  initStakePool,
} from "@mithraic-labs/token-staking";
import { createDepositorSplAccounts, mintToBeStaked } from "./hooks";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { createRealm, deposit } from "./utils";
import { assert } from "chai";

describe("governance-e2e", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const splGovernance = createSplGovernanceProgram(
    // @ts-ignore
    program._provider.wallet,
    program.provider.connection,
    GOVERNANCE_PROGRAM_ID
  );
  const depositor = new anchor.web3.Keypair();
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
  const realmName = "governance-e2e-realm";
  const [realmAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
      Buffer.from(realmName, "utf-8"),
    ],
    splGovernance.programId
  );
  const communityTokenMint = mintToBeStaked;
  const realmAuthority = splGovernance.provider.publicKey;
  const [registrarKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      realmAddress.toBuffer(),
      communityTokenMint.toBuffer(),
      Buffer.from("registrar", "utf-8"),
    ],
    program.programId
  );
  const [mintGovernanceAddress] =
  anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("mint-governance", "utf-8"),
      realmAddress.toBuffer(),
      communityTokenMint.toBuffer(),
    ],
    splGovernance.programId
  );

  it("should have VWR recognized by SPL Governance program", async () => {
    await createRealm(
      // @ts-ignore
      splGovernance,
      realmName,
      communityTokenMint,
      realmAuthority,
      program.programId
    );
    const [depositorTokenOwnerRecordKey] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
          realmAddress.toBuffer(),
          communityTokenMint.toBuffer(),
          depositor.publicKey.toBuffer(),
        ],
        splGovernance.programId
      );
    const realm = await splGovernance.account.realmV2.fetch(realmAddress);
    await Promise.all([
      splGovernance.methods
        .createTokenOwnerRecord()
        .accounts({
          realm: realmAddress,
          governingTokenMint: communityTokenMint,
          governingTokenOwner: depositor.publicKey,
          tokenOwnerRecordAddress: depositorTokenOwnerRecordKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc(),
        createRegistrar(
          program,
          realmAddress,
          mintToBeStaked,
          splGovernance.programId,
          program.provider.publicKey
        )
    ]);

    await Promise.all([
      createDepositorSplAccounts(
        // @ts-ignore
        program,
        depositor,
        stakePoolNonce
      ),
      initStakePool(
        program,
        mintToBeStaked,
        stakePoolNonce,
        undefined,
        undefined,
        undefined,
        undefined,
        registrarKey
      ),
        // Create governance
        splGovernance.methods
        .createMintGovernance(
          // @ts-ignore something wrong with types, nice to fix.
          {
            communityVoteThreshold: { yesVotePercentage: [new anchor.BN(1)] },
            minCommunityWeightToCreateProposal: new anchor.BN(0),
            minTransactionHoldUpTime: 0,
            votingBaseTime: 1000,
            communityVoteTipping: { disabled: {} },
            councilVoteThreshold: { yesVotePercentage: [new anchor.BN(1)] },
            councilVetoVoteThreshold: { yesVotePercentage: [new anchor.BN(1)] },
            minCouncilWeightToCreateProposal: new anchor.BN(0),
            councilVoteTipping: { disabled: {} },
            communityVetoVoteThreshold: { yesVotePercentage: [new anchor.BN(1)] },
            votingCoolOffTime: 0,
            depositExemptProposalCount: 10,
          },
          false
        )
        .accounts({
          realm: realmAddress,
          mintGovernanceAddress,
          governedMint: mintToBeStaked,
          governedMintAuthority: program.provider.publicKey,
          tokenOwnerRecord: depositorTokenOwnerRecordKey,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: anchor.web3.SystemProgram.programId,
          createAuthority: program.provider.publicKey,
          payer: depositor.publicKey,
        })
        .signers([depositor])
        .rpc({ skipPreflight: true }),
    ]);

    // Stake amounts so VWR has value
    const [depositorVoterWeightRecordKey] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          stakePoolKey.toBuffer(),
          depositor.publicKey.toBuffer(),
          Buffer.from("voterWeightRecord", "utf-8"),
        ],
        program.programId
      );

    await program.methods
      .createVoterWeightRecord()
      .accounts({
        owner: depositor.publicKey,
        registrar: registrarKey,
        stakePool: stakePoolKey,
        voterWeightRecord: depositorVoterWeightRecordKey,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();

    const depositAmount = new anchor.BN(1_000_000_000);
    await deposit(
      program,
      stakePoolNonce,
      mintToBeStaked,
      depositor,
      getAssociatedTokenAddressSync(mintToBeStaked, depositor.publicKey),
      depositAmount,
      new anchor.BN(0),
      0,
      depositorVoterWeightRecordKey
    );

    // Create Proposal
    const proposalSeed = new anchor.web3.Keypair().publicKey;
    const governingTokenMint = realm.communityMint;
    const governance = mintGovernanceAddress;
    // This seeds invalid
    const [proposalAddress] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(GOVERNANCE_PROGRAM_SEED),
        governance.toBuffer(),
        governingTokenMint.toBuffer(),
        proposalSeed.toBuffer(),
      ],
      splGovernance.programId
    );
    const [proposalOwnerRecordKey] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(GOVERNANCE_PROGRAM_SEED),
          new anchor.web3.PublicKey(realmAddress).toBuffer(),
          governingTokenMint.toBuffer(),
          depositor.publicKey.toBuffer(),
        ],
        splGovernance.programId
      );
    const [realmConfigAddress] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from("realm-config"),
        new anchor.web3.PublicKey(realmAddress).toBuffer(),
      ],
      splGovernance.programId
    );

    const signOffIx = await splGovernance.methods
      .signOffProposal()
      .accounts({
        realm: realmAddress,
        governance,
        proposal: proposalAddress,
        signatory: depositor.publicKey,
        proposalOwnerRecord: proposalOwnerRecordKey,
      })
      .signers([depositor])
      .instruction();
    await splGovernance.methods
      .createProposal(
        "test-proposal",
        "",
        { singleChoice: {} },
        ["Approve"],
        true,
        proposalSeed
      )
      .accounts({
        realm: realmAddress,
        proposalAddress,
        // governance comes from the `governedAccount` in the instructions (i.e. a treasury account)
        governance,
        // proposalOwnerRecord is the account for which the user created to deposit into spl governance?
        proposalOwnerRecord: proposalOwnerRecordKey,
        governanceAuthority: depositor.publicKey, // splGovernance.provider.publicKey,
        governingTokenMint,
        payer: depositor.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
        realmConfigAddress,
      })
      .remainingAccounts([
        // VoterWeightRecord
        {
          pubkey: depositorVoterWeightRecordKey,
          isSigner: false,
          isWritable: false,
        },
      ])
      .postInstructions([signOffIx])
      .signers([depositor])
      .rpc({ skipPreflight: true });

    const [voteRecordKey] = anchor.web3.PublicKey.findProgramAddressSync(
      [
        Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
        proposalAddress.toBuffer(),
        depositorTokenOwnerRecordKey.toBuffer(),
      ],
      splGovernance.programId
    );

    await splGovernance.methods
      // @ts-expect-error buffer-layout VecLayout does not adhere to the
      // type anchor enum pattern so we cannot double nest the array
      .castVote({
        approve: [{ rank: 0, weightPercentage: 100 }],
      })
      .accounts({
        realm: realmAddress,
        governance,
        proposal: proposalAddress,
        proposalOwnerRecord: proposalOwnerRecordKey,
        voterTokenOwnerRecord: depositorTokenOwnerRecordKey,
        governanceAuthority: depositor.publicKey,
        voteRecordAddress: voteRecordKey,
        voteGoverningTokenMint: governingTokenMint,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .remainingAccounts([
        // Realm Config
        {
          pubkey: realmConfigAddress,
          isSigner: false,
          isWritable: false,
        },
        // VoterWeightRecord
        {
          pubkey: depositorVoterWeightRecordKey,
          isSigner: false,
          isWritable: false,
        },
      ])
      .signers([depositor])
      .rpc({ skipPreflight: true });

    const voteRecord = await splGovernance.account.voteRecordV2.fetch(
      voteRecordKey
    );
    assert.equal(voteRecord.voterWeight.toString(), depositAmount.toString());
  });
});
