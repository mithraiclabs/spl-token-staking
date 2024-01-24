use std::mem::size_of;

use anchor_lang::prelude::*;

use crate::{
    state::{Registrar, StakePool},
    VoterWeightRecord,
};

#[derive(Accounts)]
pub struct CreateVoterWeightRecord<'info> {
    /// Payer of rent
    #[account(mut)]
    pub payer: Signer<'info>,

    /// Owner of the VoterStakeRecord and the subsequent StakeDepositReceipts
    /// CHECK: No check needed, but this owner will be checked against owner of StakeDepositReceipt
    pub owner: UncheckedAccount<'info>,

    /// Registrar for the applicable realm
    pub registrar: AccountLoader<'info, Registrar>,

    /// StakePool the VoterWeightRecord will be associated with.
    pub stake_pool: AccountLoader<'info, StakePool>,

    #[account(
      init,
      seeds = [
        registrar.key().as_ref(),
        stake_pool.key().as_ref(),
        owner.key().as_ref(),
        b"voterWeightRecord".as_ref()
      ],
      bump,
      payer = payer,
      space = size_of::<VoterWeightRecord>(),
    )]
    pub voter_weight_record: Account<'info, VoterWeightRecord>,

    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateVoterWeightRecord>) -> Result<()> {
    let voter_weight_record = &mut ctx.accounts.voter_weight_record;
    let registrar = ctx.accounts.registrar.load()?;
    voter_weight_record.realm = registrar.realm;
    voter_weight_record.governing_token_mint = registrar.realm_governing_token_mint;
    voter_weight_record.governing_token_owner = ctx.accounts.owner.key();

    Ok(())
}
