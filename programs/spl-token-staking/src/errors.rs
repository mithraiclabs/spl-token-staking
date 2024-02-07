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
  #[msg("Stake is still locked")]
  StakeStillLocked, // 6008
  #[msg("Max duration must be great than min")]
  InvalidStakePoolDuration, // 6009
  #[msg("Max weight must be great than min")]
  InvalidStakePoolWeight, // 6010
  #[msg("Duration too short")]
  DurationTooShort, // 6011
  #[msg("Realm Authority is invalid")]
  InvalidRealmAuthority, // 6012
  #[msg("Registrar is invalid")]
  InvalidRegistrar, // 6013
  #[msg("Registrar must match StakePool registrar")]
  StakePoolRegistrarMismatch, // 6014
}