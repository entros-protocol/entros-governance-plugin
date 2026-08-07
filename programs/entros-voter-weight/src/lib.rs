#![allow(unexpected_cfgs)] // Anchor emits SBF-only cfg values during host builds.

use anchor_lang::prelude::*;

pub mod error;
#[macro_use]
mod governance;
mod instructions;
pub mod state;

use instructions::*;

declare_id!("99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534");

#[program]
pub mod entros_voter_weight {
    use super::*;

    pub fn create_registrar(
        ctx: Context<CreateRegistrar>,
        min_trust_score: u16,
        max_verification_age: i64,
    ) -> Result<()> {
        instructions::create_registrar::create_registrar(ctx, min_trust_score, max_verification_age)
    }

    pub fn update_registrar(
        ctx: Context<UpdateRegistrar>,
        min_trust_score: u16,
        max_verification_age: i64,
    ) -> Result<()> {
        instructions::update_registrar::update_registrar(ctx, min_trust_score, max_verification_age)
    }

    pub fn create_voter_weight_record(
        ctx: Context<CreateVoterWeightRecord>,
        governing_token_owner: Pubkey,
    ) -> Result<()> {
        instructions::create_voter_weight_record::create_voter_weight_record(
            ctx,
            governing_token_owner,
        )
    }

    pub fn update_voter_weight_record<'info>(
        ctx: Context<'_, '_, 'info, 'info, UpdateVoterWeightRecord<'info>>,
    ) -> Result<()> {
        instructions::update_voter_weight_record::update_voter_weight_record(ctx)
    }

    pub fn close_registrar(ctx: Context<CloseRegistrar>) -> Result<()> {
        instructions::close_registrar::close_registrar(ctx)
    }

    pub fn close_voter_weight_record(ctx: Context<CloseVoterWeightRecord>) -> Result<()> {
        instructions::close_voter_weight_record::close_voter_weight_record(ctx)
    }

    pub fn create_max_voter_weight_record(ctx: Context<CreateMaxVoterWeightRecord>) -> Result<()> {
        instructions::create_max_voter_weight_record::create_max_voter_weight_record(ctx)
    }

    pub fn update_max_voter_weight_record(
        ctx: Context<UpdateMaxVoterWeightRecord>,
        max_voter_weight: u64,
    ) -> Result<()> {
        instructions::update_max_voter_weight_record::update_max_voter_weight_record(
            ctx,
            max_voter_weight,
        )
    }
}
