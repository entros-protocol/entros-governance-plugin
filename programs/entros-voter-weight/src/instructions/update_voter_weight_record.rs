use anchor_lang::prelude::*;

use crate::error::EntrosVoterError;
use crate::state::*;

/// Entros Anchor program ID: GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2
const ENTROS_ANCHOR_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0xe7, 0x36, 0x00, 0xda, 0x70, 0x7e, 0xbf, 0x19, 0x90, 0x7d, 0x32, 0xec, 0x88, 0x42, 0xa4, 0x5f,
    0xb4, 0xd5, 0x32, 0x63, 0xa1, 0x49, 0x68, 0x01, 0x6d, 0xb4, 0xe6, 0x29, 0x37, 0xe0, 0x93, 0xd1,
]);

/// Byte offset of last_verification_timestamp (i64 LE) in IdentityState account data
const IDENTITY_LAST_VERIFICATION_OFFSET: usize = 48;
/// Byte offset of trust_score (u16 LE) in IdentityState account data
const IDENTITY_TRUST_SCORE_OFFSET: usize = 60;
/// Minimum account data length to read through trust_score
const IDENTITY_MIN_DATA_LEN: usize = 62;
/// Anchor account discriminator for IdentityState = sha256("account:IdentityState")[0..8].
/// Guards the raw-byte read below against type confusion: an account owned by the
/// Entros Anchor program at the expected PDA but of a different account type must not
/// be reinterpreted as IdentityState.
const IDENTITY_DISCRIMINATOR: [u8; 8] = [156, 32, 87, 93, 52, 155, 248, 207];

/// Slot window (~4 seconds at 400ms/slot) for general `update_voter_weight_record`.
pub const VOTER_WEIGHT_EXPIRY_SLOT_WINDOW: u64 = 10;

#[derive(Accounts)]
pub struct UpdateVoterWeightRecord<'info> {
    #[account(
        seeds = [b"registrar", registrar.realm.as_ref(), registrar.governing_token_mint.as_ref()],
        bump,
    )]
    pub registrar: Account<'info, Registrar>,

    #[account(
        mut,
        constraint = voter_weight_record.realm == registrar.realm
            @ EntrosVoterError::VoterWeightRecordRealmMismatch,
        constraint = voter_weight_record.governing_token_mint == registrar.governing_token_mint
            @ EntrosVoterError::VoterWeightRecordMintMismatch,
    )]
    pub voter_weight_record: Account<'info, VoterWeightRecord>,

    /// The voter whose weight is being updated. Must match the voter weight record owner.
    pub voter_authority: Signer<'info>,
    // remaining_accounts[0] = Entros IdentityState PDA (read-only)
}

fn verify_voter_identity_and_recency<'info>(
    registrar: &Registrar,
    voter_weight_record: &VoterWeightRecord,
    voter: Pubkey,
    remaining_accounts: &[AccountInfo<'info>],
) -> Result<Clock> {
    require!(
        voter_weight_record.governing_token_owner == voter,
        EntrosVoterError::VoterWeightRecordOwnerMismatch
    );

    // 1. Get IdentityState account from remaining_accounts
    let identity_info = remaining_accounts
        .first()
        .ok_or(error!(EntrosVoterError::MissingIdentityAccount))?;

    // 2. Verify the account is owned by the Entros Anchor program
    require!(
        *identity_info.owner == ENTROS_ANCHOR_PROGRAM_ID,
        EntrosVoterError::InvalidIdentityOwner
    );

    // 3. Verify the PDA derivation matches ["identity", voter_key]
    let (expected_pda, _bump) =
        Pubkey::find_program_address(&[b"identity", voter.as_ref()], &ENTROS_ANCHOR_PROGRAM_ID);
    require!(
        identity_info.key() == expected_pda,
        EntrosVoterError::InvalidIdentityPda
    );

    // 4. Read raw bytes from the account data
    let data = identity_info.try_borrow_data()?;
    require!(
        data.len() >= IDENTITY_MIN_DATA_LEN,
        EntrosVoterError::InvalidIdentityData
    );

    // 4b. Verify the Anchor account discriminator. Owner + PDA checks alone do not
    // prevent type confusion: a different account type owned by the Entros Anchor
    // program at the expected PDA would otherwise have its bytes read as a trust
    // score and timestamp. The length check above guarantees data[..8] is in bounds.
    require!(
        data[..8] == IDENTITY_DISCRIMINATOR,
        EntrosVoterError::InvalidIdentityData
    );

    // 5. Parse last_verification_timestamp (i64 LE at offset 48)
    let last_verification_timestamp = i64::from_le_bytes(
        data[IDENTITY_LAST_VERIFICATION_OFFSET..IDENTITY_LAST_VERIFICATION_OFFSET + 8]
            .try_into()
            .map_err(|_| error!(EntrosVoterError::InvalidIdentityData))?,
    );

    // 6. Parse trust_score (u16 LE at offset 60)
    let trust_score = u16::from_le_bytes(
        data[IDENTITY_TRUST_SCORE_OFFSET..IDENTITY_TRUST_SCORE_OFFSET + 2]
            .try_into()
            .map_err(|_| error!(EntrosVoterError::InvalidIdentityData))?,
    );

    drop(data);

    // 7. Check trust score meets minimum
    require!(
        trust_score >= registrar.min_trust_score,
        EntrosVoterError::InsufficientTrustScore
    );

    // 8. Check verification recency (Unix seconds)
    let clock = Clock::get()?;
    let age = clock
        .unix_timestamp
        .checked_sub(last_verification_timestamp)
        .unwrap_or(i64::MAX);
    require!(
        age < registrar.max_verification_age,
        EntrosVoterError::VerificationExpired
    );

    Ok(clock)
}

pub fn update_voter_weight_record<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdateVoterWeightRecord<'info>>,
) -> Result<()> {
    let clock = verify_voter_identity_and_recency(
        &ctx.accounts.registrar,
        &ctx.accounts.voter_weight_record,
        ctx.accounts.voter_authority.key(),
        ctx.remaining_accounts,
    )?;

    let voter_weight_record = &mut ctx.accounts.voter_weight_record;

    // 9. One person, one vote
    voter_weight_record.voter_weight = 1;

    // 10. Expire after ~4 seconds (10 slots). Tightened slot window for standalone updates.
    voter_weight_record.voter_weight_expiry =
        Some(clock.slot.saturating_add(VOTER_WEIGHT_EXPIRY_SLOT_WINDOW));

    // 11. Weight applies to any governance action within the 10-slot window
    voter_weight_record.weight_action = None;
    voter_weight_record.weight_action_target = None;

    Ok(())
}

pub fn update_voter_weight_record_for_action<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdateVoterWeightRecord<'info>>,
    weight_action: VoterWeightAction,
    weight_action_target: Pubkey,
) -> Result<()> {
    require!(
        weight_action_target != Pubkey::default(),
        EntrosVoterError::InvalidWeightActionTarget
    );

    let clock = verify_voter_identity_and_recency(
        &ctx.accounts.registrar,
        &ctx.accounts.voter_weight_record,
        ctx.accounts.voter_authority.key(),
        ctx.remaining_accounts,
    )?;

    let voter_weight_record = &mut ctx.accounts.voter_weight_record;

    // 9. One person, one vote
    voter_weight_record.voter_weight = 1;

    // 10. Current-slot expiry: requires consumption in the same slot / atomic transaction.
    voter_weight_record.voter_weight_expiry = Some(clock.slot);

    // 11. Bind weight to the exact governance action and target account.
    voter_weight_record.weight_action = Some(weight_action.into());
    voter_weight_record.weight_action_target = Some(weight_action_target);

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use spl_governance_addin_api::voter_weight::{
        VoterWeightAction as AddinAction, VoterWeightRecord as AddinRecord,
    };

    #[test]
    fn voter_weight_expiry_slot_window_is_ten_slots() {
        assert_eq!(VOTER_WEIGHT_EXPIRY_SLOT_WINDOW, 10);
    }

    #[test]
    fn voter_weight_action_maps_and_serializes_identically_to_addin_api() {
        let pairs = [
            (VoterWeightAction::CastVote, AddinAction::CastVote, 0u8),
            (
                VoterWeightAction::CommentProposal,
                AddinAction::CommentProposal,
                1u8,
            ),
            (
                VoterWeightAction::CreateGovernance,
                AddinAction::CreateGovernance,
                2u8,
            ),
            (
                VoterWeightAction::CreateProposal,
                AddinAction::CreateProposal,
                3u8,
            ),
            (
                VoterWeightAction::SignOffProposal,
                AddinAction::SignOffProposal,
                4u8,
            ),
        ];

        for (plugin_action, expected_addin_action, expected_byte) in pairs {
            let converted: AddinAction = plugin_action.into();
            assert_eq!(converted, expected_addin_action);

            let mut plugin_bytes = Vec::new();
            AnchorSerialize::serialize(&plugin_action, &mut plugin_bytes).unwrap();
            assert_eq!(plugin_bytes, vec![expected_byte]);
        }
    }

    #[test]
    fn action_bound_voter_weight_record_round_trips_at_fixed_offsets() {
        let realm = Pubkey::new_unique();
        let mint = Pubkey::new_unique();
        let owner = Pubkey::new_unique();
        let target = Pubkey::new_unique();
        let current_slot = 42_000u64;

        let record = VoterWeightRecord(AddinRecord {
            account_discriminator: AddinRecord::ACCOUNT_DISCRIMINATOR,
            realm,
            governing_token_mint: mint,
            governing_token_owner: owner,
            voter_weight: 1,
            voter_weight_expiry: Some(current_slot),
            weight_action: Some(VoterWeightAction::CastVote.into()),
            weight_action_target: Some(target),
            reserved: [0u8; 8],
        });

        let mut bytes = Vec::with_capacity(VoterWeightRecord::get_space());
        anchor_lang::AccountSerialize::try_serialize(&record, &mut bytes).unwrap();
        assert_eq!(bytes.len(), VoterWeightRecord::get_space());

        // Offset 112: Some(current_slot)
        assert_eq!(bytes[112], 1);
        assert_eq!(
            u64::from_le_bytes(bytes[113..121].try_into().unwrap()),
            current_slot
        );
        // Offset 121: Some(VoterWeightAction::CastVote == 0)
        assert_eq!(bytes[121], 1);
        assert_eq!(bytes[122], 0);
        // Offset 123: Some(target)
        assert_eq!(bytes[123], 1);
        assert_eq!(&bytes[124..156], target.as_ref());

        let mut slice = bytes.as_slice();
        let decoded =
            <VoterWeightRecord as anchor_lang::AccountDeserialize>::try_deserialize_unchecked(
                &mut slice,
            )
            .unwrap();
        assert_eq!(decoded.voter_weight, 1);
        assert_eq!(decoded.voter_weight_expiry, Some(current_slot));
        assert_eq!(decoded.weight_action, Some(AddinAction::CastVote));
        assert_eq!(decoded.weight_action_target, Some(target));
    }
}
