use anchor_lang::prelude::*;
use spl_governance::state::realm;

use crate::error::IamVoterError;
use crate::state::Registrar;

#[derive(Accounts)]
pub struct CloseRegistrar<'info> {
    #[account(
        mut,
        close = sol_destination,
        seeds = [b"registrar", registrar.realm.as_ref(), registrar.governing_token_mint.as_ref()],
        bump,
    )]
    pub registrar: Account<'info, Registrar>,

    /// CHECK: Validated via get_realm_data_for_governing_token_mint.
    #[account(constraint = realm.key() == registrar.realm)]
    pub realm: UncheckedAccount<'info>,

    /// Must be the realm's authority.
    pub realm_authority: Signer<'info>,

    /// CHECK: Receives the lamports from the closed account.
    #[account(mut)]
    pub sol_destination: AccountInfo<'info>,
}

pub fn close_registrar(ctx: Context<CloseRegistrar>) -> Result<()> {
    let registrar = &ctx.accounts.registrar;

    let realm_data = realm::get_realm_data_for_governing_token_mint(
        &registrar.governance_program_id,
        &ctx.accounts.realm,
        &registrar.governing_token_mint,
    )?;

    require_eq!(
        realm_data.authority.unwrap(),
        ctx.accounts.realm_authority.key(),
        IamVoterError::InvalidRealmAuthority
    );

    Ok(())
}
