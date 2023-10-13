import * as anchor from "@coral-xyz/anchor";
import { SplTokenStaking } from "../target/types/spl_token_staking";
import {
  MintLayout,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { SPL_TOKEN_PROGRAM_ID } from "@coral-xyz/spl-token";

const mintToBeStakedKeypair = anchor.web3.Keypair.generate();
const rewardMint1Keypair = anchor.web3.Keypair.generate();
const rewardMint2Keypair = anchor.web3.Keypair.generate();
export const mintToBeStaked = mintToBeStakedKeypair.publicKey;
export const rewardMint1 = rewardMint1Keypair.publicKey;
export const rewardMint2 = rewardMint2Keypair.publicKey;
export const TEST_MINT_DECIMALS = 9;

export const mochaHooks = {
  /* Before hook to run before all tests */
  beforeAll: [
    async () => {
      // Configure the client to use the local cluster.
      anchor.setProvider(anchor.AnchorProvider.env());

      const program = anchor.workspace
        .SplTokenStaking as anchor.Program<SplTokenStaking>;
      const mintRentExemptBalance =
        await program.provider.connection.getMinimumBalanceForRentExemption(
          MintLayout.span
        );
      const tx = new anchor.web3.Transaction();
      // stake mint IXs
      tx.add(
        anchor.web3.SystemProgram.createAccount({
          fromPubkey: program.provider.publicKey,
          newAccountPubkey: mintToBeStaked,
          space: MintLayout.span,
          lamports: mintRentExemptBalance,
          programId: SPL_TOKEN_PROGRAM_ID,
        })
      );
      tx.add(
        createInitializeMintInstruction(
          mintToBeStaked,
          TEST_MINT_DECIMALS,
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
          TEST_MINT_DECIMALS,
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
          TEST_MINT_DECIMALS,
          program.provider.publicKey,
          undefined
        )
      );

      // Create associated token account for rewards
      const reward1TokenAccount = getAssociatedTokenAddressSync(
        rewardMint1,
        program.provider.publicKey
      );
      tx.add(
        createAssociatedTokenAccountInstruction(
          program.provider.publicKey,
          reward1TokenAccount,
          program.provider.publicKey,
          rewardMint1
        )
      );
      // Mint some tokens for rewards to provider
      tx.add(
        createMintToInstruction(
          rewardMint1,
          reward1TokenAccount,
          program.provider.publicKey,
          9_000_000_000_000_000
        )
      );
      const reward2TokenAccount = getAssociatedTokenAddressSync(
        rewardMint2,
        program.provider.publicKey
      );
      tx.add(
        createAssociatedTokenAccountInstruction(
          program.provider.publicKey,
          reward2TokenAccount,
          program.provider.publicKey,
          rewardMint2
        )
      );
      // Mint some tokens for rewards to provider
      tx.add(
        createMintToInstruction(
          rewardMint2,
          reward2TokenAccount,
          program.provider.publicKey,
          9_000_000_000_000_000
        )
      );
      await program.provider.sendAndConfirm(tx, [
        mintToBeStakedKeypair,
        rewardMint1Keypair,
        rewardMint2Keypair,
      ]);
    },
  ],
};

export const airdropSol = async (
  connection: anchor.web3.Connection,
  receiver: anchor.web3.PublicKey,
  amountInSol: number
) => {
  const txSig = await connection.requestAirdrop(
    receiver,
    anchor.web3.LAMPORTS_PER_SOL * amountInSol
  );
  const latestBlockHash = await connection.getLatestBlockhash();
  return connection.confirmTransaction({
    blockhash: latestBlockHash.blockhash,
    lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
    signature: txSig,
  });
};

/**
 * Setup a Depositor with SOL, token to be staked, and account for stake mint
 */
export const createDepositorSplAccounts = async (
  program: anchor.Program<SplTokenStaking>,
  depositor: anchor.web3.Keypair,
  stakePoolNonce: number,
  mintStake = mintToBeStaked,
  mintToBeStakedAmount: number | bigint = 10_000_000_000
) => {
  const [stakePoolKey] = anchor.web3.PublicKey.findProgramAddressSync(
    [
      new anchor.BN(stakePoolNonce).toArrayLike(Buffer, "le", 1),
      mintStake.toBuffer(),
      program.provider.publicKey.toBuffer(),
      Buffer.from("stakePool", "utf-8"),
    ],
    program.programId
  );
  const [stakeMint] = anchor.web3.PublicKey.findProgramAddressSync(
    [stakePoolKey.toBuffer(), Buffer.from("stakeMint", "utf-8")],
    program.programId
  );
  const stakeMintAccountKey = getAssociatedTokenAddressSync(
    stakeMint,
    depositor.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  const mintToBeStakedAccount = getAssociatedTokenAddressSync(
    mintStake,
    depositor.publicKey,
    false,
    TOKEN_PROGRAM_ID
  );
  const createMintToBeStakedAccountIx = createAssociatedTokenAccountInstruction(
    program.provider.publicKey,
    mintToBeStakedAccount,
    depositor.publicKey,
    mintStake,
    TOKEN_PROGRAM_ID
  );
  // mint 10 stakeMint to provider wallet
  const mintIx = createMintToInstruction(
    mintStake,
    mintToBeStakedAccount,
    program.provider.publicKey,
    mintToBeStakedAmount,
    undefined,
    TOKEN_PROGRAM_ID
  );
  const mintTx = new anchor.web3.Transaction()
    .add(createMintToBeStakedAccountIx)
    .add(mintIx);
  // set up depositor account and stake pool account
  await Promise.all([
    airdropSol(program.provider.connection, depositor.publicKey, 2),
    program.provider.sendAndConfirm(mintTx),
  ]);
  const createStakeMintAccountIx = createAssociatedTokenAccountInstruction(
    program.provider.publicKey,
    stakeMintAccountKey,
    depositor.publicKey,
    stakeMint,
    TOKEN_PROGRAM_ID
  );
  const createStakeMintAccountTx = new anchor.web3.Transaction().add(
    createStakeMintAccountIx
  );
  // add reward pool to the initialized stake pool
  await program.provider.sendAndConfirm(createStakeMintAccountTx);

  return depositor;
};
