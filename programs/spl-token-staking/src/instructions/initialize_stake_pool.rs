use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    errors::ErrorCode,
    state::{get_digit_shift_by_max_scalar, StakePool},
};

#[derive(Accounts)]
#[instruction(
  nonce: u8,
  base_weight: u64,
  max_weight: u64,
  min_duration: u64,
  max_duration: u64,
)]
pub struct InitializeStakePool<'info> {
    /// Payer and authority of the StakePool
    #[account(mut)]
    pub authority: Signer<'info>,

    /// SPL Token Mint of the underlying token to be deposited for staking
    pub mint: Account<'info, Mint>,

    #[account(
      init,
      seeds = [
        &nonce.to_le_bytes(),
        authority.key().as_ref(),
        b"stakePool",
      ],
      bump,
      payer = authority,
      space = 8 + StakePool::LEN,
    )]
    pub stake_pool: AccountLoader<'info, StakePool>,

    /// An SPL token Mint for the effective stake weight token
    #[account(
      init,
      seeds = [&stake_pool.key().to_bytes()[..], b"stakeMint"],
      bump,
      payer = authority,
      mint::decimals = u8::max(mint.decimals - get_digit_shift_by_max_scalar(max_weight), 0),
      mint::authority = stake_pool,
    )]
    pub stake_mint: Account<'info, Mint>,

    /// An SPL token Account for staging A tokens
    #[account(
      init,
      seeds = [&stake_pool.key().to_bytes()[..], b"vault"],
      bump,
      payer = authority,
      token::mint = mint,
      token::authority = stake_pool,
    )]
    pub vault: Account<'info, TokenAccount>,

    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<InitializeStakePool>,
    nonce: u8,
    base_weight: u64,
    max_weight: u64,
    min_duration: u64,
    max_duration: u64,
) -> Result<()> {
    if min_duration > max_duration {
        return Err(ErrorCode::InvalidStakePoolDuration.into());
    }
    if base_weight > max_weight {
        return Err(ErrorCode::InvalidStakePoolWeight.into());
    }
    let mut stake_pool = ctx.accounts.stake_pool.load_init()?;
    stake_pool.authority = ctx.accounts.authority.key();
    stake_pool.stake_mint = ctx.accounts.stake_mint.key();
    stake_pool.vault = ctx.accounts.vault.key();
    stake_pool.base_weight = base_weight;
    stake_pool.max_weight = max_weight;
    stake_pool.min_duration = min_duration;
    stake_pool.max_duration = max_duration;
    stake_pool.nonce = nonce;
    stake_pool.bump_seed = *ctx.bumps.get("stake_pool").unwrap();
    Ok(())
}
