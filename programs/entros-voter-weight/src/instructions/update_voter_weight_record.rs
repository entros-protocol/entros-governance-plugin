use anchor_lang::prelude::*;

use crate::error::EntrosVoterError;
use crate::state::*;

/// Entros Anchor program ID: GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2
const ENTROS_ANCHOR_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    0xe7, 0x36, 0x00, 0xda, 0x70, 0x7e, 0xbf, 0x19,
    0x90, 0x7d, 0x32, 0xec, 0x88, 0x42, 0xa4, 0x5f,
    0xb4, 0xd5, 0x32, 0x63, 0xa1, 0x49, 0x68, 0x01,
    0x6d, 0xb4, 0xe6, 0x29, 0x37, 0xe0, 0x93, 0xd1,
]);

/// Byte offset of last_verification_timestamp (i64 LE) in IdentityState account data
const IDENTITY_LAST_VERIFICATION_OFFSET: usize = 48;
/// Byte offset of trust_score (u16 LE) in IdentityState account data
const IDENTITY_TRUST_SCORE_OFFSET: usize = 60;
/// Minimum account data length to read through trust_score
const IDENTITY_MIN_DATA_LEN: usize = 62;

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

pub fn update_voter_weight_record<'info>(
    ctx: Context<'_, '_, 'info, 'info, UpdateVoterWeightRecord<'info>>,
) -> Result<()> {
    let registrar = &ctx.accounts.registrar;
    let voter_weight_record = &mut ctx.accounts.voter_weight_record;
    let voter = ctx.accounts.voter_authority.key();

    require!(
        voter_weight_record.governing_token_owner == voter,
        EntrosVoterError::VoterWeightRecordOwnerMismatch
    );

    // 1. Get IdentityState account from remaining_accounts
    let identity_info = ctx
        .remaining_accounts
        .first()
        .ok_or(error!(EntrosVoterError::MissingIdentityAccount))?;

    // 2. Verify the account is owned by the Entros Anchor program
    require!(
        *identity_info.owner == ENTROS_ANCHOR_PROGRAM_ID,
        EntrosVoterError::InvalidIdentityOwner
    );

    // 3. Verify the PDA derivation matches ["identity", voter_key]
    let (expected_pda, _bump) = Pubkey::find_program_address(
        &[b"identity", voter.as_ref()],
        &ENTROS_ANCHOR_PROGRAM_ID,
    );
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

    // 8. Check verification recency
    let clock = Clock::get()?;
    let age = clock
        .unix_timestamp
        .checked_sub(last_verification_timestamp)
        .unwrap_or(i64::MAX);
    require!(
        age < registrar.max_verification_age,
        EntrosVoterError::VerificationExpired
    );

    // 9. One person, one vote
    voter_weight_record.voter_weight = 1;

    // 10. Expire after ~40 seconds (100 slots). Forces update in same tx as governance action.
    voter_weight_record.voter_weight_expiry = Some(clock.slot.saturating_add(100));

    // 11. Weight applies to any governance action
    voter_weight_record.weight_action = None;
    voter_weight_record.weight_action_target = None;

    Ok(())
}
