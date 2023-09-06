type Mutable<T> = {
  -readonly [K in keyof T]: Mutable<T[K]>;
};

const _SplTokenStakingIDL = {
  version: "0.1.0",
  name: "spl_token_staking",
  instructions: [
    {
      name: "initializeStakePool",
      accounts: [
        {
          name: "authority",
          isMut: true,
          isSigner: true,
          docs: ["Payer and authority of the StakePool"],
        },
        {
          name: "mint",
          isMut: false,
          isSigner: false,
          docs: [
            "SPL Token Mint of the underlying token to be deposited for staking",
          ],
        },
        {
          name: "stakePool",
          isMut: true,
          isSigner: false,
        },
        {
          name: "stakeMint",
          isMut: true,
          isSigner: false,
          docs: ["An SPL token Mint for the effective stake weight token"],
        },
        {
          name: "vault",
          isMut: true,
          isSigner: false,
          docs: ["An SPL token Account for staging A tokens"],
        },
        {
          name: "tokenProgram",
          isMut: false,
          isSigner: false,
        },
        {
          name: "rent",
          isMut: false,
          isSigner: false,
        },
        {
          name: "systemProgram",
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: "nonce",
          type: "u8",
        },
        {
          name: "baseWeight",
          type: "u64",
        },
        {
          name: "maxWeight",
          type: "u64",
        },
        {
          name: "minDuration",
          type: "u64",
        },
        {
          name: "maxDuration",
          type: "u64",
        },
      ],
    },
    {
      name: "addRewardPool",
      accounts: [
        {
          name: "authority",
          isMut: true,
          isSigner: true,
          docs: ["Payer and authority of the StakePool"],
        },
        {
          name: "rewardMint",
          isMut: false,
          isSigner: false,
          docs: [
            "SPL Token Mint of the token that will be distributed as rewards",
          ],
        },
        {
          name: "stakePool",
          isMut: true,
          isSigner: false,
          docs: ["StakePool where the RewardPool will be added"],
        },
        {
          name: "rewardVault",
          isMut: true,
          isSigner: false,
          docs: ["An SPL token Account for holding rewards to be claimed"],
        },
        {
          name: "tokenProgram",
          isMut: false,
          isSigner: false,
        },
        {
          name: "rent",
          isMut: false,
          isSigner: false,
        },
        {
          name: "systemProgram",
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: "index",
          type: "u8",
        },
      ],
    },
    {
      name: "deposit",
      accounts: [
        {
          name: "owner",
          isMut: true,
          isSigner: true,
          docs: ["Payer and owner of the StakeDepositReceipt"],
        },
        {
          name: "from",
          isMut: true,
          isSigner: false,
          docs: [
            "Token Account to transfer stake_mint from, to be deposited into the vault",
          ],
        },
        {
          name: "vault",
          isMut: true,
          isSigner: false,
          docs: ["Vault of the StakePool token will be transfer to"],
        },
        {
          name: "stakeMint",
          isMut: true,
          isSigner: false,
        },
        {
          name: "destination",
          isMut: true,
          isSigner: false,
          docs: ["Vault of the StakePool token will be transfer to"],
        },
        {
          name: "stakePool",
          isMut: true,
          isSigner: false,
        },
        {
          name: "stakeDepositReceipt",
          isMut: true,
          isSigner: false,
        },
        {
          name: "tokenProgram",
          isMut: false,
          isSigner: false,
        },
        {
          name: "rent",
          isMut: false,
          isSigner: false,
        },
        {
          name: "systemProgram",
          isMut: false,
          isSigner: false,
        },
      ],
      args: [
        {
          name: "nonce",
          type: "u32",
        },
        {
          name: "amount",
          type: "u64",
        },
        {
          name: "lockupDuration",
          type: "u64",
        },
      ],
    },
    {
      name: "claimAll",
      accounts: [
        {
          name: "claimBase",
          accounts: [
            {
              name: "owner",
              isMut: true,
              isSigner: true,
              docs: ["Payer and owner of the StakeDepositReceipt"],
            },
            {
              name: "stakePool",
              isMut: true,
              isSigner: false,
            },
            {
              name: "stakeDepositReceipt",
              isMut: true,
              isSigner: false,
              docs: [
                "StakeDepositReceipt of the owner that will be used to claim respective rewards",
              ],
            },
            {
              name: "tokenProgram",
              isMut: false,
              isSigner: false,
            },
          ],
        },
      ],
      args: [],
    },
    {
      name: "withdraw",
      accounts: [
        {
          name: "claimBase",
          accounts: [
            {
              name: "owner",
              isMut: true,
              isSigner: true,
              docs: ["Payer and owner of the StakeDepositReceipt"],
            },
            {
              name: "stakePool",
              isMut: true,
              isSigner: false,
            },
            {
              name: "stakeDepositReceipt",
              isMut: true,
              isSigner: false,
              docs: [
                "StakeDepositReceipt of the owner that will be used to claim respective rewards",
              ],
            },
            {
              name: "tokenProgram",
              isMut: false,
              isSigner: false,
            },
          ],
        },
        {
          name: "vault",
          isMut: true,
          isSigner: false,
          docs: ["Vault of the StakePool token will be transferred from"],
        },
        {
          name: "stakeMint",
          isMut: true,
          isSigner: false,
          docs: ["stake_mint of StakePool that will be burned"],
        },
        {
          name: "from",
          isMut: true,
          isSigner: false,
          docs: [
            "Token Account holding weighted stake representation token to burn",
          ],
        },
        {
          name: "destination",
          isMut: true,
          isSigner: false,
          docs: ["Token account to transfer the previously staked token to"],
        },
      ],
      args: [],
    },
  ],
  accounts: [
    {
      name: "stakePool",
      type: {
        kind: "struct",
        fields: [
          {
            name: "authority",
            docs: ["Pubkey that can make updates to StakePool"],
            type: "publicKey",
          },
          {
            name: "totalWeightedStake",
            docs: [
              "Total amount staked that accounts for the lock up period weighting.\n    Note, this is not equal to the amount of SPL Tokens staked.",
            ],
            type: "u128",
          },
          {
            name: "vault",
            docs: ["Token Account to store the staked SPL Token"],
            type: "publicKey",
          },
          {
            name: "stakeMint",
            docs: ["Mint of the token representing effective stake"],
            type: "publicKey",
          },
          {
            name: "rewardPools",
            docs: ["Array of RewardPools that apply to the stake pool"],
            type: {
              array: [
                {
                  defined: "RewardPool",
                },
                5,
              ],
            },
          },
          {
            name: "baseWeight",
            docs: [
              "Base weight for staking lockup. In terms of 1 / SCALE_FACTOR_BASE",
            ],
            type: "u64",
          },
          {
            name: "maxWeight",
            docs: [
              "Maximum weight for staking lockup (i.e. weight multiplier when locked up for max duration). In terms of 1 / SCALE_FACTOR_BASE",
            ],
            type: "u64",
          },
          {
            name: "minDuration",
            docs: [
              "Minimum duration for lockup. At this point, the staker would receive the base weight.",
            ],
            type: "u64",
          },
          {
            name: "maxDuration",
            docs: [
              "Maximum duration for lockup. At this point, the staker would receive the max weight.",
            ],
            type: "u64",
          },
          {
            name: "nonce",
            docs: ["Nonce to derive multiple stake pools from same mint"],
            type: "u8",
          },
          {
            name: "bumpSeed",
            docs: ["Bump seed for stake_mint"],
            type: "u8",
          },
          {
            name: "padding0",
            type: {
              array: ["u8", 14],
            },
          },
        ],
      },
    },
    {
      name: "stakeDepositReceipt",
      type: {
        kind: "struct",
        fields: [
          {
            name: "owner",
            docs: ["Pubkey that created the deposit"],
            type: "publicKey",
          },
          {
            name: "stakePool",
            docs: ["StakePool the deposit is for"],
            type: "publicKey",
          },
          {
            name: "lockupDuration",
            docs: ["Duration of the lockup period in seconds"],
            type: "u64",
          },
          {
            name: "depositTimestamp",
            docs: ["Timestamp in seconds of when the stake lockup began"],
            type: "i64",
          },
          {
            name: "depositAmount",
            docs: ["Amount of SPL token deposited"],
            type: "u64",
          },
          {
            name: "effectiveStake",
            docs: ["Amount of stake weighted by lockup duration"],
            type: "u128",
          },
          {
            name: "claimedAmounts",
            docs: [
              "The amount per reward that has been claimed or perceived to be claimed.\n    Indexes align with the StakedPool reward_pools property.",
            ],
            type: {
              array: ["u128", 5],
            },
          },
        ],
      },
    },
  ],
  types: [
    {
      name: "RewardPool",
      type: {
        kind: "struct",
        fields: [
          {
            name: "rewardVault",
            docs: ["Token Account to store the reward SPL Token"],
            type: "publicKey",
          },
          {
            name: "rewardsPerEffectiveStake",
            docs: [
              "Ever increasing accumulator of the amount of rewards per effective stake.\n    Said another way, if a user deposited before any rewards were added to the\n    `vault`, then this would be the token amount per effective stake they could\n    claim.",
            ],
            type: "u128",
          },
          {
            name: "lastAmount",
            docs: ["latest amount of tokens in the vault"],
            type: "u64",
          },
          {
            name: "padding0",
            type: {
              array: ["u8", 8],
            },
          },
        ],
      },
    },
  ],
  errors: [
    {
      code: 6000,
      name: "InvalidAuthority",
      msg: "Invalid StakePool authority",
    },
    {
      code: 6001,
      name: "RewardPoolIndexOccupied",
      msg: "RewardPool index is already occupied",
    },
    {
      code: 6002,
      name: "InvalidStakePoolVault",
      msg: "StakePool vault is invalid",
    },
    {
      code: 6003,
      name: "InvalidRewardPoolVault",
      msg: "RewardPool vault is invalid",
    },
    {
      code: 6004,
      name: "InvalidRewardPoolVaultIndex",
      msg: "Invalid RewardPool vault remaining account index",
    },
    {
      code: 6005,
      name: "InvalidOwner",
      msg: "Invalid StakeDepositReceiptOwner",
    },
    {
      code: 6006,
      name: "InvalidStakePool",
      msg: "Invalid StakePool",
    },
    {
      code: 6007,
      name: "PrecisionMath",
      msg: "Math precision error",
    },
    {
      code: 6008,
      name: "InvalidStakeMint",
      msg: "Invalid stake mint",
    },
    {
      code: 6009,
      name: "StakeStillLocked",
      msg: "Stake is still locked",
    },
    {
      code: 6010,
      name: "InvalidStakePoolDuration",
      msg: "Max duration must be great than min",
    },
    {
      code: 6011,
      name: "InvalidStakePoolWeight",
      msg: "Max weight must be great than min",
    },
    {
      code: 6012,
      name: "DurationTooShort",
      msg: "Duration too short",
    },
  ],
} as const;

export const SplTokenStakingIDL = _SplTokenStakingIDL as Mutable<
  typeof _SplTokenStakingIDL
>;

export type SplTokenStaking = typeof SplTokenStakingIDL;
