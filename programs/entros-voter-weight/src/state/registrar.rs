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
