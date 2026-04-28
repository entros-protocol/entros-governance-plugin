use anchor_lang::prelude::*;

#[error_code]
pub enum EntrosVoterError {
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

    #[msg("Realm has no authority configured")]
    RealmHasNoAuthority,

    #[msg("Voter weight record owner mismatch — instruction's governing_token_owner must match the signer")]
    GoverningTokenOwnerSignerMismatch,

    #[msg("max_verification_age must be greater than zero")]
    InvalidMaxVerificationAge,

    #[msg("max_voter_weight must be greater than zero")]
    InvalidMaxVoterWeight,
}
