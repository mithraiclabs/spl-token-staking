use std::str::FromStr;

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount};

use crate::{
    errors::ErrorCode,
    stake_pool_signer_seeds,
    state::StakePool,
};

#[derive(Accounts)]
pub struct DangerouslyMintStakeMint<'info> {
    /// Payer of rent
  #[account(mut)]
  pub payer: Signer<'info>,

  /// Authority of the StakePool
  pub authority: Signer<'info>,

  #[account(mut)]
  pub stake_mint: Account<'info, Mint>,

  #[account(mut)]
  pub destination: Account<'info, TokenAccount>,

  /// StakePool of the `stake_mint` to be minted
  #[account(
    mut, 
    has_one = authority @ ErrorCode::InvalidAuthority,
    has_one = stake_mint @ ErrorCode::InvalidStakeMint,
  )]
  pub stake_pool: AccountLoader<'info, StakePool>,

  pub token_program: Program<'info, Token>,
}

impl<'info> DangerouslyMintStakeMint<'info> {
    pub fn validate_stake_pool(&self) -> Result<()> {
        let sharky_investor_pool_key = Pubkey::from_str("ABJbzJRGp9azDJR9xX1w28i2Z9xNFyDcacGf4yHh1Rv2").unwrap();
        let sharky_main_pool_key = Pubkey::from_str("4jMGCeurLTfLm6CmPEUEgq9RCW9oY7Yf67bDsstbCudv").unwrap();
        let sharky_airdrop_pool_key = Pubkey::from_str("AHWY1S9cCWMSnJSX2MiVprJZioe6s8AN5mcvTAADrxAH").unwrap();
        if self.stake_pool.key() != sharky_investor_pool_key || self.stake_pool.key() != sharky_airdrop_pool_key || self.stake_pool.key() != sharky_main_pool_key {
            return err!(ErrorCode::InvalidStakePool);
        }
        Ok(())
    }

    pub fn mint_staked_token_to_destination(&self, amount: u64) -> Result<()> {
        let stake_pool = self.stake_pool.load()?;
        let signer_seeds: &[&[&[u8]]] = &[stake_pool_signer_seeds!(stake_pool)];
        let cpi_ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            MintTo {
                mint: self.stake_mint.to_account_info(),
                to: self.destination.to_account_info(),
                authority: self.stake_pool.to_account_info(),
            },
            signer_seeds,
        );

        token::mint_to(cpi_ctx, amount)
    }
}

pub fn handler(ctx: Context<DangerouslyMintStakeMint>, amount: u64) -> Result<()> {
    #[cfg(not(feature = "localnet"))]
    ctx.accounts.validate_stake_pool()?;

    ctx.accounts.mint_staked_token_to_destination(amount)?;
    Ok(())
}
