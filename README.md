# Entros Voter Weight Plugin

SPL Governance voter weight plugin for [Entros Protocol](https://entros.io).

## What it is

This repository contains an on-chain voter-weight addin deployed on Solana devnet. It checks an Entros Anchor's Trust Score and verification recency.

Realms client registration, automatic transaction construction, and plugin chaining remain planned work. The current program is not a turnkey Realms UI integration.

## Security boundary

The program does not detect automation or synthetic media. It reads an existing Entros `IdentityState` account and applies configured eligibility rules.

The private Entros validator decides whether a verification passes. The program trusts the resulting Anchor state and does not reproduce those checks on-chain.

The addin does not prevent vote buying, wallet compromise, or token concentration. DAOs must combine it with their own governance controls.

See [`docs/REALMS-INTEGRATION-WALKTHROUGH.md`](docs/REALMS-INTEGRATION-WALKTHROUGH.md) for the current program boundary and planned Realms integration.

## Where it fits

The deployed program can produce binary voter weight for an eligible Entros Anchor. A future Realms client can compose that check into governance transactions.

Future chaining can combine Entros eligibility with another voter-weight source. The current registrar and update instruction do not accept a predecessor plugin record.

## How it works

1. DAO admin calls `create_registrar` with a minimum Trust Score and maximum verification age
2. Each voter calls `create_voter_weight_record` to initialize their record
3. Before voting, the voter calls `update_voter_weight_record` which reads their Entros IdentityState PDA cross-program and checks:
   - Trust Score meets the DAO's configured floor
   - The latest verification timestamp falls inside the DAO's configured window
4. If both pass, the program sets `voter_weight` to `1` with a 100-slot expiry
5. A future client can include the record update in a governance transaction

The record expires after 100 slots. Active work will replace that fixed slot count with a duration-derived value.

Ineligible updates return an error. They do not write a zero-weight record.

## Instructions

| Instruction | Purpose |
|-------------|---------|
| `create_registrar` | DAO admin configures min Trust Score and max verification age |
| `update_registrar` | DAO admin updates configuration parameters |
| `close_registrar` | DAO admin closes the registrar and reclaims rent |
| `create_voter_weight_record` | Initialize a voter's weight record (born expired) |
| `update_voter_weight_record` | Read Entros IdentityState, validate trust score and recency, set voter_weight = 1 |
| `close_voter_weight_record` | Voter closes their record and reclaims rent |
| `create_max_voter_weight_record` | DAO admin initializes quorum tracking (realm authority required) |
| `update_max_voter_weight_record` | DAO admin sets the max voter weight (never expires, admin-managed) |

## Architecture

```
Voter wants to cast a vote
    → calls update_voter_weight_record
    → plugin reads Entros IdentityState PDA (cross-program, no CPI)
    → checks trust_score >= min_trust_score
    → checks verification age < max_verification_age
    → sets voter_weight = 1, expiry = current_slot + 100
    → a future Realms client includes the record in a governance action
```

The plugin reads the Entros IdentityState account via raw byte deserialization (not Anchor CPI) to avoid version coupling with the Entros Anchor program.

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
- Node.js 24.15.0
- npm 11.12.1

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

39 tests: 20 unit tests and 19 integration tests.

## Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| anchor-lang | 0.32.1 | Anchor framework |
| spl-governance-mythic | 3.1.2 | Realm data validation |
| spl-governance-addin-api-mythic | 0.1.6 | VoterWeightRecord type |
| solana-program | 2.2.1 | Solana runtime |

## Realms integration status

The on-chain addin is deployed on devnet. Normal Realms UI execution also needs a registered JS client that constructs the required transactions.

That client is not present in this repository. Plugin chaining also requires registrar and instruction changes before it can ship.

## Related

- [Entros Protocol](https://entros.io) - behavioral verification research on Solana
- [Pulse SDK](https://www.npmjs.com/package/@entros/pulse-sdk) - client-side verification SDK
- [Protocol Core](https://github.com/entros-protocol/protocol-core) - on-chain identity programs
- [Governance Program Library](https://github.com/Mythic-Project/governance-program-library) - reference voter-weight plugins

## License

MIT
