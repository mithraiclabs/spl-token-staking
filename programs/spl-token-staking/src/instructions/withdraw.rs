use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};
use anchor_spl::token_2022::{self, Token2022, TransferChecked};
use anchor_spl::token_interface::{Mint as MintInterface, TokenAccount as TokenAccountInterface};

use crate::{
    errors::ErrorCode,
    stake_pool_signer_seeds,
    state::{StakeDepositReceipt, VoterWeightRecord},
};

use super::claim_base::*;
use crate::state::u128;

#[derive(Accounts)]
pub struct Withdraw<'info> {
    pub claim_base: ClaimBase<'info>,

    /// Vault of the StakePool token will be transferred from
    #[account(mut)]
    pub vault: InterfaceAccount<'info, TokenAccountInterface>,

    #[account(
        mut,
        // Must enforce the VWR and StakeReceipt owner are the same. This enforces VWR as an accumulator for the
        // owner's total stake weight for the stake_pool.
        seeds = [
            claim_base.stake_pool.key().as_ref(),
            claim_base.owner.key().as_ref(),
            b"voterWeightRecord".as_ref()
        ],
        bump,
        constraint = claim_base.stake_deposit_receipt.owner.key() == voter_weight_record.governing_token_owner @ ErrorCode::InvalidOwner,
    )]
    pub voter_weight_record: Account<'info, VoterWeightRecord>,

    /// Token account to transfer the previously staked token to
    #[account(mut)]
    pub destination: InterfaceAccount<'info, TokenAccountInterface>,

    // TODO could put a has_one on this but it would fail on transfer anyways if bad.
    /// Staking pool's mint
    pub mint: InterfaceAccount<'info, MintInterface>,
}

impl<'info> Withdraw<'info> {
    /// Addiditional validations that rely on the accounts within `claim_base`.
    pub fn validate_stake_pool_and_owner(&self) -> Result<()> {
        let stake_pool = self.claim_base.stake_pool.load()?;
        require!(
            stake_pool.vault.key() == self.vault.key(),
            ErrorCode::InvalidStakePoolVault
        );
        Ok(())
    }
    /// Transfer the owner's previously staked tokens back.
    pub fn transfer_staked_tokens_to_owner(&self) -> Result<()> {
        let stake_pool = self.claim_base.stake_pool.load()?;
        let signer_seeds: &[&[&[u8]]] = &[stake_pool_signer_seeds!(stake_pool)];
        if self.mint.to_account_info().owner.eq(&Token2022::id()) {
            let cpi_ctx = CpiContext::new_with_signer(
                self.claim_base.token_program.to_account_info(),
                TransferChecked {
                    from: self.vault.to_account_info(),
                    to: self.destination.to_account_info(),
                    mint: self.mint.to_account_info(),
                    authority: self.claim_base.stake_pool.to_account_info(),
                },
                signer_seeds,
            );
            token_2022::transfer_checked(
                cpi_ctx,
                self.claim_base.stake_deposit_receipt.deposit_amount,
                self.mint.decimals,
            )
        } else {
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
    }

    pub fn close_stake_deposit_receipt(&self) -> Result<()> {
        self.claim_base
            .stake_deposit_receipt
            .close(self.claim_base.owner.to_account_info())
    }
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, Withdraw<'info>>) -> Result<()> {
    ctx.accounts.validate_stake_pool_and_owner()?;
    ctx.accounts
        .claim_base
        .stake_deposit_receipt
        .validate_unlocked()?;
    {
        let mut stake_pool = ctx.accounts.claim_base.stake_pool.load_mut()?;
        // Recalculate rewards for stake prior, so withdrawing user can receive all rewards
        let step = if ctx.accounts.claim_base.token_program.key() == Token2022::id() {
            3usize
        } else {
            2usize
        };
        stake_pool.recalculate_rewards_per_effective_stake(&ctx.remaining_accounts, step)?;
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
        // Decrement from VWR same amount of effective stake from StakeDepositReceipt
        let effective_stake_u64 = StakeDepositReceipt::get_token_amount_from_stake(
            ctx.accounts
                .claim_base
                .stake_deposit_receipt
                .effective_stake_u128(),
            stake_pool.max_weight,
        );
        let voter_weight_record = &mut ctx.accounts.voter_weight_record;
        voter_weight_record.voter_weight = voter_weight_record
            .voter_weight
            .checked_sub(effective_stake_u64)
            .unwrap();
    }
    ctx.accounts.transfer_staked_tokens_to_owner()?;
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
