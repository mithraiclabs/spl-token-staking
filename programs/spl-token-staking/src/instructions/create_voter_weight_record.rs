use anchor_lang::prelude::*;
use std::mem::size_of;

use crate::{
    errors::ErrorCode,
    state::{Registrar, StakePool, VoterWeightRecord},
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
    pub registrar: Option<AccountLoader<'info, Registrar>>,

    /// StakePool the VoterWeightRecord will be associated with.
    pub stake_pool: AccountLoader<'info, StakePool>,

    #[account(
      init,
      seeds = [
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
    let stake_pool = ctx.accounts.stake_pool.load()?;

    if ctx.accounts.registrar.is_some() {
        // A registrar is being used, therefore we include the SPL-Governance
        // related properties of the VoterWeighRecord
        let registrar_loader = ctx.accounts.registrar.clone().unwrap();

        if registrar_loader.key() != stake_pool.registrar {
            return err!(ErrorCode::InvalidRegistrar);
        }

        let registrar = registrar_loader.load()?;
        voter_weight_record.realm = registrar.realm;
        voter_weight_record.governing_token_mint = registrar.realm_governing_token_mint;
    } else if stake_pool.registrar != Pubkey::default() {
        // This check is necessary to prevent VoterWeightRecords without Realm info after
        // the StakePool has been setup for SPL-Governance.
        return err!(ErrorCode::StakePoolRegistrarMismatch);
    }

    voter_weight_record.account_discriminator =
        spl_governance_addin_api::voter_weight::VoterWeightRecord::ACCOUNT_DISCRIMINATOR;
    voter_weight_record.governing_token_owner = ctx.accounts.owner.key();

    Ok(())
}
