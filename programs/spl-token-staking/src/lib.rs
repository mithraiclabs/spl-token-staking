use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod macros;
pub mod math;
pub mod state;

use crate::instructions::*;

declare_id!("STAKEkKzbdeKkqzKpLkNQD3SUuLgshDKCD7U8duxAbB");

#[program]
pub mod spl_token_staking {
    use super::*;

    /// Create a [StakePool](state::StakePool) and initialize the Mint that will
    /// represent effective stake weight.
    pub fn initialize_stake_pool(
        ctx: Context<InitializeStakePool>,
        nonce: u8,
        max_weight: u64,
        min_duration: u64,
        max_duration: u64,
    ) -> Result<()> {
        initialize_stake_pool::handler(
            ctx,
            nonce,
            max_weight,
            min_duration,
            max_duration,
        )
    }

    /// Add a [RewardPool](state::RewardPool) to an existing [StakePool](state::StakePool).
    /// 
    /// Can only be invoked by the StakePool's authority.
    pub fn add_reward_pool(ctx: Context<AddRewardPool>, index: u8) -> Result<()> {
        add_reward_pool::handler(ctx, index)
    }

    /// Deposit (aka Stake) a wallet's tokens to the specified [StakePool](state::StakePool).
    /// Depending on the `lockup_duration` and the StakePool's weighting configuration, the
    /// wallet initiating the deposit will receive tokens representing their effective stake 
    /// (i.e. deposited amount multiplied by the lockup weight).
    /// 
    /// For each RewardPool, the latest amount per effective stake will be recalculated to ensure 
    /// the latest accumulated rewards are attributed to all previous depositors and not the deposit
    /// resulting from this instruction.
    /// 
    /// A [StakeDepositReceipt](state::StakeDepositReceipt) will be created to track the
    /// lockup duration, effective weight, and claimable rewards.
    /// 
    /// Remaining accounts are required: pass the `reward_vault` of each reward pool. These must be
    /// passed in the same order as `StakePool.reward_pools`
    pub fn deposit(
        ctx: Context<Deposit>,
        nonce: u32,
        amount: u64,
        lockup_duration: u64,
    ) -> Result<()> {
        deposit::handler(ctx, nonce, amount, lockup_duration)
    }

    /// Claim unclaimed rewards from all RewardPools for a specific StakeDepositReceipt.
    /// 
    /// For each RewardPool, the latest amount per effective stake will be recalculated to ensure 
    /// the latest accumulated rewards are accounted for in the claimable amount. The StakeDepositReceipt
    /// is also updated so that the latest claimed amount is equivalent, so that their claimable amount
    /// is 0 after invoking the claim instruction. 
    pub fn claim_all<'info>(ctx: Context<'_, '_, '_, 'info, ClaimAll<'info>>) -> Result<()> {
        claim_all::handler(ctx)
    }

    /// Withdraw (aka Unstake) a wallet's tokens for a specific StakeDepositReceipt. The StakePool's
    /// total weighted stake will be decreased by the effective stake amount of the StakeDepositReceipt
    /// and the original amount deposited will be transferred out of the vault.
    /// 
    /// All rewards will be claimed. So, for each RewardPool, the latest amount per effective stake will
    /// be recalculated to ensure the latest accumulated rewards are accounted for in the claimable amount.
    /// The StakeDepositReceipt is also updated so that the latest claimed amount is equivalent, so that
    /// their claimable amount is 0 after invoking the withdraw instruction.
    /// 
    /// StakeDepositReceipt account is closed after this instruction.
    /// 
    /// Remaining accounts are required: pass the `reward_vault` of each reward pool. These must be
    /// passed in the same order as `StakePool.reward_pools`. The owner (the token account which
    /// gains the withdrawn funds) must also be passed be, in pairs like so:
    /// * `<reward_vault[0]><owner[0]>`
    /// * `<reward_vault[1]><owner[1]>
    /// * ...etc
    pub fn withdraw<'info>(ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>) -> Result<()> {
        withdraw::handler(ctx)
    }
}
