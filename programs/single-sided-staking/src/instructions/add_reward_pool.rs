use anchor_lang::prelude::*;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::{StakePool, RewardPool};
use crate::errors::ErrorCode;

#[derive(Accounts)]
#[instruction(index: u8)]
pub struct AddRewardPool<'info> {
  /// Payer and authority of the StakePool
  #[account(mut)]
  pub authority: Signer<'info>,

  /// SPL Token Mint of the token that will be distributed as rewards
  pub reward_mint: Account<'info, Mint>,

  /// StakePool where the RewardPool will be added
  #[account(
    mut, 
    has_one = authority @ ErrorCode::InvalidAuthority,
    constraint = stake_pool.reward_pools[usize::from(index)].reward_vault == Pubkey::default() @ ErrorCode::RewardPoolIndexOccupied,
  )]
  pub stake_pool: Account<'info, StakePool>,

  /// An SPL token Account for holding rewards to be claimed
  #[account(
    init,
    seeds = [stake_pool.key().as_ref(), reward_mint.key().as_ref(), b"rewardVault"],
    bump,
    payer = authority,
    token::mint = reward_mint,
    token::authority = stake_pool,
  )]
  pub reward_vault: Account<'info, TokenAccount>,

  pub token_program: Program<'info, Token>,
  pub rent: Sysvar<'info, Rent>,
  pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddRewardPool>, index: u8) -> Result<()> {
  let stake_pool = &mut ctx.accounts.stake_pool;
  let reward_pool = RewardPool {
    rewards_per_effective_stake: 0,
    reward_vault: ctx.accounts.reward_vault.key(),
    last_amount: 0,
  };
  stake_pool.reward_pools[usize::from(index)] = reward_pool;

  Ok(())
}