use crate::{errors::ErrorCode, stake_pool_signer_seeds, state::StakePool, ID};
use anchor_lang::prelude::*;
use anchor_spl::metadata::{
    create_metadata_accounts_v3, update_metadata_accounts_v2, CreateMetadataAccountsV3,
    UpdateMetadataAccountsV2,
};
use mpl_token_metadata::state::DataV2;

#[derive(Accounts)]
pub struct UpdateTokenMeta<'info> {
    pub authority: Signer<'info>,

    /// CHECK: Handled by metadata program
    #[account(mut)]
    pub metadata_account: UncheckedAccount<'info>,

    #[account(
      owner = ID,
      // Validates the StakePool's stake mint matches the mint to have updated metadata
      has_one = stake_mint,
      // Validate the stake pool authority is the signer
      has_one = authority @ErrorCode::InvalidAuthority
    )]
    pub stake_pool: AccountLoader<'info, StakePool>,

    /// CHECK: Handled by has_one with stake_mint
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

    let data = DataV2 {
        name,
        symbol,
        uri,
        seller_fee_basis_points: 0,
        creators: None,
        collection: None,
        uses: None,
    };

    if ctx.accounts.metadata_account.data_is_empty() {
        let cpi_accounts = CreateMetadataAccountsV3 {
            metadata: ctx.accounts.metadata_account.to_account_info(),
            mint: ctx.accounts.stake_mint.to_account_info(),
            mint_authority: ctx.accounts.stake_pool.to_account_info(),
            payer: ctx.accounts.authority.to_account_info(),
            update_authority: ctx.accounts.stake_pool.to_account_info(),
            system_program: ctx.accounts.system_program.to_account_info(),
            rent: ctx.accounts.rent.to_account_info(),
        };
        let ctx = CpiContext {
            accounts: cpi_accounts,
            remaining_accounts: vec![],
            program: ctx.accounts.metadata_program.to_account_info(),
            signer_seeds: &[stake_pool_signer_seeds!(stake_pool)],
        };
        create_metadata_accounts_v3(ctx, data, true, true, None)?;
    } else {
        let cpi_accounts = UpdateMetadataAccountsV2 {
            metadata: ctx.accounts.metadata_account.to_account_info(),
            update_authority: ctx.accounts.stake_pool.to_account_info(),
        };
        let ctx = CpiContext {
            accounts: cpi_accounts,
            remaining_accounts: vec![],
            program: ctx.accounts.metadata_program.to_account_info(),
            signer_seeds: &[stake_pool_signer_seeds!(stake_pool)],
        };
        update_metadata_accounts_v2(ctx, None, Some(data), None, Some(true))?;
    }

    Ok(())
}
