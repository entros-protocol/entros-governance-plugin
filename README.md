# Entros Voter Weight Plugin

SPL Governance voter weight plugin for [Entros Protocol](https://entros.io).

## What it is

This repository contains an on-chain voter-weight addin deployed on Solana devnet. It checks an Entros Anchor's Trust Score and verification recency to grant one eligible wallet, one vote.

This repository also contains a TypeScript Realms consumer client (`tests/realms-consumer-client.ts`) and localnet harness (`tests/realms-consumer-harness.ts`). Realms UI registration and plugin chaining remain planned work. The current repository is not a turnkey Realms UI integration.

## Security boundary

The program does not detect automation or synthetic media. It reads an existing Entros `IdentityState` account and applies configured eligibility rules.

The private Entros validator decides whether a verification passes. The program trusts the resulting Anchor state and does not reproduce those checks on-chain.

The addin does not prevent vote buying, wallet compromise, or token concentration. DAOs must combine it with their own governance controls.

See [`docs/REALMS-INTEGRATION-WALKTHROUGH.md`](docs/REALMS-INTEGRATION-WALKTHROUGH.md) for the current program boundary and planned Realms integration.

## Where it fits

The deployed program produces binary voter weight (`1`) for an eligible Entros Anchor. The TypeScript consumer client checks eligibility off-chain and composes atomic governance transactions.

Future chaining can combine Entros eligibility with another voter-weight source. The current registrar and update instruction do not accept a predecessor plugin record.

## How it works

1. DAO admin calls `create_registrar` with a minimum Trust Score and maximum verification age.
2. Consumer client calls `preflightVoterEligibility` to verify `Registrar`, `VoterWeightRecord`, `IdentityState`, `MigrationRecord`, and proposal voting state before wallet signing.
3. Consumer client calls `buildAtomicGovernanceTransaction` to bundle optional `create_voter_weight_record`, `update_voter_weight_record_for_action`, and the `spl-governance` instruction into one transaction.
4. On-chain program validates Trust Score, verification recency, and migration rules, then writes `voter_weight = 1` with current-slot expiry (`Some(clock.slot)`).
5. SPL Governance consumes the updated `VoterWeightRecord` in the same transaction.

The update and the governance action share one transaction, because the record does not outlive its slot.

Ineligible updates return an error. They do not write a zero-weight record.

## Realms consumer client and harness

`tests/realms-consumer-client.ts` exports PDA helpers, account parsers, `preflightVoterEligibility`, and `buildAtomicGovernanceTransaction` for SPL Governance consumers.

`preflightVoterEligibility` reads `Registrar`, `VoterWeightRecord`, `IdentityState`, `MigrationRecord`, and `Proposal` accounts before requesting a wallet signature. For `CastVote`, it enforces strict `migratedSlot < votingAtSlot` against the proposal's `voting_at_slot`. It returns a typed eligibility result with `needsCreateVwr` or an explicit refusal reason.

`buildAtomicGovernanceTransaction` prepends `create_voter_weight_record` when `VoterWeightRecord` is absent. It appends `update_voter_weight_record_for_action` with the required remaining accounts and the consuming `spl-governance` instruction in one atomic transaction.

`tests/realms-consumer-harness.ts` tests the consumer client with unit checks and live localnet transactions against `spl_governance.so`, `entros_anchor.so`, and `entros_voter_weight.so`. It verifies cold and warm voters, pre-voting and post-voting migrations, stale or low-score refusals, action and target mismatches, and cross-slot expiry.

`scripts/test-devnet.ts` runs the action-bound consumer flow on devnet and supports read-only `PREFLIGHT_ONLY=1` checks against an existing devnet Realm.

## One vote per identity

An Entros identity can move to a new wallet and keep its Trust Score. The Entros Anchor program records the slot of each move in a migration record PDA with the seeds `["migration", wallet]`. The plugin reads that record, so an identity counts once on a proposal.

- A wallet with no migration record votes on any proposal.
- A wallet with a migration record votes on a proposal that entered voting after the identity arrived.
- A wallet with a migration record cannot vote on a proposal that was in voting when the identity arrived. This holds even if the previous wallet cast no vote.
- A wallet with a migration record uses `update_voter_weight_record_for_action`. The general update refuses it.
- A migration record is permanent. A later migration to the same wallet overwrites it, so the general update stays refused for that wallet.

Each update reads its evidence from the remaining accounts, in this order:

| Update | Remaining accounts |
|--------|--------------------|
| `update_voter_weight_record` | IdentityState PDA, migration record PDA |
| `update_voter_weight_record_for_action` with `CastVote` | IdentityState PDA, migration record PDA, proposal |
| `update_voter_weight_record_for_action` with another action | IdentityState PDA |

Pass the migration record address even when no account exists there. The proposal account must equal the action target.

## Instructions

| Instruction | Purpose |
|-------------|---------|
| `create_registrar` | DAO admin configures min Trust Score and max verification age |
| `update_registrar` | DAO admin updates configuration parameters |
| `close_registrar` | DAO admin closes the registrar and reclaims rent |
| `create_voter_weight_record` | Initialize a voter's weight record (born expired) |
| `update_voter_weight_record` | Read Entros IdentityState, validate trust score and recency, set voter_weight = 1 for any action in the current slot |
| `update_voter_weight_record_for_action` | The same checks, with the weight bound to one governance action and its target |
| `close_voter_weight_record` | Voter closes their record and reclaims rent |
| `create_max_voter_weight_record` | DAO admin initializes quorum tracking (realm authority required) |
| `update_max_voter_weight_record` | DAO admin sets the max voter weight (never expires, admin-managed) |

## Architecture

```
Voter wants to cast a vote
    → calls update_voter_weight_record_for_action(CastVote, proposal)
    → plugin reads Entros IdentityState PDA (cross-program, no CPI)
    → checks trust_score >= min_trust_score
    → checks verification age < max_verification_age
    → reads the migration record PDA and, if one exists, the proposal's voting start slot
    → sets voter_weight = 1, expiry = current_slot, bound to CastVote and the proposal
    → the vote instruction follows in the same transaction
```

The plugin reads the Entros IdentityState and migration record accounts via raw byte deserialization (not Anchor CPI) to avoid version coupling with the Entros Anchor program.

## Program ID

**Devnet:** `99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534`

## Build

```bash
anchor build --no-idl -- -- --locked
anchor build
```

Requires:
- Anchor 0.32.1
- Solana CLI 2.2.1
- Rust 1.91.0
- Node.js 24.22.1
- npm 11.19.1

## Test

```bash
npm ci
npm run typecheck
npm run fixtures:verify
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
anchor build --no-idl -- -- --locked
anchor build
npm run test:localnet
```

The localnet command loads the declared programs and account fixtures into an isolated ledger. It refuses occupied test ports and removes its ledger when complete.

Run `npm run fixtures:generate` only when the committed account fixtures need an intentional update. `npm run fixtures:verify` checks their hashes and reproducibility.

97 tests: 10 Rust unit tests, 38 TypeScript unit tests, and 49 integration tests.

## Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| anchor-lang | 0.32.1 | Anchor framework |
| spl-governance-mythic | 3.1.2 | Realm data validation |
| spl-governance-addin-api-mythic | 0.1.6 | VoterWeightRecord type |
| solana-program | 2.2.1 | Solana runtime |

## Realms integration status

The on-chain addin is deployed on devnet. `tests/realms-consumer-client.ts` provides standalone pre-flight checks and atomic transaction builders. `tests/realms-consumer-harness.ts` verifies both on localnet.

This repository does not register a Realms UI plugin. Plugin chaining also requires registrar and instruction changes before it can ship.

## Related

- [Entros Protocol](https://entros.io) - behavioral verification research on Solana
- [Pulse SDK](https://www.npmjs.com/package/@entros/pulse-sdk) - client-side verification SDK
- [Protocol Core](https://github.com/entros-protocol/protocol-core) - on-chain identity programs
- [Governance Program Library](https://github.com/Mythic-Project/governance-program-library) - reference voter-weight plugins

## License

MIT
