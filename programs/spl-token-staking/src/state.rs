use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use bytemuck::{Pod, Zeroable};
use jet_proc_macros::assert_size;

use crate::errors::ErrorCode;

/** Maximum number of RewardPools on a StakePool. */
pub const MAX_REWARD_POOLS: usize = 5;
pub const SCALE_FACTOR_BASE: u64 = 1_000_000_000;
pub const SECONDS_PER_DAY: u64 = 60 * 60 * 24;

/// Get the number of digits to shift (aka precision loss) due to potential
/// overflow of all tokens being staked for the max stake weight.
pub fn get_digit_shift_by_max_scalar(max_weight: u64) -> u8 {
    let mut digit_shift = 0u32;
    while u128::from(max_weight)
        .checked_mul(u128::from(u64::MAX))
        .unwrap()
        .checked_div(u128::from(SCALE_FACTOR_BASE))
        .unwrap()
        .checked_div(u128::pow(10, digit_shift))
        .unwrap()
        .gt(&u128::from(u64::MAX))
    {
        digit_shift += 1;
    }
    digit_shift.try_into().unwrap()
}

#[assert_size(64)]
#[derive(Clone, Copy, Default, AnchorDeserialize, AnchorSerialize, Pod, Zeroable)]
#[repr(C)]
pub struct RewardPool {
    /** Token Account to store the reward SPL Token */
    pub reward_vault: Pubkey,
    /** Ever increasing accumulator of the amount of rewards per effective stake.
    Said another way, if a user deposited before any rewards were added to the
    `vault`, then this would be the token amount per effective stake they could
    claim. */
    pub rewards_per_effective_stake: u128,
    /** latest amount of tokens in the vault */
    pub last_amount: u64,
    _padding0: [u8; 8],
}

impl RewardPool {
    pub fn is_empty(&self) -> bool {
        self.reward_vault == Pubkey::default()
    }

    pub fn new(reward_vault: &Pubkey) -> Self {
        let mut res = Self::default();
        res.reward_vault = *reward_vault;
        res
    }
}

#[assert_size(480)]
#[account(zero_copy)]
#[repr(C)]
pub struct StakePool {
    /** Pubkey that can make updates to StakePool */
    pub authority: Pubkey,
    /** Total amount staked that accounts for the lock up period weighting.
    Note, this is not equal to the amount of SPL Tokens staked. */
    pub total_weighted_stake: u128,
    /** Token Account to store the staked SPL Token */
    pub vault: Pubkey,
    /** Mint of the token representing effective stake */
    pub stake_mint: Pubkey,
    /** Array of RewardPools that apply to the stake pool */
    pub reward_pools: [RewardPool; MAX_REWARD_POOLS],
    /** Base weight for staking lockup. In terms of 1 / SCALE_FACTOR_BASE */
    pub base_weight: u64,
    /** Maximum weight for staking lockup (i.e. weight multiplier when locked up for max duration). In terms of 1 / SCALE_FACTOR_BASE */
    pub max_weight: u64,
    /** Minimum duration for lockup. At this point, the staker would receive the base weight. */
    pub min_duration: u64,
    /** Maximum duration for lockup. At this point, the staker would receive the max weight. */
    pub max_duration: u64,
    /** Nonce to derive multiple stake pools from same mint */
    pub nonce: u8,
    /** Bump seed for stake_mint */
    pub bump_seed: u8,
    _padding0: [u8; 14],
}

impl StakePool {
    pub const LEN: usize = std::mem::size_of::<StakePool>();

    pub fn get_claimed_amounts_of_reward_pools(&self) -> [u128; MAX_REWARD_POOLS] {
        let mut ret = [0u128; MAX_REWARD_POOLS];
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
        reward_vault_account_offset: usize,
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
            remaining_accounts_index += reward_vault_account_offset;

            if reward_pool.last_amount == token_account.amount {
                // no change in token account balance, can skip update
                continue;
            }

            let balance_diff = u128::from(
                token_account
                    .amount
                    .checked_sub(reward_pool.last_amount)
                    .unwrap(),
            );
            let scaled_balance_diff = balance_diff
                .checked_mul(u128::from(SCALE_FACTOR_BASE))
                .unwrap()
                .checked_mul(u128::from(SCALE_FACTOR_BASE))
                .unwrap();

            let additional_rewards_per_effective_stake = scaled_balance_diff
                .checked_div(self.total_weighted_stake)
                .unwrap();

            reward_pool.last_amount = token_account.amount;
            reward_pool.rewards_per_effective_stake = reward_pool
                .rewards_per_effective_stake
                .checked_add(additional_rewards_per_effective_stake)
                .unwrap();
        }
        Ok(())
    }

    /// Calculate the stake weight based on a given duration for the current StakePool
    pub fn get_stake_weight(&self, duration: u64) -> u64 {
        let duration_span = self.max_duration.checked_sub(self.min_duration).unwrap();
        let duration_exceeding_min = duration.checked_sub(self.min_duration).unwrap();
        let scaled_duration_ratio = duration_exceeding_min
            // must scale to account for decimals
            .checked_mul(SCALE_FACTOR_BASE)
            .unwrap()
            .checked_div(duration_span)
            .unwrap();
        let calculated_weight = scaled_duration_ratio
            .checked_mul(self.max_weight)
            .unwrap()
            .checked_div(SCALE_FACTOR_BASE)
            .unwrap();

        u64::max(calculated_weight, self.base_weight)
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
    pub effective_stake: u128,
    /** The amount per reward that has been claimed or perceived to be claimed.
    Indexes align with the StakedPool reward_pools property. */
    pub claimed_amounts: [u128; MAX_REWARD_POOLS],
}

impl StakeDepositReceipt {
    pub const LEN: usize = std::mem::size_of::<StakeDepositReceipt>();

    /// Amount staked multiplied by weight
    pub fn get_effective_stake_amount(weight: u64, amount: u64) -> u128 {
        u128::from(amount).checked_mul(u128::from(weight)).unwrap()
    }

    /// Effective stake converted to u64 token amount
    pub fn get_token_amount_from_stake(effective_stake: u128, max_weight: u64) -> u64 {
        let digit_shift = get_digit_shift_by_max_scalar(max_weight);
        effective_stake
            .checked_div(u128::from(SCALE_FACTOR_BASE))
            .unwrap()
            .checked_div(u128::from(10u8.pow(digit_shift.into())))
            .unwrap()
            .try_into()
            .unwrap()
    }

    /// Throw error if the StakeDepositReceipt is still locked
    pub fn validate_unlocked(&self) -> Result<()> {
        let current_timestamp = Clock::get()?.unix_timestamp;
        if current_timestamp
            < self
                .deposit_timestamp
                .checked_add(self.lockup_duration.try_into().unwrap())
                .unwrap()
        {
            return Err(ErrorCode::StakeStillLocked.into());
        }
        Ok(())
    }
}
