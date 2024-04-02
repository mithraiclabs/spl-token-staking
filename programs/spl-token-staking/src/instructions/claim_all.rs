use anchor_lang::prelude::*;
use anchor_spl::token_2022::Token2022;

use super::claim_base::*;

#[derive(Accounts)]
pub struct ClaimAll<'info> {
    pub claim_base: ClaimBase<'info>,
}

pub fn handler<'info>(ctx: Context<'_, '_, 'info, 'info, ClaimAll<'info>>) -> Result<()> {
    {
        let mut stake_pool = ctx.accounts.claim_base.stake_pool.load_mut()?;
        let step = if ctx.accounts.claim_base.token_program.key() == Token2022::id() {
            2usize
        } else {
            3usize
        };
        stake_pool.recalculate_rewards_per_effective_stake(&ctx.remaining_accounts, step)?;
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
