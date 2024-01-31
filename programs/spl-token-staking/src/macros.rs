#[macro_export]
macro_rules! stake_pool_signer_seeds {
    ($stake_pool:expr) => {
        &[
          &$stake_pool.nonce.to_le_bytes(),
          $stake_pool.mint.as_ref(),
          $stake_pool.creator.as_ref(),
          b"stakePool",
          &[$stake_pool.bump_seed],
        ]
    };
}
