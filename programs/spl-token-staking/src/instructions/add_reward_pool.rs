use anchor_lang::prelude::*;
use anchor_spl::token_interface::{
    Mint as MintInterface, TokenAccount as TokenAccountInterface, TokenInterface,
};

use crate::errors::ErrorCode;
use crate::state::{RewardPool, StakePool};

#[derive(Accounts)]
#[instruction(index: u8)]
pub struct AddRewardPool<'info> {
    /// Payer of rent
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Authority of the StakePool
    pub authority: Signer<'info>,

    /// SPL Token Mint of the token that will be distributed as rewards
    pub reward_mint: InterfaceAccount<'info, MintInterface>,

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
    pub reward_vault: InterfaceAccount<'info, TokenAccountInterface>,

    pub token_program: Interface<'info, TokenInterface>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<AddRewardPool>, index: u8) -> Result<()> {
    let mut stake_pool = ctx.accounts.stake_pool.load_mut()?;
    let reward_pool = RewardPool::new(
        &ctx.accounts.reward_vault.key(),
        ctx.accounts.reward_mint.decimals,
    );
    stake_pool.reward_pools[usize::from(index)] = reward_pool;

    Ok(())
}
