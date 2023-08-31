use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, Transfer};

use crate::errors::ErrorCode;
use crate::state::{StakeDepositReceipt, StakePool, MAX_REWARD_POOLS, SCALE_FACTOR_BASE};

#[derive(Accounts)]
pub struct ClaimAll<'info> {
    /// Payer and owner of the StakeDepositReceipt
    #[account(mut)]
    pub owner: Signer<'info>,

    // StakePool the StakeDepositReceipt belongs to
    #[account(mut)]
    pub stake_pool: AccountLoader<'info, StakePool>,

    /// StakeDepositReceipt of the owner that will be used to claim respective rewards
    #[account(
      mut,
      has_one = owner @ ErrorCode::InvalidOwner,
      has_one = stake_pool  @ ErrorCode::InvalidStakePool,
    )]
    pub stake_deposit_receipt: Account<'info, StakeDepositReceipt>,

    pub token_program: Program<'info, Token>,
}

impl<'info> ClaimAll<'info> {
    /// Transfer tokens from a RewardPool to the StakeDepositReceipt owner that is claiming.
    pub fn transfer_reward_from_pool_to_owner(
        &self,
        reward_vault_info: AccountInfo<'info>,
        owner_reward_account_info: AccountInfo<'info>,
        amount: u64,
    ) -> Result<()> {
        let stake_pool = self.stake_pool.load()?;
        let cpi_accounts = Transfer {
            from: reward_vault_info,
            to: owner_reward_account_info,
            authority: self.stake_pool.to_account_info(),
        };
        let stake_pool_signer_seeds: &[&[&[u8]]] = &[&[
            &[stake_pool.nonce],
            &stake_pool.authority.to_bytes(),
            b"stakePool",
            &[stake_pool.bump_seed],
        ]];
        let cpi_ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            cpi_accounts,
            stake_pool_signer_seeds,
        );
        token::transfer(cpi_ctx, amount)
    }

    /// Iterated over reward pools to calculate amount claimable from each and
    /// transfer to the owner of the StakeDepositReceipt.
    pub fn transfer_all_claimable_rewards(
        &self,
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<[u64; MAX_REWARD_POOLS]> {
        let stake_pool = self.stake_pool.load()?;
        let mut remaining_accounts_index: usize = 0;
        let mut claimed_amounts = [0u64; MAX_REWARD_POOLS];
        for (index, reward_pool) in stake_pool.reward_pools.iter().enumerate() {
            if reward_pool.is_empty() {
                continue;
            }
            // indexes for the relevant remaining accounts
            let reward_vault_account_index = remaining_accounts_index * 2;
            let owner_account_index = reward_vault_account_index + 1;

            let claimable_per_effective_stake = reward_pool
                .rewards_per_effective_stake
                .checked_sub(self.stake_deposit_receipt.claimed_amounts[index])
                .unwrap();
            let total_claimable = claimable_per_effective_stake
                .checked_mul(self.stake_deposit_receipt.effective_stake)
                .unwrap()
                .checked_div(u128::from(SCALE_FACTOR_BASE))
                .unwrap()
                .checked_div(u128::from(SCALE_FACTOR_BASE))
                .unwrap()
                .try_into()
                .map_err(|_| ErrorCode::PrecisionMath)?;

            if total_claimable == 0 {
                continue;
            }

            let reward_vault_info = &remaining_accounts[reward_vault_account_index];
            let owner_reward_account_info = &remaining_accounts[owner_account_index];

            self.transfer_reward_from_pool_to_owner(
                reward_vault_info.to_account_info(),
                owner_reward_account_info.to_account_info(),
                total_claimable,
            )?;

            claimed_amounts[index] = total_claimable;

            remaining_accounts_index += 1;
        }
        Ok(claimed_amounts)
    }

    /// Decrement `last_amount` for all RewardPools that had tokens transferred.
    pub fn update_reward_pools_last_amount(
        &mut self,
        claimed_amounts: [u64; MAX_REWARD_POOLS],
    ) -> Result<()> {
        let mut stake_pool = self.stake_pool.load_mut()?;
        for (index, reward_pool) in stake_pool.reward_pools.iter_mut().enumerate() {
            if reward_pool.is_empty() {
                continue;
            }
            let claimed = claimed_amounts[index];
            reward_pool.last_amount = reward_pool.last_amount.checked_sub(claimed).unwrap();
            self.stake_deposit_receipt.claimed_amounts[index] =
                reward_pool.rewards_per_effective_stake;
        }
        Ok(())
    }
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, ClaimAll<'info>>) -> Result<()> {
    {
        let mut stake_pool = ctx.accounts.stake_pool.load_mut()?;
        stake_pool.recalculate_rewards_per_effective_stake(&ctx.remaining_accounts, 2usize)?;
    }

    let claimed_amounts = ctx
        .accounts
        .transfer_all_claimable_rewards(&ctx.remaining_accounts)?;

    ctx.accounts
        .update_reward_pools_last_amount(claimed_amounts)?;

    Ok(())
}
