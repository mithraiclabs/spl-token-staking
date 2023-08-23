use anchor_lang::prelude::*;

pub mod instructions;
pub mod state;

use crate::instructions::*;

declare_id!("8amutinnwkwN4PuysoSGeRgR9bhhN4waGEx2BSqBDQb4");

#[program]
pub mod single_sided_staking {
    use super::*;

    pub fn initialize_stake_pool(ctx: Context<InitializeStakePool>, nonce: u8, digit_shift: i8) -> Result<()> {
        initialize_stake_pool::handler(ctx, nonce, digit_shift)
    }
}
