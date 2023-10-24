const anchor = require("@coral-xyz/anchor");
const main = () => {
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(0).toArrayLike(Buffer, "le", 1),
      new anchor.web3.PublicKey(
        "7M24j832rJR9bJzoc8bBTyVsLbajKefNfPKACJWf9ooo"
      ).toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    new anchor.web3.PublicKey("STAKEkKzbdeKkqzKpLkNQD3SUuLgshDKCD7U8duxAbB")
  );

  // 2cJi8MAL7BpFJ2VqcFyo7LP3DbaDxG7SRiJMqrLG5vUA

  console.log("test ", stakePoolKey.toString());
};

main();
