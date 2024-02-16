#[cfg(not(feature = "no-entrypoint"))]
use {default_env::default_env, solana_security_txt::security_txt};

#[cfg(not(feature = "no-entrypoint"))]
security_txt! {
    // Required fields
    name: "Armada SPL Token Staking",
    project_url: "https://github.com/mithraiclabs/spl-token-staking",
    contacts: "link:https://github.com/mithraiclabs/spl-token-staking/security/advisories/new",
    policy: "https://github.com/mithraiclabs/spl-token-staking/blob/master/SECURITY.md",

    // Optional Fields
    preferred_languages: "en",
    source_code: "https://github.com/mithraiclabs/spl-token-staking",
    source_revision: default_env!("GIT_SHA", ""),
    source_release: default_env!("GIT_REF_NAME", ""),
    auditors: "Mad Shield"
}