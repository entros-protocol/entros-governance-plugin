use anchor_lang::prelude::*;
use spl_governance::state::realm;

use crate::error::IamVoterError;
use crate::state::Registrar;

#[derive(Accounts)]
pub struct CreateRegistrar<'info> {
    #[account(
        init,
        seeds = [b"registrar", realm.key().as_ref(), governing_token_mint.key().as_ref()],
        bump,
        payer = payer,
        space = Registrar::LEN,
    )]
    pub registrar: Account<'info, Registrar>,

    /// CHECK: Can be any spl-governance instance. Validated as executable.
    #[account(executable)]
    pub governance_program_id: UncheckedAccount<'info>,

    /// CHECK: Owned by governance_program_id. Validated via get_realm_data_for_governing_token_mint.
    #[account(owner = governance_program_id.key())]
    pub realm: UncheckedAccount<'info>,

    /// CHECK: Validated by get_realm_data_for_governing_token_mint.
    pub governing_token_mint: UncheckedAccount<'info>,

    /// Must be the realm's authority.
    pub realm_authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_registrar(
    ctx: Context<CreateRegistrar>,
    min_trust_score: u16,
    max_verification_age: i64,
) -> Result<()> {
    let governance_program_id = ctx.accounts.governance_program_id.key();
    let realm_key = ctx.accounts.realm.key();
    let governing_token_mint = ctx.accounts.governing_token_mint.key();

    // Validate realm belongs to the governance program and the mint is configured
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
    registrar.governance_program_id = governance_program_id;
    registrar.realm = realm_key;
    registrar.governing_token_mint = governing_token_mint;
    registrar.min_trust_score = min_trust_score;
    registrar.max_verification_age = max_verification_age;

    Ok(())
}
