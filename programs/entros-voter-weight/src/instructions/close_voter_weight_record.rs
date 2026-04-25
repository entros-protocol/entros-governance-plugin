use anchor_lang::prelude::*;

use crate::error::IamVoterError;
use crate::state::*;

#[derive(Accounts)]
pub struct CloseVoterWeightRecord<'info> {
    #[account(
        seeds = [b"registrar", registrar.realm.as_ref(), registrar.governing_token_mint.as_ref()],
        bump,
    )]
    pub registrar: Account<'info, Registrar>,

    #[account(
        mut,
        close = sol_destination,
        constraint = voter_weight_record.realm == registrar.realm
            @ IamVoterError::VoterWeightRecordRealmMismatch,
        constraint = voter_weight_record.governing_token_mint == registrar.governing_token_mint
            @ IamVoterError::VoterWeightRecordMintMismatch,
    )]
    pub voter_weight_record: Account<'info, VoterWeightRecord>,

    /// The voter who owns this record. Must sign to authorize closure.
    pub voter_authority: Signer<'info>,

    /// CHECK: Receives the lamports from the closed account.
    #[account(mut)]
    pub sol_destination: AccountInfo<'info>,
}

pub fn close_voter_weight_record(ctx: Context<CloseVoterWeightRecord>) -> Result<()> {
    require!(
        ctx.accounts.voter_weight_record.governing_token_owner
            == ctx.accounts.voter_authority.key(),
        IamVoterError::VoterWeightRecordOwnerMismatch
    );

    Ok(())
}
