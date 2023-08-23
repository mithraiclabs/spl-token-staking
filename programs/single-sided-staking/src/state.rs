use anchor_lang::prelude::*;

/** Maximum number of RewardPools on a StakePool. */
pub const MAX_REWARD_POOLS: usize = 5;

#[derive(Clone, Copy, Default, AnchorDeserialize, AnchorSerialize)]
#[repr(C)]
pub struct RewardPool {
    /** Token Account to store the reward SPL Token */
    pub vault: Pubkey,
    /** Ever increasing accumulator of the amount of rewards per effective stake.
    Said another way, if a user deposited before any rewards were added to the
    `vault`, then this would be the token amount per effective stake they could
    claim. */
    pub rewards_per_effective_stake: u64,
    /** latest amount of tokens in the vault */
    pub last_amount: u64,
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
}