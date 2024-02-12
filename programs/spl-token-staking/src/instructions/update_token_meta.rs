use anchor_lang::prelude::*;
use crate::{errors::ErrorCode, state::StakePool, ID};

#[derive(Accounts)]
pub struct UpdateTokenMeta<'info> {
    pub payer: Signer<'info>,

    /// CHECK: Handled by metadata program
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,

    /// CHECK: Handled
    #[account(
      owner = ID,
      // Validates the StakePool's stake mint matches the mint to have updated metadata
      has_one = stake_mint
    )]
    pub stake_pool: AccountLoader<'info, StakePool>,

    /// CHECK: Handled by has_one with lp_mint
    pub stake_mint: UncheckedAccount<'info>,

    /// CHECK: Handled by address check
    #[account(
      address = mpl_token_metadata::ID
    )]
    pub metadata_program: UncheckedAccount<'info>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<UpdateTokenMeta>,
    name: String,
    symbol: String,
    uri: String,
) -> Result<()> {
    let stake_pool = ctx.accounts.stake_pool.load()?;

    require!(
        ctx.accounts.payer.key() == stake_pool.authority,
        ErrorCode::InvalidAuthority
    );
    Ok(())
}
