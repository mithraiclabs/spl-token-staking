use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token};
use anchor_spl::token_2022::Token2022;
use anchor_spl::token_interface::{TokenAccount as TokenAccountInterface, Mint as MintInterface};

use crate::{
    errors::ErrorCode,
    state::{StakePool, SCALE_FACTOR_BASE},
};

const TOKEN: Pubkey = anchor_spl::token::spl_token::ID;
const TOKEN_2022: Pubkey = anchor_spl::token_2022::spl_token_2022::ID;

#[derive(Accounts)]
#[instruction(
  nonce: u8,
  max_weight: u64,
  min_duration: u64,
  max_duration: u64,
)]
pub struct InitializeStakePool<'info> {
    /// Payer of rent
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Authority that can add rewards pools
    /// CHECK: No check needed since this will be signer to `AddRewardPool`
    pub authority: UncheckedAccount<'info>,

    /// SPL Token Mint of the underlying token to be deposited for staking
    #[account(
      owner = TOKEN_2022
    )]
    pub mint: InterfaceAccount<'info, MintInterface>,

    #[account(
      init,
      seeds = [
        &nonce.to_le_bytes(),
        mint.key().as_ref(),
        authority.key().as_ref(),
        b"stakePool",
      ],
      bump,
      payer = payer,
      space = 8 + StakePool::LEN,
    )]
    pub stake_pool: AccountLoader<'info, StakePool>,

    /// An SPL token Account for staging A tokens
    #[account(
      init,
      seeds = [&stake_pool.key().to_bytes()[..], b"vault"],
      bump,
      payer = payer,
      token::mint = mint,
      token::authority = stake_pool,
      owner = TOKEN_2022
    )]
    pub vault: InterfaceAccount<'info, TokenAccountInterface>,

    pub token_program: Program<'info, Token2022>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeStakePool>,
    nonce: u8,
    max_weight: u64,
    min_duration: u64,
    max_duration: u64,
    registrar: Option<Pubkey>,
) -> Result<()> {
    if min_duration > max_duration {
        return Err(ErrorCode::InvalidStakePoolDuration.into());
    }
    if SCALE_FACTOR_BASE > max_weight {
        return Err(ErrorCode::InvalidStakePoolWeight.into());
    }
    let mut stake_pool = ctx.accounts.stake_pool.load_init()?;
    stake_pool.creator = ctx.accounts.authority.key();
    stake_pool.authority = ctx.accounts.authority.key();
    if registrar.is_some() {
        // TODO maybe need a check that it's a proper registrar
        stake_pool.registrar = registrar.unwrap();
    }
    stake_pool.mint = ctx.accounts.mint.key();
    stake_pool.vault = ctx.accounts.vault.key();
    stake_pool.base_weight = SCALE_FACTOR_BASE;
    stake_pool.max_weight = max_weight;
    stake_pool.min_duration = min_duration;
    stake_pool.max_duration = max_duration;
    stake_pool.nonce = nonce;
    stake_pool.bump_seed = ctx.bumps.stake_pool;
    Ok(())
}
