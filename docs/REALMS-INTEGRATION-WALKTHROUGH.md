# Realms integration status and plan

The Entros voter-weight addin is deployed on Solana devnet. It is an on-chain prototype, not a turnkey Realms UI integration.

## Current on-chain behavior

The program stores one registrar for a realm and governing token mint. The realm authority configures minimum Trust Score and maximum verification age.

A voter creates a `VoterWeightRecord` for their wallet. Before a governance action, the voter can request a record update.

The update reads the wallet's Entros `IdentityState` account. It checks the account owner, discriminator, wallet binding, Trust Score, and verification recency.

Both `update_voter_weight_record` and `update_voter_weight_record_for_action` grant one eligible wallet, one vote (`voter_weight = 1`) with current-slot expiry (`Some(clock.slot)`). The action-bound update also binds `weight_action` and `weight_action_target` for same-transaction settlement. An ineligible update returns an error and writes no zero-weight record.

A standalone update and a vote update also read the voter's migration record. A wallet that received a migrated identity votes only on a proposal that entered voting after the identity arrived, and it uses the action-bound update. The README lists the accounts for each update.

The program does not run behavioral checks. It trusts the Anchor state produced by the wider Entros verification flow.

## Atomic consumer client and harness

`tests/realms-consumer-client.ts` validates voter eligibility off-chain and composes atomic transactions for SPL Governance consumers.

`preflightVoterEligibility` inspects `Registrar`, `VoterWeightRecord`, `IdentityState`, `MigrationRecord`, and `Proposal` accounts before wallet signing. For `CastVote`, it checks strict `migratedSlot < votingAtSlot` against the proposal's `voting_at_slot`. It reports `needsCreateVwr` when the voter lacks a `VoterWeightRecord`, or returns a typed refusal reason.

`buildAtomicGovernanceTransaction` bundles optional `create_voter_weight_record`, `update_voter_weight_record_for_action`, and the consuming `spl-governance` instruction into one transaction. For `CastVote`, it appends `IdentityState`, `MigrationRecord`, and `Proposal` as remaining accounts. For other actions, it appends `IdentityState` alone.

`tests/realms-consumer-harness.ts` exercises the client with 17 unit tests and 10 live localnet tests against `spl_governance.so`, `entros_anchor.so`, and `entros_voter_weight.so`. The harness covers cold and warm voters, pre-voting and post-voting migrations, stale and low-score rejections, wrong action or target bindings, and cross-slot expiry.

## Current limitations

Normal Realms UI execution requires registering a client package with the Realms UI plugin interface. This repository does not register a Realms UI plugin yet.

The current registrar stores no predecessor plugin ID. The update instruction accepts no input voter-weight record.

The program therefore cannot chain with token, NFT, or quadratic voter-weight plugins today. Composition remains planned work.

Only the devnet program is deployed:

```text
99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534
```

There is no Entros mainnet deployment.

## Intended integration

The repository consumer client (`tests/realms-consumer-client.ts`) already derives PDAs, creates missing voter-weight records, prepends `update_voter_weight_record_for_action`, and surfaces eligibility errors before wallet signing.

Complete these steps before enabling normal Realms UI integration:

1. Package the client against the current program IDL.
2. Derive the cluster from the active Realms UI connection.
3. Register the client with the supported Realms UI plugin interface.

The planned chaining extension will:

1. Add an optional predecessor program ID to the registrar.
2. Accept and validate the predecessor `VoterWeightRecord`.
3. Preserve the predecessor weight after Entros eligibility passes.
4. Reject mismatched realm, mint, owner, action, or expiry fields.
5. Test token, NFT, and quadratic composition paths.

This design keeps Entros as an eligibility gate. It does not replace economic or membership weight.

## Manual program testing

Use the repository integration suite to test the deployed account model locally:

```bash
npm ci
npm run fixtures:verify
anchor build --no-idl -- -- --locked
anchor build
npm run test:localnet
```

The localnet command starts the validator, loads the declared fixtures, runs the tests, and stops the validator.

The current suite contains 97 tests: 10 Rust unit tests, 38 TypeScript unit tests, and 49 localnet integration tests.

Run `PREFLIGHT_ONLY=1 REALM=<realm> MINT=<mint> npm run test:devnet` for a read-only devnet eligibility check.

With a funded verified devnet keypair, run `npm run test:devnet` to test atomic `CreateProposal` and `CastVote` flows.

## DAO policy choices

A future integrator must choose a minimum Trust Score and verification-age limit. Those values are governance policy, not protocol defaults.

Short recency windows add user friction. High Trust Score floors exclude new Anchors. Test both with representative members before enabling a governance gate.

Entros eligibility does not prevent wallet compromise, vote buying, or token concentration. DAOs must retain controls for those risks.

## Release gate

Do not describe the addin as supported by the normal Realms UI until all items below pass:

- The client package builds against the current program IDL.
- The Realms UI registration is accepted and verified.
- One complete devnet vote succeeds through the normal UI.
- An ineligible Anchor returns a clear pre-transaction error.
- Chaining tests preserve the predecessor weight.
- The Realms client prepends `update_voter_weight_record_for_action` in the same transaction as the governance action.
- Public docs match the deployed cluster and client behavior.

## Support

Open an issue at <https://github.com/entros-protocol/entros-governance-plugin/issues>.

Security reports must follow the repository `SECURITY.md` process.

## License

MIT.
