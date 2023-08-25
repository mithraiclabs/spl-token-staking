use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;

use crate::errors::ErrorCode;

/** Maximum number of RewardPools on a StakePool. */
pub const MAX_REWARD_POOLS: usize = 5;

#[derive(Clone, Copy, Default, AnchorDeserialize, AnchorSerialize)]
#[repr(C)]
pub struct RewardPool {
    /** Token Account to store the reward SPL Token */
    pub reward_vault: Pubkey,
    /** Ever increasing accumulator of the amount of rewards per effective stake.
    Said another way, if a user deposited before any rewards were added to the
    `vault`, then this would be the token amount per effective stake they could
    claim. */
    pub rewards_per_effective_stake: u64,
    /** latest amount of tokens in the vault */
    pub last_amount: u64,
}

impl RewardPool {
    pub fn is_empty(&self) -> bool {
        self.reward_vault == Pubkey::default()
    }
}

#[account]
pub struct StakePool {
    /** Pubkey that can make updates to StakePool */
    pub authority: Pubkey,
    /** Since the amount of weighted stake can exceed a u64 if the max integer of
    SPL Token amount were deposited and lockedup, we must account for overflow by
    losing some precision. The StakePool authority can set this precision */
    pub digit_shift: i8,
    /** Total amount staked that accounts for the lock up period weighting.
    Note, this is not equal to the amount of SPL Tokens staked. */
    pub total_weighted_stake: u64,
    /** Token Account to store the staked SPL Token */
    pub vault: Pubkey,
    /** Mint of the token representing effective stake */
    pub stake_mint: Pubkey,
    /** Array of RewardPools that apply to the stake pool */
    pub reward_pools: [RewardPool; MAX_REWARD_POOLS],
}

impl StakePool {
    pub const LEN: usize = 352;

    pub fn get_claimed_amounts_of_reward_pools(&self) -> [u64; MAX_REWARD_POOLS] {
        let mut ret = [0u64; MAX_REWARD_POOLS];
        for (index, reward_pool) in self.reward_pools.iter().enumerate() {
            ret[index] = reward_pool.rewards_per_effective_stake
        }
        ret
    }

    /// Update amount of reward each effective stake should receive based on current deposits.
    /// Iterate over reward pools:
    ///   - check for changes in Token Account balance
    ///   - update `rewards_per_effective_stake` based on balance change
    pub fn recalculate_rewards_per_effective_stake<'info>(
        &mut self,
        remaining_accounts: &[AccountInfo<'info>],
    ) -> Result<()> {
        if self.total_weighted_stake == 0 {
            // do nothing if total stake is 0. This will allow the first
            // depositor to collect all of the rewards accumulated thus far.
            return Ok(());
        }

        let mut remaining_accounts_index: usize = 0;
        for reward_pool in &mut self.reward_pools {
            // skip when reward pool is not initialized
            if reward_pool.is_empty() {
                continue;
            }

            
            let account_info = &remaining_accounts[remaining_accounts_index];

            // assert that the remaining account indexes and reward pool
            // indexes line up.
            if reward_pool.reward_vault != account_info.key() {
                return Err(ErrorCode::InvalidRewardPoolVaultIndex.into());
            }

            let token_account: Account<'info, TokenAccount> =
                Account::try_from(&account_info).map_err(|_| ErrorCode::InvalidRewardPoolVault)?;
            remaining_accounts_index += 1;
            

            if reward_pool.last_amount == token_account.amount {
                // no change in token account balance, can skip update
                continue;
            }

            // TODO handle precision issues with accumulation and weight scaling.
            let balance_diff = token_account
                .amount
                .checked_sub(reward_pool.last_amount)
                .ok_or(ErrorCode::ArithmeticError)?;

            let additional_rewards_per_effective_stake = balance_diff
                .checked_div(self.total_weighted_stake)
                .ok_or(ErrorCode::ArithmeticError)?;

            reward_pool.last_amount = token_account.amount;
            reward_pool.rewards_per_effective_stake = reward_pool
                .rewards_per_effective_stake
                .checked_add(additional_rewards_per_effective_stake)
                .ok_or(ErrorCode::ArithmeticError)?;
        }
        Ok(())
    }
}

#[account]
pub struct StakeDepositReceipt {
    /** Pubkey that created the deposit */
    pub owner: Pubkey,
    /** StakePool the deposit is for */
    pub stake_pool: Pubkey,
    /** Duration of the lockup period in seconds */
    pub lockup_duration: u64,
    /** Timestamp in seconds of when the stake lockup began */
    pub deposit_timestamp: i64,
    /** Amount of SPL token deposited */
    pub deposit_amount: u64,
    /** Amount of stake weighted by lockup duration */
    pub effective_stake: u64,
    /** The amount per reward that has been claimed or perceived to be claimed.
    Indexes align with the StakedPool reward_pools property. */
    pub claimed_amounts: [u64; MAX_REWARD_POOLS],
}

impl StakeDepositReceipt {
    pub const LEN: usize = 136;
}
