# Entros Voter Weight Plugin

SPL Governance voter weight plugin for [Entros Protocol](https://entros.io).

## What it is

Optional behavioral gate that layers on top of existing voter weight plugins (token-voter, NFT-voter, quadratic). Catches automated voting bots and gives DAOs a privacy-preserving signal when they don't want to require KYC. One signal in a stack — not a replacement for tokenomics or community moderation.

## What it catches and what it doesn't

**Catches well:** automated voting bots, synthetic-voice attacks, dormant wallets resurrected to vote, wallet-rotation at the bot level.

**Catches imperfectly:** coordinated humans intentionally varying voice and motion across wallets. Cross-Anchor comparison is the layer that applies here, and its sensitivity is bounded by how much a person can vary their own behavioral signature. The per-Anchor cadence requirement means any identity that clears a meaningful Trust Score carries weeks of scored history behind it.

**Does not catch at all:** token-based plutocracy, off-chain coordination / vote buying, compromised wallets where the attacker has both the key and the verified Anchor.

This is why the plugin is positioned as additive. It is strongest stacked with token-voter and community moderation, each layer catching what the others miss. Full integration walkthrough including stacking patterns and configuration tuning: [`docs/REALMS-INTEGRATION-WALKTHROUGH.md`](docs/REALMS-INTEGRATION-WALKTHROUGH.md).

## Where it fits

DAOs on [Realms](https://app.realms.today) can configure this plugin so each vote requires the voter to have a recently active Entros Anchor with a Trust Score above a configurable threshold. Designed to chain with token-voter (proves token holdings AND liveness), NFT-voter (proves membership AND liveness), or quadratic voting (caps both whale and bot dominance simultaneously).

## How it works

1. DAO admin calls `create_registrar` with a minimum Trust Score and maximum verification age
2. Each voter calls `create_voter_weight_record` to initialize their record
3. Before voting, the voter calls `update_voter_weight_record` which reads their Entros IdentityState PDA cross-program and checks:
   - Trust Score >= minimum configured by the DAO (proves sustained behavioral history)
   - Last verification is recent enough (proves the human is actively engaged)
4. If both pass, voter_weight is set to 1 with a short expiry (~40 seconds)
5. The governance program reads the VoterWeightRecord and allows the vote

The voter weight expires after ~100 slots, forcing the update to happen in the same transaction as the governance action. This prevents stale weight records from being reused.

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
    → governance program reads VoterWeightRecord
    → vote is accepted
```

The plugin reads the Entros IdentityState account via raw byte deserialization (not Anchor CPI) to avoid version coupling with the Entros Anchor program.

## Program ID

**Devnet:** `99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534`

## Build

```bash
anchor build
```

Requires:
- Anchor 0.32.1
- Solana CLI 2.2.1
- Rust 1.91.0

## Test

```bash
# Generate test fixtures (one-time)
npx tsx scripts/generate-test-fixtures.ts

# Start local validator with genesis programs and fixture accounts
solana-test-validator \
  --bpf-program 99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534 target/deploy/entros_voter_weight.so \
  --bpf-program GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2 tests/fixtures/entros_anchor.so \
  --bpf-program GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw tests/fixtures/spl_governance.so \
  --account 63cKuvoe9WuNH9Ds6aXF7iSc4jHmJc4ZkxdHTaitJ5tr tests/fixtures/identity-state-a.json \
  --account 73gAPp8WuNzdHh4E5ySQNFR3jpw8qs5YFaYPp8iyt6FZ tests/fixtures/identity-state-b.json \
  --reset --quiet

# Run all tests (in a separate terminal)
npx ts-mocha -p ./tsconfig.json -t 120000 tests/**/*.ts
```

38 tests: 20 unit tests (byte layout, PDA derivation, validation logic) + 18 integration tests (real transactions against local validator with Entros Anchor and spl-governance loaded as genesis programs).

## Dependencies

| Crate | Version | Purpose |
|-------|---------|---------|
| anchor-lang | 0.32.1 | Anchor framework |
| spl-governance-mythic | 3.1.2 | Realm data validation |
| spl-governance-addin-api-mythic | 0.1.6 | VoterWeightRecord type |
| solana-program | 2.2.1 | Solana runtime |

## Realms UI Compatibility

The Realms V2 UI supports custom voter weight plugins. Any DAO admin can configure Entros as their voter weight addin by pasting the program ID (`99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534`) in the "Custom voting program ID" field in the realm settings. No frontend changes required.

## Related

- [Entros Protocol](https://entros.io) -- behavioral proof-of-personhood on Solana
- [Pulse SDK](https://www.npmjs.com/package/@entros/pulse-sdk) -- client-side verification SDK
- [Protocol Core](https://github.com/entros-protocol/protocol-core) -- on-chain identity programs
- [Governance Program Library](https://github.com/Mythic-Project/governance-program-library) -- reference voter weight plugins

## License

MIT
