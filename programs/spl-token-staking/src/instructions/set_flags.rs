use anchor_lang::prelude::*;

use crate::{
  errors::ErrorCode,
  state::StakePool,
};

#[derive(Accounts)]
pub struct SetFlags<'info> {
  /// Current authority of the StakePool
  #[account(mut)]
  pub authority: Signer<'info>,


  #[account(
    mut, 
    has_one = authority @ ErrorCode::InvalidAuthority,
  )]
  pub stake_pool: AccountLoader<'info, StakePool>,
}

pub fn handler(ctx: Context<SetFlags>, flags: u8) -> Result<()> {
  let mut stake_pool = ctx.accounts.stake_pool.load_mut()?;
  stake_pool.flags = flags;
  Ok(())
}