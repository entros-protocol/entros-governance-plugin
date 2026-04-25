pub mod registrar;
pub use registrar::*;

// Wrap the addin API types for Anchor compatibility
vote_weight_record!(crate::ID);
max_voter_weight_record!(crate::ID);
