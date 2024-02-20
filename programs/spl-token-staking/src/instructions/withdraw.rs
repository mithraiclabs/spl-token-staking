use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, TokenAccount, Transfer};

use crate::{errors::ErrorCode, stake_pool_signer_seeds, state::StakeDepositReceipt};

use super::claim_base::*;
use crate::state::u128;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub claim_base: ClaimBase<'info>,

    /// Vault of the StakePool token will be transferred from
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    /// stake_mint of StakePool that will be burned
    #[account(mut)]
    pub stake_mint: Account<'info, Mint>,

    /// Token Account holding weighted stake representation token to burn
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,

    /// Token account to transfer the previously staked token to
    #[account(mut)]
    pub destination: Account<'info, TokenAccount>,
}

impl<'info> Withdraw<'info> {
    /// Addiditional validations that rely on the accounts within `claim_base`.
    pub fn validate_stake_pool_and_owner(&self) -> Result<()> {
        let stake_pool = self.claim_base.stake_pool.load()?;
        require!(
            stake_pool.vault.key() == self.vault.key(),
            ErrorCode::InvalidStakePoolVault
        );
        require!(
            stake_pool.stake_mint.key() == self.stake_mint.key(),
            ErrorCode::InvalidStakeMint
        );
        require!(
            self.from.owner.key() == self.claim_base.owner.key(),
            ErrorCode::InvalidAuthority
        );
        Ok(())
    }
    /// Transfer the owner's previously staked tokens back.
    pub fn transfer_staked_tokens_to_owner(&self) -> Result<()> {
        let stake_pool = self.claim_base.stake_pool.load()?;
        let signer_seeds: &[&[&[u8]]] = &[stake_pool_signer_seeds!(stake_pool)];
        let cpi_ctx = CpiContext::new_with_signer(
            self.claim_base.token_program.to_account_info(),
            Transfer {
                from: self.vault.to_account_info(),
                to: self.destination.to_account_info(),
                authority: self.claim_base.stake_pool.to_account_info(),
            },
            signer_seeds,
        );
        token::transfer(
            cpi_ctx,
            self.claim_base.stake_deposit_receipt.deposit_amount,
        )
    }

    pub fn burn_stake_weight_tokens_from_owner(&self) -> Result<()> {
        let stake_pool = self.claim_base.stake_pool.load()?;
        let cpi_ctx = CpiContext::new(
            self.claim_base.token_program.to_account_info(),
            Burn {
                mint: self.stake_mint.to_account_info(),
                from: self.from.to_account_info(),
                authority: self.claim_base.owner.to_account_info(),
            },
        );
        let effective_stake_token_amount = StakeDepositReceipt::get_token_amount_from_stake(
            self.claim_base.stake_deposit_receipt.effective_stake_u128(),
            stake_pool.max_weight,
        );
        token::burn(cpi_ctx, effective_stake_token_amount)
    }

    pub fn close_stake_deposit_receipt(&self) -> Result<()> {
        self.claim_base
            .stake_deposit_receipt
            .close(self.claim_base.owner.to_account_info())
    }
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>) -> Result<()> {
    ctx.accounts.validate_stake_pool_and_owner()?;
    ctx.accounts
        .claim_base
        .stake_deposit_receipt
        .validate_unlocked()?;
    {
        let mut stake_pool = ctx.accounts.claim_base.stake_pool.load_mut()?;
        // Recalculate rewards for stake prior, so withdrawing user can receive all rewards
        stake_pool.recalculate_rewards_per_effective_stake(&ctx.remaining_accounts, 2usize)?;
        // Decrement total weighted stake for future deposit reward ownership to be calculated correctly
        let total_staked = stake_pool
            .total_weighted_stake_u128()
            .checked_sub(
                ctx.accounts
                    .claim_base
                    .stake_deposit_receipt
                    .effective_stake_u128(),
            )
            .unwrap();
        stake_pool.total_weighted_stake = u128(total_staked.to_le_bytes());
    }
    ctx.accounts.transfer_staked_tokens_to_owner()?;
    ctx.accounts.burn_stake_weight_tokens_from_owner()?;
    // claim all unclaimed rewards
    let claimed_amounts = ctx
        .accounts
        .claim_base
        .transfer_all_claimable_rewards(&ctx.remaining_accounts)?;

    ctx.accounts
        .claim_base
        .update_reward_pools_last_amount(claimed_amounts)?;

    ctx.accounts.close_stake_deposit_receipt()?;
    Ok(())
}
