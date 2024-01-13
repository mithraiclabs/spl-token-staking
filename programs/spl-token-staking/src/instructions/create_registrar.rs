use anchor_lang::prelude::*;
use anchor_spl::token::Mint;
use std::mem::size_of;

use crate::state::Registrar;

#[derive(Accounts)]
pub struct CreateRegistrar<'info> {
    // pays for rent
    #[account(mut)]
    pub payer: Signer<'info>,

    /// The voting registrar. There can only be a single registrar
    /// per governance realm and governing mint.
    #[account(
      init,
      seeds = [realm.key().as_ref(), realm_governing_token_mint.key().as_ref(), b"registrar".as_ref()],
      bump,
      payer = payer,
      space = 8 + size_of::<Registrar>()
    )]
    pub registrar: AccountLoader<'info, Registrar>,
    /// An spl-governance realm
    ///
    /// CHECK: realm is validated in the instruction:
    /// - realm is owned by the governance_program_id
    /// - realm_governing_token_mint must be the community or council mint
    /// - realm_authority is realm.authority
    pub realm: UncheckedAccount<'info>,

    /// CHECK: May be any instance of spl-governance
    /// The program id of the spl-governance program the realm belongs to.
    pub governance_program_id: UncheckedAccount<'info>,
    /// Either the realm community mint or the council mint.
    pub realm_governing_token_mint: Account<'info, Mint>,
    pub realm_authority: Signer<'info>,

    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

/// Creates a new voting registrar.
pub fn handler(ctx: Context<CreateRegistrar>, registrar_bump: u8) -> Result<()> {
    let registrar = &mut ctx.accounts.registrar.load_init()?;
    require_eq!(registrar_bump, *ctx.bumps.get("registrar").unwrap());
    registrar.bump = registrar_bump;
    registrar.governance_program_id = ctx.accounts.governance_program_id.key();
    registrar.realm = ctx.accounts.realm.key();
    registrar.realm_governing_token_mint = ctx.accounts.realm_governing_token_mint.key();
    registrar.realm_authority = ctx.accounts.realm_authority.key();

    Ok(())
}
