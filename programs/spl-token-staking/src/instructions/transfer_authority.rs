use anchor_lang::prelude::*;

use crate::{
  errors::ErrorCode,
  state::StakePool,
};

#[derive(Accounts)]
pub struct TransferAuthority<'info> {
  /// Current authority of the StakePool
  #[account(mut)]
  pub authority: Signer<'info>,

  /// CHECK: No check required for the new authority
  pub new_authority: UncheckedAccount<'info>,

  /// StakePool that will have it's authority updated
  #[account(
    mut, 
    has_one = authority @ ErrorCode::InvalidAuthority,
  )]
  pub stake_pool: AccountLoader<'info, StakePool>,
}

pub fn handler(ctx: Context<TransferAuthority>) -> Result<()> {
  let mut stake_pool = ctx.accounts.stake_pool.load_mut()?;
  stake_pool.authority = ctx.accounts.new_authority.key();
  Ok(())
}