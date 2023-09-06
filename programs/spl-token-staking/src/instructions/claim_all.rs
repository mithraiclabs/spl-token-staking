use anchor_lang::prelude::*;

use super::claim_base::*;

#[derive(Accounts)]
pub struct ClaimAll<'info> {
    pub claim_base: ClaimBase<'info>,
}

pub fn handler<'info>(ctx: Context<'_, '_, '_, 'info, ClaimAll<'info>>) -> Result<()> {
    {
        let mut stake_pool = ctx.accounts.claim_base.stake_pool.load_mut()?;
        stake_pool.recalculate_rewards_per_effective_stake(&ctx.remaining_accounts, 2usize)?;
    }

    let claimed_amounts = ctx
        .accounts
        .claim_base
        .transfer_all_claimable_rewards(&ctx.remaining_accounts)?;

    ctx.accounts
        .claim_base
        .update_reward_pools_last_amount(claimed_amounts)?;

    Ok(())
}
