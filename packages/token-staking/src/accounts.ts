import * as B from "@native-to-anchor/buffer-layout";

export const VOTER_WEIGHT_RECORD_LAYOUT = B.struct<any>(
  [
    B.seq(B.u8(), 8, "accountDiscriminator"),
    B.publicKey("realm"),
    B.publicKey("governingTokenMint"),
    B.publicKey("governingTokenOwner"),
    B.u64("voterWeight"),
    B.option(B.u64(), "voterWeightExpiry"),
    ((p: string) => {
      // @ts-expect-error bad typing of union throws TS error.
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
