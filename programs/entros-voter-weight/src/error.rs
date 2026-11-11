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

    #[msg("weight_action_target must not be the default pubkey")]
    InvalidWeightActionTarget,

    #[msg("Migration record account missing from remaining_accounts")]
    MissingMigrationRecord,

    #[msg("Migration record address does not match expected PDA")]
    InvalidMigrationRecordPda,

    #[msg("Migration record account data is not a migration record")]
    InvalidMigrationRecordData,

    #[msg("A wallet that received a migrated identity must use an action-bound update")]
    MigratedIdentityNeedsActionTarget,

    #[msg("Proposal account missing from remaining_accounts")]
    MissingProposalAccount,

    #[msg("Proposal account does not match the vote target")]
    InvalidProposalAccount,

    #[msg("Proposal has not entered voting")]
    ProposalNotInVoting,

    #[msg("Identity migrated to this wallet after the proposal entered voting")]
    IdentityMigratedAfterVotingStart,
}
