use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::errors::ErrorCode;
use crate::stake_pool_signer_seeds;
use crate::state::{StakeDepositReceipt, StakePool};
use crate::state::u128;

#[derive(Accounts)]
#[instruction(nonce: u32)]
pub struct Deposit<'info> {
    // Payer to actually stake the mint tokens
    #[account(mut)]
    pub payer: Signer<'info>,
    
    /// Owner of the StakeDepositReceipt, which may differ
    /// from the account staking.
    /// CHECK: No check needed since this account will own the StakeReceipt.
    pub owner: UncheckedAccount<'info>,

    /// Token Account to transfer stake_mint from, to be deposited into the vault
    #[account(mut)]
    pub from: Account<'info, TokenAccount>,

    /// Vault of the StakePool token will be transfer to
    #[account(mut)]
    pub vault: Account<'info, TokenAccount>,

    #[account(mut)]
    pub stake_mint: Account<'info, Mint>,

    /// Token account the StakePool token will be transfered to
    #[account(
      mut,
      has_one = owner @ ErrorCode::InvalidAuthority
    )]
    pub destination: Account<'info, TokenAccount>,

    /// StakePool owning the vault that will receive the deposit
    #[account(
      mut,
      has_one = vault @ ErrorCode::InvalidStakePoolVault,
      has_one = stake_mint @ ErrorCode::InvalidAuthority,
    )]
    pub stake_pool: AccountLoader<'info, StakePool>,

    #[account(
      init,
      seeds = [
        owner.key().as_ref(),
        stake_pool.key().as_ref(),
        &nonce.to_le_bytes(),
        b"stakeDepositReceipt",
      ],
      bump,
      payer = payer,
      space = 8 + StakeDepositReceipt::LEN,
    )]
    pub stake_deposit_receipt: Account<'info, StakeDepositReceipt>,

    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
    pub system_program: Program<'info, System>,
}

impl<'info> Deposit<'info> {
    /// Transfer the stake_mint from the payer's address to the StakePool vault.
    pub fn transfer_from_user_to_stake_vault(&self, amount: u64) -> Result<()> {
        let cpi_ctx = CpiContext::new(
            self.token_program.to_account_info(),
            Transfer {
                from: self.from.to_account_info(),
                to: self.vault.to_account_info(),
                authority: self.payer.to_account_info(),
            },
        );
        token::transfer(cpi_ctx, amount)
    }

    pub fn mint_staked_token_to_user(&self, effective_amount: u64) -> Result<()> {
        let stake_pool = self.stake_pool.load()?;
        let signer_seeds: &[&[&[u8]]] = &[stake_pool_signer_seeds!(stake_pool)];
        let cpi_ctx = CpiContext::new_with_signer(
            self.token_program.to_account_info(),
            MintTo {
                mint: self.stake_mint.to_account_info(),
                to: self.destination.to_account_info(),
                authority: self.stake_pool.to_account_info(),
            },
            signer_seeds,
        );

        token::mint_to(cpi_ctx, effective_amount)
    }
}

pub fn handler<'info>(
    ctx: Context<Deposit>,
    _nonce: u32,
    amount: u64,
    lockup_duration: u64,
) -> Result<()> {
    ctx.accounts.transfer_from_user_to_stake_vault(amount)?;

    {
        let mut stake_pool = ctx.accounts.stake_pool.load_mut()?;
        if lockup_duration < stake_pool.min_duration {
            return err!(ErrorCode::DurationTooShort);
        }
        // clamp lockup duration to the max
        let lockup_duration = u64::min(lockup_duration, stake_pool.max_duration);
        let stake_deposit_receipt = &mut ctx.accounts.stake_deposit_receipt;

        stake_pool.recalculate_rewards_per_effective_stake(&ctx.remaining_accounts, 1usize)?;
        let weight = stake_pool.get_stake_weight(lockup_duration);
        let effect_amount_staked = StakeDepositReceipt::get_effective_stake_amount(weight, amount);

        stake_deposit_receipt.stake_pool = ctx.accounts.stake_pool.key();
        stake_deposit_receipt.owner = ctx.accounts.owner.key();
        stake_deposit_receipt.payer = ctx.accounts.payer.key();
        stake_deposit_receipt.deposit_amount = amount;
        stake_deposit_receipt.effective_stake = u128(effect_amount_staked.to_le_bytes());
        stake_deposit_receipt.lockup_duration = lockup_duration;
        stake_deposit_receipt.deposit_timestamp = Clock::get()?.unix_timestamp;

        // iterate over reward pools setting the initial "claimed" amount based on `rewards_per_effective_stake`.
        //  Setting these claimed amounts to the current rewards per effective stake, marks where this
        //  deposit receipt can start accumulating rewards. Now any more rewards added to a reward pool will
        //  be claimable, on a pro-rated basis, by this stake receipt.
        stake_deposit_receipt.claimed_amounts = stake_pool.get_claimed_amounts_of_reward_pools();

        let total_staked = stake_pool
            .total_weighted_stake_u128()
            .checked_add(effect_amount_staked)
            .unwrap();
        stake_pool.total_weighted_stake = u128(total_staked.to_le_bytes());
    }
    let stake_pool = ctx.accounts.stake_pool.load()?;
    let effect_amount_staked_tokens = StakeDepositReceipt::get_token_amount_from_stake(
        ctx.accounts.stake_deposit_receipt.effective_stake_u128(),
        stake_pool.max_weight,
    );
    ctx.accounts
        .mint_staked_token_to_user(effect_amount_staked_tokens)?;
    Ok(())
}
