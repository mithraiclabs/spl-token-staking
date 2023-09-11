use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use crate::instructions::*;

declare_id!("H1vqoH6vhwQ4WmFYa4rWC6rnVGNwPJMdiWNNqZDQBcNc");

#[program]
pub mod spl_token_staking {
    use super::*;

    pub fn initialize_stake_pool(
        ctx: Context<InitializeStakePool>,
        nonce: u8,
        base_weight: u64,
        max_weight: u64,
        min_duration: u64,
        max_duration: u64,
    ) -> Result<()> {
        initialize_stake_pool::handler(
            ctx,
            nonce,
            base_weight,
            max_weight,
            min_duration,
            max_duration,
        )
    }

    pub fn add_reward_pool(ctx: Context<AddRewardPool>, index: u8) -> Result<()> {
        add_reward_pool::handler(ctx, index)
    }

    pub fn deposit(
        ctx: Context<Deposit>,
        nonce: u32,
        amount: u64,
        lockup_duration: u64,
    ) -> Result<()> {
        deposit::handler(ctx, nonce, amount, lockup_duration)
    }

    pub fn claim_all<'info>(ctx: Context<'_, '_, '_, 'info, ClaimAll<'info>>) -> Result<()> {
        claim_all::handler(ctx)
    }

    pub fn withdraw<'info>(ctx: Context<'_, '_, '_, 'info, Withdraw<'info>>) -> Result<()> {
        withdraw::handler(ctx)
    }
}
