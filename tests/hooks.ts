import * as anchor from "@coral-xyz/anchor";
import { SingleSidedStaking } from "../target/types/single_sided_staking";
import { MintLayout, createInitializeMintInstruction } from "@solana/spl-token";
import { SPL_TOKEN_PROGRAM_ID } from "@coral-xyz/spl-token";

export let stakeMint: anchor.web3.PublicKey;
export let rewardMint1: anchor.web3.PublicKey;
export let rewardMint2: anchor.web3.PublicKey;

export const mochaHooks = {
  /* Before hook to run before all tests */
  beforeAll: [
    async () => {
      // Configure the client to use the local cluster.
      anchor.setProvider(anchor.AnchorProvider.env());

      const program = anchor.workspace
        .SingleSidedStaking as anchor.Program<SingleSidedStaking>;
      const stakeMintKeypair = anchor.web3.Keypair.generate();
      const rewardMint1Keypair = anchor.web3.Keypair.generate();
      const rewardMint2Keypair = anchor.web3.Keypair.generate();
      stakeMint = stakeMintKeypair.publicKey;
      rewardMint1 = rewardMint1Keypair.publicKey;
      rewardMint2 = rewardMint2Keypair.publicKey;
      const mintRentExemptBalance =
        await program.provider.connection.getMinimumBalanceForRentExemption(
          MintLayout.span
        );
      const tx = new anchor.web3.Transaction();
      // stake mint IXs
      tx.add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: program.provider.publicKey,
          newAccountPubkey: stakeMint,
          space: MintLayout.span,
          lamports: mintRentExemptBalance,
          programId: SPL_TOKEN_PROGRAM_ID,
        })
      );
      tx.add(
        createInitializeMintInstruction(
          stakeMint,
          9,
          program.provider.publicKey,
          undefined
        )
      );
      // reward mint IXs
      tx.add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: program.provider.publicKey,
          newAccountPubkey: rewardMint1,
          space: MintLayout.span,
          lamports: mintRentExemptBalance,
          programId: SPL_TOKEN_PROGRAM_ID,
        })
      );
      tx.add(
        createInitializeMintInstruction(
          rewardMint1,
          9,
          program.provider.publicKey,
          undefined
        )
      );
      tx.add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: program.provider.publicKey,
          newAccountPubkey: rewardMint2,
          space: MintLayout.span,
          lamports: mintRentExemptBalance,
          programId: SPL_TOKEN_PROGRAM_ID,
        })
      );
      tx.add(
        createInitializeMintInstruction(
          rewardMint2,
          9,
          program.provider.publicKey,
          undefined
        )
      );
      await program.provider.sendAndConfirm(tx, [
        stakeMintKeypair,
        rewardMint1Keypair,
        rewardMint2Keypair,
      ]);
    },
  ],
};

export const initStakePool = async (
  program: anchor.Program<SingleSidedStaking>,
  nonce = 0,
  digitShift = 0
) => {
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(nonce).toArrayLike(Buffer, "le", 1),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const [stakeMintKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("stakeMint", "utf-8")],
    program.programId
  );
  const [vaultKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("vault", "utf-8")],
    program.programId
  );
  await program.methods
    .initializeStakePool(nonce, digitShift)
    .accounts({
      authority: program.provider.publicKey,
      stakePool: stakePoolKey,
      stakeMint: stakeMintKey,
      mint: stakeMint,
      vault: vaultKey,
      tokenProgram: SPL_TOKEN_PROGRAM_ID,
      rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .rpc();
};
