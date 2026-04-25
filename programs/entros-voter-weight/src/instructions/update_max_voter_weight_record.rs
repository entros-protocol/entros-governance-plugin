use anchor_lang::prelude::*;
use spl_governance::state::realm;

use crate::error::IamVoterError;
use crate::state::*;

#[derive(Accounts)]
pub struct UpdateMaxVoterWeightRecord<'info> {
    #[account(
        seeds = [b"registrar", registrar.realm.as_ref(), registrar.governing_token_mint.as_ref()],
        bump,
    )]
    pub registrar: Account<'info, Registrar>,

    #[account(
        mut,
        constraint = max_voter_weight_record.realm == registrar.realm,
        constraint = max_voter_weight_record.governing_token_mint == registrar.governing_token_mint,
    )]
    pub max_voter_weight_record: Account<'info, MaxVoterWeightRecord>,

    /// CHECK: Validated via get_realm_data_for_governing_token_mint.
    #[account(constraint = realm.key() == registrar.realm)]
    pub realm: UncheckedAccount<'info>,

    /// Must be the realm's authority.
    pub realm_authority: Signer<'info>,
}

pub fn update_max_voter_weight_record(
    ctx: Context<UpdateMaxVoterWeightRecord>,
    max_voter_weight: u64,
) -> Result<()> {
    let governance_program_id = ctx.accounts.registrar.governance_program_id;
    let governing_token_mint = ctx.accounts.registrar.governing_token_mint;

    let realm_data = realm::get_realm_data_for_governing_token_mint(
        &governance_program_id,
        &ctx.accounts.realm,
        &governing_token_mint,
    )?;

    require_eq!(
        realm_data.authority.unwrap(),
        ctx.accounts.realm_authority.key(),
        IamVoterError::InvalidRealmAuthority
    );

    let record = &mut ctx.accounts.max_voter_weight_record;
    record.max_voter_weight = max_voter_weight;
    record.max_voter_weight_expiry = None; // never expires, admin-managed

    Ok(())
}
