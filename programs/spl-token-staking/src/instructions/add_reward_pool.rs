use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::{RewardPool, StakePool};
use crate::errors::ErrorCode;

#[derive(Accounts)]
#[instruction(index: u8)]
pub struct AddRewardPool<'info> {
  /// Payer of rent
  #[account(mut)]
  pub payer: Signer<'info>,

  /// Authority of the StakePool
  pub authority: Signer<'info>,

  /// SPL Token Mint of the token that will be distributed as rewards
  pub reward_mint: Account<'info, Mint>,

  /// StakePool where the RewardPool will be added
  #[account(
    mut, 
    has_one = authority @ ErrorCode::InvalidAuthority,
    constraint = stake_pool.load()?.reward_pools[usize::from(index)].reward_vault == Pubkey::default() 
      @ ErrorCode::RewardPoolIndexOccupied,
  )]
  pub stake_pool: AccountLoader<'info, StakePool>,

  /// An SPL token Account for holding rewards to be claimed
  #[account(
    init,
    seeds = [stake_pool.key().as_ref(), reward_mint.key().as_ref(), b"rewardVault"],
    bump,
    payer = payer,
    token::mint = reward_mint,
    token::authority = stake_pool,
  )]
  pub reward_vault: Account<'info, TokenAccount>,

  pub token_program: Program<'info, Token>,
  pub rent: Sysvar<'info, Rent>,
  pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddRewardPool>, index: u8) -> Result<()> {
  let mut stake_pool = ctx.accounts.stake_pool.load_mut()?;
  let reward_pool = RewardPool::new(&ctx.accounts.reward_vault.key());
  stake_pool.reward_pools[usize::from(index)] = reward_pool;

  Ok(())
}