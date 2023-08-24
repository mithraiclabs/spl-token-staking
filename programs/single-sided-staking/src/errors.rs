use anchor_lang::error_code;

#[error_code]
pub enum ErrorCode {
  #[msg("Invalid StakePool authority")]
  InvalidAuthority, // 6000
  #[msg("RewardPool index is already occupied")]
  RewardPoolIndexOccupied, // 6001
}