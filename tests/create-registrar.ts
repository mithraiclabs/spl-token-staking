import * as anchor from "@coral-xyz/anchor";
import { SplTokenStaking } from "@mithraic-labs/token-staking";
import { assertKeysEqual } from "./genericTests";
import {
  GOVERNANCE_PROGRAM_ID,
  GOVERNANCE_PROGRAM_SEED,
  createSplGovernanceProgram,
} from "@mithraic-labs/spl-governance";
import { mintToBeStaked } from "./hooks";
import { createRealm } from "./utils";

describe("create-registrar", () => {
  const program = anchor.workspace
    .SplTokenStaking as anchor.Program<SplTokenStaking>;
  const splGovernance = createSplGovernanceProgram(
    // @ts-ignore
    program._provider.wallet,
    program.provider.connection,
    GOVERNANCE_PROGRAM_ID
  );
  const realmName = "create-registrar-realm";
  const [realmAddress] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from(GOVERNANCE_PROGRAM_SEED, "utf-8"),
      Buffer.from(realmName, "utf-8"),
    ],
    splGovernance.programId
  );

  before(async () => {
    const communityTokenMint = mintToBeStaked;
    const realmAuthority = splGovernance.provider.publicKey;
    await createRealm(
      // @ts-ignore
      splGovernance,
      realmName,
      communityTokenMint,
      realmAuthority,
      program.programId
    );
  });

  it("Create Registrar for SPL Governance plugin", async () => {
    const realmKey = realmAddress;
    const realmGoverningTokenMint = mintToBeStaked;
    const governanceProgramId = splGovernance.programId;
    // authority is the payer for now.
    const realmAuthority = program.provider.publicKey;
    const [registrarKey, registrarBump] =
      anchor.web3.PublicKey.findProgramAddressSync(
        [
          realmKey.toBuffer(),
          realmGoverningTokenMint.toBuffer(),
          Buffer.from("registrar", "utf-8"),
        ],
        program.programId
      );
    await program.methods
      .createRegistrar(registrarBump)
      .accounts({
        payer: program.provider.publicKey,
        registrar: registrarKey,
        realm: realmKey,
        governanceProgramId,
        realmGoverningTokenMint,
        realmAuthority,
        systemProgram: anchor.web3.SystemProgram.programId,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc({ skipPreflight: true });

    const registrar = await program.account.registrar.fetch(registrarKey);
    assertKeysEqual(registrar.realm, realmKey);
    assertKeysEqual(registrar.governanceProgramId, governanceProgramId);
    assertKeysEqual(registrar.realmAuthority, realmAuthority);
    assertKeysEqual(registrar.realmGoverningTokenMint, realmGoverningTokenMint);
  });
});
