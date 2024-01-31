use anchor_lang::prelude::*;
use anchor_spl::token::TokenAccount;
use bytemuck::{Pod, Zeroable};
use core::primitive;
use jet_proc_macros::assert_size;

use crate::{errors::ErrorCode, math::U192};

// REVIEW: What's the theoretical limit of Reward pools? What's the limiting factor (e.g. CU)?
//  Wondering because a single StakePool could only ever provide 5 different assets as rewards.
//  And spinning up a new StakePool, migrating stake, and changing governance (if integrated)
//  should be considered not feasible.

/// Maximum number of RewardPools on a StakePool.
///
///  * Withdraw requires 8 + 2 x num_reward_pools accounts and no arguments.
///  * (256 accounts per LUT - 8) / 2 = 124 reward pool max from account limits
pub const MAX_REWARD_POOLS: usize = 10;
pub const SCALE_FACTOR_BASE: u64 = 1_000_000_000;
pub const SCALE_FACTOR_BASE_SQUARED: u64 = 1_000_000_000_000_000_000;
pub const SECONDS_PER_DAY: u64 = 60 * 60 * 24;

#[allow(non_camel_case_types)]
/// Definitely not your primitive u128...but Anchor thinks it is...
#[derive(Copy, Clone, Default, Zeroable, AnchorDeserialize, AnchorSerialize, Pod, Debug)]
#[repr(C)]
pub struct u128(pub [u8; 16]);

impl u128 {
    /// Extracts the real u128 from the fake wrapper
    pub fn as_u128(&self) -> primitive::u128 {
        primitive::u128::from_le_bytes(self.0)
    }
}

/// Get the number of digits to shift (aka precision loss) due to potential
/// overflow of all tokens being staked for the max stake weight.
pub fn get_digit_shift_by_max_scalar(max_weight: u64) -> u8 {
    let mut digit_shift = 0u32;
    while primitive::u128::from(max_weight)
        .checked_mul(primitive::u128::from(u64::MAX))
        .unwrap()
        .checked_div(primitive::u128::from(SCALE_FACTOR_BASE))
        .unwrap()
        .checked_div(primitive::u128::pow(10, digit_shift))
        .unwrap()
        .gt(&primitive::u128::from(u64::MAX))
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

    /// Extract the underlying u128 value of `rewards_per_effective_stake`
    pub fn rewards_per_effective_stake_u128(&self) -> primitive::u128 {
        self.rewards_per_effective_stake.as_u128()
    }
}

#[assert_size(1112)]
#[account(zero_copy)]
#[repr(C)]
pub struct StakePool {
    /// The original creator of the StakePool. Necessary for signer seeds
    pub creator: Pubkey,
    /** Pubkey that can make updates to StakePool */
    pub authority: Pubkey,
    /** Total amount staked that accounts for the lock up period weighting.
    Note, this is not equal to the amount of SPL Tokens staked. */
    pub total_weighted_stake: u128,
    /** Token Account to store the staked SPL Token */
    pub vault: Pubkey,
    /** Mint of the token being staked */
    pub mint: Pubkey,
    /** Mint of the token representing effective stake */
    pub stake_mint: Pubkey,
    /// Array of RewardPools that apply to the stake pool.
    /// Unused entries are Pubkey default. In arbitrary order, and may have gaps.
    pub reward_pools: [RewardPool; MAX_REWARD_POOLS],
    /// The minimum weight received for staking. In terms of 1 / SCALE_FACTOR_BASE.
    /// Examples:
    /// * `min_weight = 1 x SCALE_FACTOR_BASE` = minmum of 1x multiplier for > min_duration staking
    /// * `min_weight = 2 x SCALE_FACTOR_BASE` = minmum of 2x multiplier for > min_duration staking
    pub base_weight: u64,
    /// Maximum weight for staking lockup (i.e. weight multiplier when locked
    /// up for max duration). In terms of 1 / SCALE_FACTOR_BASE. Examples:
    /// * A `max_weight = 1 x SCALE_FACTOR_BASE` = 1x multiplier for max staking duration
    /// * A `max_weight = 2 x SCALE_FACTOR_BASE` = 2x multiplier for max staking duration
    pub max_weight: u64,
    /** Minimum duration for lockup. At this point, the staker would receive the base weight. In seconds. */
    pub min_duration: u64,
    /** Maximum duration for lockup. At this point, the staker would receive the max weight. In seconds. */
    pub max_duration: u64,
    /** Nonce to derive multiple stake pools from same mint */
    pub nonce: u8,
    /** Bump seed for stake_mint */
    pub bump_seed: u8,
    // padding to next 8-byte
    _padding0: [u8; 6],
    _reserved0: [u8; 256],
}

impl StakePool {
    pub const LEN: usize = std::mem::size_of::<StakePool>();

    /// Extract the underlying u128 value of `total_weighted_stake`
    pub fn total_weighted_stake_u128(&self) -> primitive::u128 {
        self.total_weighted_stake.as_u128()
    }

    pub fn get_claimed_amounts_of_reward_pools(&self) -> [u128; MAX_REWARD_POOLS] {
        let mut ret = [u128::default(); MAX_REWARD_POOLS];
        for (index, reward_pool) in self.reward_pools.iter().enumerate() {
            ret[index] = reward_pool.rewards_per_effective_stake;
        }
        ret
    }

    /// Update amount of reward each effective stake should receive based on current deposits.
    /// Iterates over reward pools:
    ///   - check for changes in Token Account balance
    ///   - update `rewards_per_effective_stake` based on balance change
    /// <br>
    /// * `remaining_accounts` - The remaining_accounts passed into the instruction
    /// * `reward_vault_account_offset` - The number of accounts to move the cursor/index each
    /// iteration
    pub fn recalculate_rewards_per_effective_stake<'info>(
        &mut self,
        remaining_accounts: &[AccountInfo<'info>],
        reward_vault_account_offset: usize,
    ) -> Result<()> {
        let total_weighted_stake = self.total_weighted_stake_u128();
        if total_weighted_stake == 0 {
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

            if remaining_accounts_index >= remaining_accounts.len() {
                msg!(
                    "Missing at least one reward vault account. Failed at index {:?}",
                    remaining_accounts_index
                );
                return err!(ErrorCode::InvalidRewardPoolVaultIndex);
            }
            let account_info = &remaining_accounts[remaining_accounts_index];

            // assert that the remaining account indexes and reward pool
            // indexes line up.
            if reward_pool.reward_vault != account_info.key() {
                msg!(
                    "expected pool: {:?} but got {:?}",
                    reward_pool.reward_vault,
                    account_info.key()
                );
                return err!(ErrorCode::InvalidRewardPoolVault);
            }

            let token_account: Account<'info, TokenAccount> =
                Account::try_from(&account_info).map_err(|_| ErrorCode::InvalidRewardPoolVault)?;
            remaining_accounts_index += reward_vault_account_offset;

            if reward_pool.last_amount == token_account.amount {
                // no change in token account balance, can skip update
                continue;
            }

            let balance_diff = primitive::u128::from(
                token_account
                    .amount
                    .checked_sub(reward_pool.last_amount)
                    .unwrap(),
            );

            // Scaled balance diff is scaled by SCALE_FACTOR_BASE squared because
            //  total_weighted_stake is shifted by SCALE_FACTOR_BASE and this
            //  avoids precision loss in the later division.
            // Note: Cannot overflow because (u64::MAX * 10 ^ 18) < 2^128
            let scaled_balance_diff = balance_diff
                .checked_mul(primitive::u128::from(SCALE_FACTOR_BASE_SQUARED))
                .unwrap();

            let additional_rewards_per_effective_stake = scaled_balance_diff
                .checked_div(total_weighted_stake)
                .unwrap();

            reward_pool.last_amount = token_account.amount;
            let rewards_updated = reward_pool
                .rewards_per_effective_stake_u128()
                .checked_add(additional_rewards_per_effective_stake)
                .unwrap();

            reward_pool.rewards_per_effective_stake = u128(rewards_updated.to_le_bytes());
        }
        Ok(())
    }

    /// Calculate the stake weight based on a given duration for the current StakePool
    pub fn get_stake_weight(&self, duration: u64) -> u64 {
        if duration < self.min_duration {
            panic!("Unreachable: the lockup is less than the minimum allowed")
        }

        let duration_span = self.max_duration.checked_sub(self.min_duration).unwrap();
        if duration_span == 0 {
            return self.base_weight;
        }

        let duration_exceeding_min = u64::min(
            duration.checked_sub(self.min_duration).unwrap(),
            duration_span,
        );
        //weight = BaseWeight + (NormalizedWeight * (MaxWeight - BaseWeight)

        // The multiplier on a scale of 0 - 1 (aka SCALE_FACTOR_BASE), based on where the duration falls
        // on the line of min - max duration.
        let normalized_weight = U192::from(duration_exceeding_min)
            // must scale to account for decimals
            .checked_mul(U192::from(SCALE_FACTOR_BASE))
            .unwrap()
            .checked_div(U192::from(duration_span))
            .unwrap();
        let weight_diff = U192::from(self.max_weight)
            .checked_sub(U192::from(self.base_weight))
            .unwrap();
        let calculated_weight = U192::from(self.base_weight)
            .checked_add(
                normalized_weight
                    .checked_mul(weight_diff)
                    .unwrap()
                    .checked_div(U192::from(SCALE_FACTOR_BASE))
                    .unwrap(),
            )
            .unwrap();

        u64::max(calculated_weight.as_u64(), self.base_weight)
    }
}

#[account]
pub struct StakeDepositReceipt {
    /** Pubkey that owns the staked assets */
    pub owner: Pubkey,
    /** Pubkey that paid for the deposit */
    pub payer: Pubkey,
    /** StakePool the deposit is for */
    pub stake_pool: Pubkey,
    /** Duration of the lockup period in seconds */
    pub lockup_duration: u64,
    /** Timestamp in seconds of when the stake lockup began */
    pub deposit_timestamp: i64,
    /** Amount of SPL token deposited */
    pub deposit_amount: u64,
    /** Amount of stake weighted by lockup duration. */
    pub effective_stake: u128,
    /// The amount per reward that has been claimed or perceived to be claimed. Indexes align with
    /// the StakedPool reward_pools property.
    pub claimed_amounts: [u128; MAX_REWARD_POOLS],
}

impl StakeDepositReceipt {
    pub const LEN: usize = std::mem::size_of::<StakeDepositReceipt>();

    pub fn effective_stake_u128(&self) -> primitive::u128 {
        self.effective_stake.as_u128()
    }

    pub fn claimed_amounts_u128(&self) -> [primitive::u128; MAX_REWARD_POOLS] {
        let mut claimed: [primitive::u128; MAX_REWARD_POOLS] = Default::default();
        for (index, value) in self.claimed_amounts.iter().enumerate() {
            claimed[index] = value.as_u128();
        }
        claimed
    }

    /// Amount staked multiplied by weight
    pub fn get_effective_stake_amount(weight: u64, amount: u64) -> primitive::u128 {
        primitive::u128::from(amount)
            .checked_mul(primitive::u128::from(weight))
            .unwrap()
    }

    /// Effective stake converted to u64 token amount
    pub fn get_token_amount_from_stake(effective_stake: primitive::u128, max_weight: u64) -> u64 {
        let digit_shift = get_digit_shift_by_max_scalar(max_weight);
        effective_stake
            .checked_div(primitive::u128::from(SCALE_FACTOR_BASE))
            .unwrap()
            .checked_div(10u128.pow(digit_shift.into()))
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

#[cfg(test)]
mod tests {
    use super::*;

    /// Creates a StakePool that is zeroed other than the given values
    fn mock_stakepool(
        base_weight: u64,
        max_weight: u64,
        min_duration: u64,
        max_duration: u64,
    ) -> StakePool {
        let mut pool = StakePool::zeroed();
        pool.base_weight = base_weight;
        pool.max_weight = max_weight;
        pool.min_duration = min_duration;
        pool.max_duration = max_duration;
        pool
    }

    /// A pool with base weight 1 (* scale), max weight 2 (* scale), min duration 100, max duration 200
    fn generic_stakepool() -> StakePool {
        let base_weight = 1 * SCALE_FACTOR_BASE;
        let max_weight = 2 * SCALE_FACTOR_BASE;
        let min_duration = 100;
        let max_duration = 200;

        mock_stakepool(base_weight, max_weight, min_duration, max_duration)
    }

    #[test]
    #[should_panic(expected = "Unreachable: the lockup is less than the minimum allowed")]
    fn get_stake_weight_duration_less_than_min() {
        let stake_pool = generic_stakepool();
        let min_duration = stake_pool.min_duration;
        stake_pool.get_stake_weight(min_duration - 1);
    }

    #[test]
    fn get_stake_weight_duration_equal_min() {
        let stake_pool = generic_stakepool();
        let base_weight = stake_pool.base_weight;
        let min_duration = stake_pool.min_duration;
        assert_eq!(stake_pool.get_stake_weight(min_duration), base_weight);
    }

    #[test]
    fn get_stake_weight_duration_midpoint() {
        let stake_pool = generic_stakepool();
        let base_weight = stake_pool.base_weight;
        let max_weight = stake_pool.max_weight;
        let min_duration = stake_pool.min_duration;
        let max_duration = stake_pool.max_duration;
        let mid_duration = (min_duration + max_duration) / 2;
        // mid = 150. span = (150 - 100) / (200 - 100) = 50 / 100 = .5
        // I.e. the weight should be exactly halfway between base and max.
        assert_eq!(
            stake_pool.get_stake_weight(mid_duration),
            (base_weight + max_weight) / 2
        );
    }

    #[test]
    fn get_stake_weight_duration_equal_max() {
        let stake_pool = generic_stakepool();
        let max_weight = stake_pool.max_weight;
        let max_duration = stake_pool.max_duration;
        assert_eq!(stake_pool.get_stake_weight(max_duration), max_weight);
    }

    #[test]
    fn get_stake_weight_duration_greater_than_max() {
        let stake_pool = generic_stakepool();
        let max_weight = stake_pool.max_weight;
        let max_duration = stake_pool.max_duration;
        assert_eq!(stake_pool.get_stake_weight(max_duration + 1), max_weight);
    }

    // A badly configured pool where the min duration = max duration.
    #[test]
    fn get_stake_weight_min_duration_equals_max() {
        let mut stake_pool = generic_stakepool();
        stake_pool.max_duration = stake_pool.min_duration;
        let base_weight = stake_pool.base_weight;
        let max_duration = stake_pool.max_duration;
        assert_eq!(stake_pool.get_stake_weight(max_duration + 1), base_weight);
    }

}
