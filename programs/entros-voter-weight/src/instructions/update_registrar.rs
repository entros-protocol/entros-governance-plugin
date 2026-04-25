use anchor_lang::prelude::*;
use spl_governance::state::realm;

use crate::error::IamVoterError;
use crate::state::Registrar;

#[derive(Accounts)]
pub struct UpdateRegistrar<'info> {
    #[account(
        mut,
        seeds = [b"registrar", registrar.realm.as_ref(), registrar.governing_token_mint.as_ref()],
        bump,
    )]
    pub registrar: Account<'info, Registrar>,

    /// CHECK: Validated via get_realm_data_for_governing_token_mint.
    #[account(constraint = realm.key() == registrar.realm)]
    pub realm: UncheckedAccount<'info>,

    /// Must be the realm's authority.
    pub realm_authority: Signer<'info>,
}

pub fn update_registrar(
    ctx: Context<UpdateRegistrar>,
    min_trust_score: u16,
    max_verification_age: i64,
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

    let registrar = &mut ctx.accounts.registrar;
    registrar.min_trust_score = min_trust_score;
    registrar.max_verification_age = max_verification_age;

    Ok(())
}
