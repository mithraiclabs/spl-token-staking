use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::{
    errors::ErrorCode,
    state::{get_digit_shift_by_max_scalar, SCALE_FACTOR_BASE, StakePool},
};

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
    pub mint: Account<'info, Mint>,

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

    /// An SPL token Mint for the effective stake weight token
    #[account(
      init,
      seeds = [&stake_pool.key().to_bytes()[..], b"stakeMint"],
      bump,
      payer = payer,
      mint::decimals = mint.decimals.checked_sub(get_digit_shift_by_max_scalar(max_weight)).unwrap_or_default(),
      mint::authority = stake_pool,
    )]
    pub stake_mint: Account<'info, Mint>,

    /// An SPL token Account for staging A tokens
    #[account(
      init,
      seeds = [&stake_pool.key().to_bytes()[..], b"vault"],
      bump,
      payer = payer,
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
    max_weight: u64,
    min_duration: u64,
    max_duration: u64,
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
    stake_pool.mint = ctx.accounts.mint.key();
    stake_pool.stake_mint = ctx.accounts.stake_mint.key();
    stake_pool.vault = ctx.accounts.vault.key();
    stake_pool.base_weight = SCALE_FACTOR_BASE;
    stake_pool.max_weight = max_weight;
    stake_pool.min_duration = min_duration;
    stake_pool.max_duration = max_duration;
    stake_pool.nonce = nonce;
    stake_pool.bump_seed = *ctx.bumps.get("stake_pool").unwrap();
    Ok(())
}
