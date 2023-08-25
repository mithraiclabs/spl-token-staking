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
  #[msg("Bad math")]
  ArithmeticError, // 6005
}