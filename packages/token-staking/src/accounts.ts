import * as anchor from "@coral-xyz/anchor";
import * as B from "@native-to-anchor/buffer-layout";

export const VOTER_WEIGHT_RECORD_LAYOUT = B.struct<{
  accountDiscriminator: number[];
  realm: anchor.web3.PublicKey;
  governingTokenMint: anchor.web3.PublicKey;
  governingTokenOwner: anchor.web3.PublicKey;
  voterWeight: anchor.BN;
  voterWeightExpiry: anchor.BN | null;
  weightAction: Record<string, object>;
  weightActionTarget: anchor.web3.PublicKey | null;
}>(
  [
    B.seq(B.u8(), 8, "accountDiscriminator"),
    B.publicKey("realm"),
    B.publicKey("governingTokenMint"),
    B.publicKey("governingTokenOwner"),
    B.u64("voterWeight"),
    B.option(B.u64(), "voterWeightExpiry"),
    ((p: string) => {
      const U = B.union(B.u8("discriminator"), null, p);
      U.addVariant(0, B.struct([]), "castVote");
      U.addVariant(1, B.struct([]), "commentProposal");
      U.addVariant(2, B.struct([]), "createGovernance");
      U.addVariant(3, B.struct([]), "createProposal");
      U.addVariant(4, B.struct([]), "signOffProposal");
      return U;
    })("weightAction"),
    B.option(B.publicKey(), "weightActionTarget"),
  ],
  "voterWeightRecord"
);
