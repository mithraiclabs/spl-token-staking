use anchor_lang::error_code;

#[error_code]
pub enum ErrorCode {
  #[msg("Invalid StakePool authority")]
  InvalidAuthority, // 6000
  #[msg("RewardPool index is already occupied")]
  RewardPoolIndexOccupied, // 6001
  #[msg("StakePool vault is invalid")]
  InvalidStakePoolVault, // 6002
  #[msg("RewardPool vault is invalid")]
  InvalidRewardPoolVault, // 6003
  #[msg("Invalid RewardPool vault remaining account index")]
  InvalidRewardPoolVaultIndex, // 6004
  #[msg("Invalid StakeDepositReceiptOwner")]
  InvalidOwner, // 6005
  #[msg("Invalid StakePool")]
  InvalidStakePool, // 6006
  #[msg("Math precision error")]
  PrecisionMath, // 6007
  #[msg("Invalid stake mint")]
  InvalidStakeMint, // 6008
  #[msg("Stake is still locked")]
  StakeStillLocked, // 6009
}