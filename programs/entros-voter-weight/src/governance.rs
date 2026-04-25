/// Wraps the spl-governance-addin-api VoterWeightRecord into an Anchor-compatible account type.
/// The addin API types use plain Borsh (not Anchor's #[account] macro), so this macro creates
/// the necessary AccountSerialize, AccountDeserialize, Owner, and Discriminator implementations.
#[macro_export]
macro_rules! vote_weight_record {
    ($id:expr) => {
        #[derive(Clone)]
        pub struct VoterWeightRecord(
            spl_governance_addin_api::voter_weight::VoterWeightRecord,
        );

        impl VoterWeightRecord {
            pub fn get_space() -> usize {
                8   // account_discriminator
                + 32  // realm
                + 32  // governing_token_mint
                + 32  // governing_token_owner
                + 8   // voter_weight
                + 9   // voter_weight_expiry (Option<u64>)
                + 2   // weight_action (Option<VoterWeightAction>)
                + 33  // weight_action_target (Option<Pubkey>)
                + 8   // reserved
            }
        }

        impl anchor_lang::AccountDeserialize for VoterWeightRecord {
            fn try_deserialize_unchecked(buf: &mut &[u8]) -> anchor_lang::Result<Self> {
                let record: spl_governance_addin_api::voter_weight::VoterWeightRecord =
                    borsh_1::BorshDeserialize::deserialize(buf)
                        .map_err(|_| anchor_lang::error::ErrorCode::AccountDidNotDeserialize)?;
                Ok(VoterWeightRecord(record))
            }
        }

        impl anchor_lang::AccountSerialize for VoterWeightRecord {
            fn try_serialize<W: std::io::Write>(&self, writer: &mut W) -> anchor_lang::Result<()> {
                borsh_1::BorshSerialize::serialize(&self.0, writer)
                    .map_err(|_| anchor_lang::error::ErrorCode::AccountDidNotSerialize)?;
                Ok(())
            }
        }

        impl anchor_lang::Owner for VoterWeightRecord {
            fn owner() -> anchor_lang::prelude::Pubkey {
                $id
            }
        }

        impl anchor_lang::Discriminator for VoterWeightRecord {
            const DISCRIMINATOR: &'static [u8] =
                &spl_governance_addin_api::voter_weight::VoterWeightRecord::ACCOUNT_DISCRIMINATOR;
        }

        impl std::ops::Deref for VoterWeightRecord {
            type Target = spl_governance_addin_api::voter_weight::VoterWeightRecord;

            fn deref(&self) -> &Self::Target {
                &self.0
            }
        }

        impl std::ops::DerefMut for VoterWeightRecord {
            fn deref_mut(&mut self) -> &mut Self::Target {
                &mut self.0
            }
        }
    };
}

/// Same pattern for MaxVoterWeightRecord, used for quorum calculations.
#[macro_export]
macro_rules! max_voter_weight_record {
    ($id:expr) => {
        #[derive(Clone)]
        pub struct MaxVoterWeightRecord(
            spl_governance_addin_api::max_voter_weight::MaxVoterWeightRecord,
        );

        impl MaxVoterWeightRecord {
            pub fn get_space() -> usize {
                8   // account_discriminator
                + 32  // realm
                + 32  // governing_token_mint
                + 8   // max_voter_weight
                + 9   // max_voter_weight_expiry (Option<u64>)
                + 8   // reserved
            }
        }

        impl anchor_lang::AccountDeserialize for MaxVoterWeightRecord {
            fn try_deserialize_unchecked(buf: &mut &[u8]) -> anchor_lang::Result<Self> {
                let record: spl_governance_addin_api::max_voter_weight::MaxVoterWeightRecord =
                    borsh_1::BorshDeserialize::deserialize(buf)
                        .map_err(|_| anchor_lang::error::ErrorCode::AccountDidNotDeserialize)?;
                Ok(MaxVoterWeightRecord(record))
            }
        }

        impl anchor_lang::AccountSerialize for MaxVoterWeightRecord {
            fn try_serialize<W: std::io::Write>(&self, writer: &mut W) -> anchor_lang::Result<()> {
                borsh_1::BorshSerialize::serialize(&self.0, writer)
                    .map_err(|_| anchor_lang::error::ErrorCode::AccountDidNotSerialize)?;
                Ok(())
            }
        }

        impl anchor_lang::Owner for MaxVoterWeightRecord {
            fn owner() -> anchor_lang::prelude::Pubkey {
                $id
            }
        }

        impl anchor_lang::Discriminator for MaxVoterWeightRecord {
            const DISCRIMINATOR: &'static [u8] =
                &spl_governance_addin_api::max_voter_weight::MaxVoterWeightRecord::ACCOUNT_DISCRIMINATOR;
        }

        impl std::ops::Deref for MaxVoterWeightRecord {
            type Target = spl_governance_addin_api::max_voter_weight::MaxVoterWeightRecord;

            fn deref(&self) -> &Self::Target {
                &self.0
            }
        }

        impl std::ops::DerefMut for MaxVoterWeightRecord {
            fn deref_mut(&mut self) -> &mut Self::Target {
                &mut self.0
            }
        }
    };
}
