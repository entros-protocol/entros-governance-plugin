use anchor_lang::prelude::*;

use crate::state::*;

#[derive(Accounts)]
#[instruction(governing_token_owner: Pubkey)]
pub struct CreateVoterWeightRecord<'info> {
    #[account(
        seeds = [b"registrar", registrar.realm.as_ref(), registrar.governing_token_mint.as_ref()],
        bump,
    )]
    pub registrar: Account<'info, Registrar>,

    #[account(
        init,
        seeds = [
            b"voter-weight-record",
            registrar.realm.as_ref(),
            registrar.governing_token_mint.as_ref(),
            governing_token_owner.as_ref(),
        ],
        bump,
        payer = payer,
        space = VoterWeightRecord::get_space(),
    )]
    pub voter_weight_record: Account<'info, VoterWeightRecord>,

    #[account(mut)]
    pub payer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn create_voter_weight_record(
    ctx: Context<CreateVoterWeightRecord>,
    governing_token_owner: Pubkey,
) -> Result<()> {
    let voter_weight_record = &mut ctx.accounts.voter_weight_record;
    let registrar = &ctx.accounts.registrar;

    voter_weight_record.account_discriminator =
        spl_governance_addin_api::voter_weight::VoterWeightRecord::ACCOUNT_DISCRIMINATOR;
    voter_weight_record.realm = registrar.realm;
    voter_weight_record.governing_token_mint = registrar.governing_token_mint;
    voter_weight_record.governing_token_owner = governing_token_owner;
    voter_weight_record.voter_weight = 0;
    voter_weight_record.voter_weight_expiry = Some(0);
    voter_weight_record.weight_action = None;
    voter_weight_record.weight_action_target = None;

    Ok(())
}
