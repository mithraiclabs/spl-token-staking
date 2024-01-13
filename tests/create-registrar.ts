import * as anchor from "@coral-xyz/anchor";
import { SplTokenStaking } from "@mithraic-labs/token-staking";
import { assertKeysEqual } from "./genericTests";
import {
  GOVERNANCE_PROGRAM_ID,
  GOVERNANCE_PROGRAM_SEED,
  createSplGovernanceProgram,
} from "@mithraic-labs/spl-governance";
import { mintToBeStaked } from "./hooks";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";

describe.only("create-registrar", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const splGovernance = createSplGovernanceProgram(
    // @ts-ignore
    program._provider.wallet,
    program.provider.connection,
    GOVERNANCE_PROGRAM_ID
  );
  const realmName = "Test Realm";
  const [realmAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
      Buffer.from(realmName, "utf-8"),
    ],
    splGovernance.programId
  );
  // const program = anchor.workspace
  // .SplTokenStaking as anchor.Program<SplTokenStaking>;

  before(async () => {
    const communityTokenMint = mintToBeStaked;
    const realmAuthority = splGovernance.provider.publicKey;
    const [communityTokenHoldingAddress] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
          realmAddress.toBuffer(),
          communityTokenMint.toBuffer(),
        ],
        splGovernance.programId
      );
    await splGovernance.methods
      .createRealm(realmName, {
        useCommunityVoterWeightAddin: true,
        useMaxCommunityVoterWeightAddin: false,
        useCouncilMint: false,
        minCommunityWeightToCreateGovernance: new anchor.BN(100),
        communityMintMaxVoteWeightSource: { absolute: [new anchor.BN(0)] },
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
        // TODO might have to add vote_weight_record_addin and max_vote_weight_record_addin accounts
      ])
      .rpc();
  });

  it("Create Registrar for SPL Governance plugin", async () => {
    const realmKey = anchor.web3.PublicKey.default;
    const realmGoverningTokenMint = anchor.web3.PublicKey.default;
    const governanceProgramId = anchor.web3.PublicKey.default;
    const realmAuthority = anchor.web3.PublicKey.default;
    const [registrarKey, registrarBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          realmKey.toBuffer(),
          realmGoverningTokenMint.toBuffer(),
          Buffer.from("registrar", "utf-8"),
        ],
        program.programId
      );
    await program.methods.createRegistrar(registrarBump).accounts({
      payer: program.provider.publicKey,
      registrar: registrarKey,
      realm: realmKey,
      governanceProgramId,
      realmGoverningTokenMint,
      realmAuthority,
      systemProgram: anchor.web3.SystemProgram.programId,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
    });

    const registrar = await program.account.registrar.fetch(registrarKey);
    assertKeysEqual(registrar.realm, realmKey);
    assertKeysEqual(registrar.governanceProgramId, governanceProgramId);
    assertKeysEqual(registrar.realmAuthority, realmAuthority);
    assertKeysEqual(registrar.realmGoverningTokenMint, realmGoverningTokenMint);
  });
});
