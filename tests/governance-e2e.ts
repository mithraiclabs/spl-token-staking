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
import { assert } from "chai";
import { createRealm, deposit } from "./utils";

describe.only("governance-e2e", () => {
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

  it("should have VWR recognized by SPL Governance program", async () => {
    await createRealm(
      // @ts-ignore
      splGovernance,
      realmName,
      communityTokenMint,
      realmAuthority,
      program.programId
    );
    // const [payerTokenOwnerRecordKey] =
    //   anchor.web3.PublicKey.findProgramAddressSync(
    //     [
    //       Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
    //       realmAddress.toBuffer(),
    //       communityTokenMint.toBuffer(),
    //       program.provider.publicKey.toBuffer(),
    //     ],
    //     splGovernance.programId
    //   );
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
      // splGovernance.methods
      //   .createTokenOwnerRecord()
      //   .accounts({
      //     realm: realmAddress,
      //     governingTokenMint: communityTokenMint,
      //     governingTokenOwner: program.provider.publicKey,
      //     tokenOwnerRecordAddress: payerTokenOwnerRecordKey,
      //     systemProgram: anchor.web3.SystemProgram.programId,
      //   })
      //   .rpc(),
    ]);
    await createRegistrar(
      program,
      realmAddress,
      mintToBeStaked,
      splGovernance.programId,
      program.provider.publicKey
    );
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
    ]);

    // Create governance
    const [mintGovernanceAddress] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from("mint-governance", "utf-8"),
          realmAddress.toBuffer(),
          communityTokenMint.toBuffer(),
        ],
        splGovernance.programId
      );
    await splGovernance.methods
      .createMintGovernance(
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
      .rpc({ skipPreflight: true });

    // Stake amounts so VWR has value
    // const [payerVoterWeightRecordKey] =
    //   anchor.web3.PublicKey.findProgramAddressSync(
    //     [
    //       stakePoolKey.toBuffer(),
    //       program.provider.publicKey.toBuffer(),
    //       Buffer.from("voterWeightRecord", "utf-8"),
    //     ],
    //     program.programId
    //   );
    const [depositorVoterWeightRecordKey] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          stakePoolKey.toBuffer(),
          depositor.publicKey.toBuffer(),
          Buffer.from("voterWeightRecord", "utf-8"),
        ],
        program.programId
      );
    // await program.methods
    //   .createVoterWeightRecord()
    //   .accounts({
    //     owner: program.provider.publicKey,
    //     registrar: registrarKey,
    //     stakePool: stakePoolKey,
    //     voterWeightRecord: payerVoterWeightRecordKey,
    //     rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    //     systemProgram: anchor.web3.SystemProgram.programId,
    //   })
    //   .rpc();
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
    // await deposit(
    //   program,
    //   stakePoolNonce,
    //   mintToBeStaked,
    //   // @ts-ignore
    //   program._provider.wallet.payer,
    //   getAssociatedTokenAddressSync(mintToBeStaked, program.provider.publicKey),
    //   new anchor.BN(1_000_000_000),
    //   new anchor.BN(0),
    //   0,
    //   payerVoterWeightRecordKey
    // );
    await deposit(
      program,
      stakePoolNonce,
      mintToBeStaked,
      depositor,
      getAssociatedTokenAddressSync(mintToBeStaked, depositor.publicKey),
      new anchor.BN(1_000_000_000),
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
      [proposalAddress.toBuffer(), depositorTokenOwnerRecordKey.toBuffer()],
      splGovernance.programId
    );
    await splGovernance.methods
      .castVote({
        approve: [[{ rank: 0, weightPercentage: 100 }]],
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
        // VoterWeightRecord
        {
          pubkey: depositorVoterWeightRecordKey,
          isSigner: false,
          isWritable: false,
        },
      ])
      .signers([depositor])
      .rpc({ skipPreflight: true });
  });
});
