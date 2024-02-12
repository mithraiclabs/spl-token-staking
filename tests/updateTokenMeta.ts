import {
  AnchorProvider,
  BN,
  Program,
  workspace,
  web3,
  IdlAccounts,
} from "@coral-xyz/anchor";
import {
  Metadata,
  fetchMetadata,
  mplTokenMetadata,
} from "@metaplex-foundation/mpl-token-metadata";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { assert } from "chai";
import { SplTokenStaking } from "../target/types/spl_token_staking";
import { SCALE_FACTOR_BASE, initStakePool } from "@mithraic-labs/token-staking";
import { mintToBeStaked } from "./hooks";

const METADATA_PROGRAM_KEY = new web3.PublicKey(
  "metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s"
);

const deriveMetadataKey = (mint: web3.PublicKey) =>
  web3.PublicKey.findProgramAddressSync(
    [
      Buffer.from("metadata", "utf-8"),
      METADATA_PROGRAM_KEY.toBuffer(),
      mint.toBuffer(),
    ],
    METADATA_PROGRAM_KEY
  );

describe("UpdateTokenMeta", () => {
  const stakePoolNonce = 22;
  const program = workspace.SplTokenStaking as Program<SplTokenStaking>;
  const provider = AnchorProvider.local();
  const umi = createUmi(provider.connection.rpcEndpoint).use(
    mplTokenMetadata()
  );
  let metadataKey: web3.PublicKey;
  let stakePoolKey: web3.PublicKey;
  let stakePool: IdlAccounts<SplTokenStaking>["stakePool"];

  before(async () => {
    // Create StakePool
    [stakePoolKey] = web3.PublicKey.findProgramAddressSync(
      [
        new BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
        mintToBeStaked.toBuffer(),
        program.provider.publicKey.toBuffer(),
        Buffer.from("stakePool", "utf-8"),
      ],
      program.programId
    );
    const maxWeight = new BN(4 * parseInt(SCALE_FACTOR_BASE.toString()));
    const minDuration = new BN(1000);
    const maxDuration = new BN(4 * 31536000);
    await Promise.all([
      initStakePool(
        program,
        mintToBeStaked,
        stakePoolNonce,
        maxWeight,
        minDuration,
        maxDuration
      ),
    ]);
    stakePool = await program.account.stakePool.fetch(stakePoolKey);
    // Derive the Metadata account
    [metadataKey] = deriveMetadataKey(stakePool.stakeMint);
  });

  it("should create the meta for the OptionMint", async () => {
    const symbol = "sTEST";
    const name = "Staking Test Token";
    // Validate the metadata has not been set
    try {
      // @ts-ignore: Stupid umi
      await fetchMetadata(umi, metadataKey);
      assert.ok(false);
    } catch {
      assert.ok(true);
    }

    // Actually call the update instruction
    await program.methods
      .updateTokenMeta(symbol, name, "")
      .accounts({
        payer: provider.publicKey,
        metadataAccount: metadataKey,
        stakePool: stakePoolKey,
        stakeMint: stakePool.stakeMint,
        metadataProgram: METADATA_PROGRAM_KEY,
        rent: web3.SYSVAR_RENT_PUBKEY,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    // Validate the instruction meta is correct
    // @ts-ignore: Stupid umi
    const metadataAfter = await fetchMetadata(umi, metadataKey);
    assert.equal(
      String(
        metadataAfter.symbol.replace(
          /^[\s\uFEFF\xA0\0]+|[\s\uFEFF\xA0\0]+$/g,
          ""
        )
      ),
      symbol
    );
    assert.equal(
      metadataAfter.name.replace(/^[\s\uFEFF\xA0\0]+|[\s\uFEFF\xA0\0]+$/g, ""),
      name
    );
  });

  describe("Updating after creation", () => {
    it("Should still complete", async () => {
      const newSymbol = "NEW";
      const newName = "updated name";
      // Validate the metadata has not been set
      try {
        // @ts-ignore: Stupid umi
        await fetchMetadata(umi, metadataKey);
        assert.ok(true);
      } catch {
        assert.ok(false);
      }

      // Actually call the update instruction
      await program.methods
        .updateTokenMeta(newSymbol, newName, "")
        .accounts({
          payer: provider.publicKey,
          metadataAccount: metadataKey,
          stakePool: stakePoolKey,
          stakeMint: stakePool.stakeMint,
          metadataProgram: METADATA_PROGRAM_KEY,
          rent: web3.SYSVAR_RENT_PUBKEY,
          systemProgram: web3.SystemProgram.programId,
        })
        .rpc();

      // Validate the instruction meta is correct
      // @ts-ignore: Stupid umi
      const metadataAfter = await fetchMetadata(umi, metadataKey);
      assert.equal(
        String(
          metadataAfter.symbol.replace(
            /^[\s\uFEFF\xA0\0]+|[\s\uFEFF\xA0\0]+$/g,
            ""
          )
        ),
        newSymbol
      );
      assert.equal(
        metadataAfter.name.replace(
          /^[\s\uFEFF\xA0\0]+|[\s\uFEFF\xA0\0]+$/g,
          ""
        ),
        newName
      );
    });
  });
});
