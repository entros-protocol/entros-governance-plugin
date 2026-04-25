use anchor_lang::prelude::*;
use spl_governance::state::realm;

use crate::error::IamVoterError;
use crate::state::*;

#[derive(Accounts)]
pub struct CreateMaxVoterWeightRecord<'info> {
    #[account(
        seeds = [b"registrar", registrar.realm.as_ref(), registrar.governing_token_mint.as_ref()],
        bump,
    )]
    pub registrar: Account<'info, Registrar>,

    #[account(
        init,
        seeds = [
            b"max-voter-weight-record",
            registrar.realm.as_ref(),
            registrar.governing_token_mint.as_ref(),
        ],
        bump,
        payer = payer,
        space = MaxVoterWeightRecord::get_space(),
    )]
    pub max_voter_weight_record: Account<'info, MaxVoterWeightRecord>,

    /// CHECK: Validated via get_realm_data_for_governing_token_mint.
    #[account(constraint = realm.key() == registrar.realm)]
    pub realm: UncheckedAccount<'info>,

    /// Must be the realm's authority.
    pub realm_authority: Signer<'info>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_max_voter_weight_record(
    ctx: Context<CreateMaxVoterWeightRecord>,
) -> Result<()> {
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

    let record = &mut ctx.accounts.max_voter_weight_record;
    record.account_discriminator =
        spl_governance_addin_api::max_voter_weight::MaxVoterWeightRecord::ACCOUNT_DISCRIMINATOR;
    record.realm = registrar.realm;
    record.governing_token_mint = registrar.governing_token_mint;
    record.max_voter_weight = 0;
    record.max_voter_weight_expiry = Some(0);

    Ok(())
}
