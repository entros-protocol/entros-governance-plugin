use anchor_lang::prelude::*;

#[account]
pub struct Registrar {
    /// The governance program instance this registrar is configured for
    pub governance_program_id: Pubkey,
    /// The realm this registrar belongs to
    pub realm: Pubkey,
    /// The governing token mint (community or council)
    pub governing_token_mint: Pubkey,
    /// Minimum Entros Trust Score required to vote
    pub min_trust_score: u16,
    /// Maximum age of last verification in seconds (e.g., 2592000 = 30 days)
    pub max_verification_age: i64,
    /// Reserved for future use
    pub reserved: [u8; 64],
}

impl Registrar {
    pub const LEN: usize = 8   // discriminator
        + 32  // governance_program_id
        + 32  // realm
        + 32  // governing_token_mint
        + 2   // min_trust_score
        + 8   // max_verification_age
        + 64; // reserved
              // Total: 178 bytes
}

/// Governance action that an action-bound voter-weight update authorizes.
/// Mirrors `spl_governance_addin_api::voter_weight::VoterWeightAction` with
/// Anchor serialization and IDL support.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, Debug, PartialEq, Eq)]
pub enum VoterWeightAction {
    /// Cast vote for a proposal. Target: Proposal
    CastVote,
    /// Comment on a proposal. Target: Proposal
    CommentProposal,
    /// Create Governance within a realm. Target: Realm
    CreateGovernance,
    /// Create a proposal for a governance. Target: Governance
    CreateProposal,
    /// Sign off on a proposal for a governance. Target: Proposal
    SignOffProposal,
}

impl From<VoterWeightAction> for spl_governance_addin_api::voter_weight::VoterWeightAction {
    fn from(action: VoterWeightAction) -> Self {
        match action {
            VoterWeightAction::CastVote => {
                spl_governance_addin_api::voter_weight::VoterWeightAction::CastVote
            }
            VoterWeightAction::CommentProposal => {
                spl_governance_addin_api::voter_weight::VoterWeightAction::CommentProposal
            }
            VoterWeightAction::CreateGovernance => {
                spl_governance_addin_api::voter_weight::VoterWeightAction::CreateGovernance
            }
            VoterWeightAction::CreateProposal => {
                spl_governance_addin_api::voter_weight::VoterWeightAction::CreateProposal
            }
            VoterWeightAction::SignOffProposal => {
                spl_governance_addin_api::voter_weight::VoterWeightAction::SignOffProposal
            }
        }
    }
}
