use anchor_lang::prelude::*;

#[error_code]
pub enum IamVoterError {
    #[msg("Invalid realm authority")]
    InvalidRealmAuthority,

    #[msg("Identity account missing from remaining_accounts")]
    MissingIdentityAccount,

    #[msg("Identity account address does not match expected PDA")]
    InvalidIdentityPda,

    #[msg("Identity account is not owned by the Entros Anchor program")]
    InvalidIdentityOwner,

    #[msg("Identity account data too short")]
    InvalidIdentityData,

    #[msg("Trust score below minimum required by this DAO")]
    InsufficientTrustScore,

    #[msg("Verification has expired")]
    VerificationExpired,

    #[msg("Voter weight record realm does not match registrar")]
    VoterWeightRecordRealmMismatch,

    #[msg("Voter weight record mint does not match registrar")]
    VoterWeightRecordMintMismatch,

    #[msg("Voter weight record owner does not match voter authority")]
    VoterWeightRecordOwnerMismatch,
}
