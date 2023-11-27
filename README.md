# SPL Token Staking

Built in collaboration with

- <font size="5">[PsyFi](https://www.psyfi.io/)</font> <font size="3">- Option primitives and structured products</font>
- <font size="5">Armada (coming soon)</font> <font size="3"> - Democratizing non-custodial institutional market making and improving on-chain liquidity</font>

## Program Architecture

Working document for the architecture of a SPL Token Staking program that tokenizes the stake for use in SPL Governance.

Caveats:

- since we must atomically iterate over RewardPools at deposit time, there is an upper limit to the number of RewardPools that can be on a StakePool
- Un-staking is all or none
- Precision loss: based on the `max_weight` or largest scalar of the deposited amount, we must truncate some precision in order to fit it into a `u64` for the SPL Token representation of effective stake weight. To do this, we calculate the minimum number of digits that must be truncated to fit into the `u64::MAX` based on the given `max_weight`.

### State

**RewardPool**

```rust
/** Token Account to store the reward SPL Token */
reward_vault: Pubkey,
/**
Ever increasing accumulator of the amount of rewards per effective stake.
Said another way, if a user deposited before any rewards were added to the
`vault`, then this would be the token amount per effective stake they could
claim.
*/
rewards_per_effective_stake: u128,
/** latest amount of tokens in the vault */
last_amount: u64
```

**StakePool**

```rust
/** Pubkey that can make updates to StakePool */
authority: Pubkey,
/** Total amount staked that accounts for the lock up period weighting.
Note, this is not equal to the amount of SPL Tokens staked. */
total_weighted_stake: u128,
/** Token Account to store the staked SPL Token */
vault: Pubkey,
/** Mint of the token representing effective stake */
stake_mint: Pubkey,
/** Array of RewardPools that apply to the stake pool */
reward_pools: Vec<RewardPool>,
/** Base weight for staking lockup. In terms of 1 / SCALE_FACTOR_BASE */
base_weight: u64,
/** Maximum weight for staking lockup (i.e. weight multiplier when locked up for max duration). In terms of 1 / SCALE_FACTOR_BASE */
max_weight: u64,
/** Minimum duration for lockup. At this point, the staker would receive the base weight. */
min_duration: u64,
/** Maximum duration for lockup. At this point, the staker would receive the max weight. */
max_duration: u64,
/** Nonce to derive multiple stake pools from same mint */
nonce: u8,
/** Bump seed for stake_mint */
bump_seed: u8,
```

**StakeDepositReceipt**

```rust
/** Pubkey that owns the staked assets */
owner: Pubkey,
/** Pubkey that paid for the deposit */
payer: Pubkey,
/** StakePool the deposit is for */
stake_pool: Pubkey,
/** Duration of the lockup period in seconds */
lockup_duration: i64,
/** Timestamp in seconds of when the stake lockup began */
deposit_timestamp: i64,
/** Amount of SPL token deposited */
deposit_amount: u64,
/** Amount of stake weighted by lockup duration */
effective_stake: u128,
/** The amount per reward that has been claimed or perceived to be claimed.
Indexes align with the StakedPool reward_pools property. */
claimed_amounts: Vec<u128>
```

## Instructions

## InitStakePool

- Create the **StakePool** account
- Init **stake_mint** SPL Token

## AddRewardPool

- verify **StakePool** authority
- Assert the RewardPool at index to be updated is still Default (aka not taken)
- Init Token Account
- Add **RewardPool** to **StakePool**

## Deposit

- Transfer underlying token to **StakePool** vault
- Recalculate `rewards_per_effective_stake` based on change in token amount of all **RewardPool**s on **StakePool**
  - For each RewardPool: update `last_amount` based on token account balance of **RewardPool**
- Init **StakeDepositReceipt**
  - Calculate the effective stake weight based on lockup duration
  - store `rewards_per_effective_stake` of each RewardPool in `claimed_amounts`
- Increment **StakePool** `total_weighted_stake`
- Transfer effective stake amount of **StakePool** `stake_mint` to owner

## ClaimAll

- Validations
  - **StakeDepositReceipt** `owner` is Signer
  - **StakeDepositReceipt** and **StakePool** match
- Recalculate `rewards_per_effective_stake` based on change in token amount of all **RewardPool**s on **StakePool**
  - Update `last_amount` based on token account balance of **RewardPool**
- For each **RewardPool**
  - calculate claimable amount (`(rewards_per_effective_stake - claimed_amount[reward_pool_index]) * effective_stake`
  - Transfer claimable amount from **RewardPool** vault to `owner`
  - decrement **RewardPool** `last_amount` by claimable amount

## Withdraw (Unstake)

- Validations
  - **StakeDepositReceipt** `owner` is Signer
  - **StakeDepositReceipt** and **StakePool** match
- Burn effective stake amount of **StakePool** `stake_mint` from `owner`
- Claim any leftover rewards
- Decrement **StakePool** `total_weighted_stake` by `total_weighted_stake`
- Transfer `deposit_amount` from `vault` to `owner`
- Delete **StakeDepositReceipt**

### Potential Ideas

- Support various scaling functions (step function, combinations, etc).
- Set max number of RewardPools when setting up StakePool. An optimization for organizations that know they will only ever want to distribute a single SPL Token as rewards to stakers.
- Allow for locking rewards based on duration. This is another incentive mechanism for getting wallets to stake for longer durations.
- Early withdraw penalties. Some % of locked tokens get sent to DAO for withdrawing.
