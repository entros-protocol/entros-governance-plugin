# Realms Integration Walkthrough

How to add Entros behavioral verification to a Realms DAO on Solana.

---

## What this is

> **Optional behavioral gate that layers on top of existing voter weight plugins (token-voter, NFT-voter, quadratic). Catches automated voting bots and gives DAOs a privacy-preserving signal when they don't want to require KYC. One signal in a stack — not a replacement for tokenomics or community moderation.**

The Entros voter weight plugin is an spl-governance voter-weight addin. When a DAO configures it, every vote requires the voter to have a recently active Entros Anchor with a Trust Score above the DAO's threshold. It's designed to compose with token-voter, NFT-voter, quadratic voting, or any other voter weight plugin — not replace them.

---

## What it catches and what it doesn't

**Catches well:**
- Automated voting bots (no real human capture, fails Tier 1 acoustic checks + TTS detection + cross-modal coupling)
- Synthetic-voice attacks (TTS-driven scripts trying to vote at scale)
- Dormant wallets resurrected to vote (verification recency requirement)
- Wallet-rotation attacks at the bot level (per-wallet Trust Score must be earned over weeks)

**Catches imperfectly:**
- Coordinated humans creating multiple Sybil identities. A determined person can vary voice and motion across wallets. Each fake identity costs the attacker ~12 seconds of focused real-time per verification × weeks of sustained behavior to reach meaningful Trust Score, but the cost isn't infinite.

**Does not catch at all:**
- Token-based plutocracy (large holders dominating votes — that's tokenomics, use quadratic on top)
- Off-chain coordination / vote buying (social problem, not behavioral)
- Compromised wallets where the attacker has both the key AND the verified Anchor

This is why the plugin is positioned as additive. A DAO using only Entros has weaker protection than a DAO using token-voter + Entros + community moderation. Be honest about this with your members.

---

## Where Entros fits in the voter-weight-plugin stack

The standard Realms architecture lets you chain voter weight plugins. The recommended pattern:

```
                    Voter casts vote
                          │
                          ▼
       ┌─────────────────────────────────────────┐
       │  Layer 1: Economic stake                │
       │  token-voter or NFT-voter               │
       │  (proves skin in the game)              │
       └─────────────────────────────────────────┘
                          │
                          ▼
       ┌─────────────────────────────────────────┐
       │  Layer 2: Voting fairness (optional)    │
       │  quadratic-voter                        │
       │  (caps whale dominance)                 │
       └─────────────────────────────────────────┘
                          │
                          ▼
       ┌─────────────────────────────────────────┐
       │  Layer 3: Behavioral signal (Entros)    │
       │  entros-voter-weight                    │
       │  (proves recently active human)         │
       └─────────────────────────────────────────┘
                          │
                          ▼
                 Vote accepted by realm
```

Entros sits at Layer 3. It does NOT replace token holdings, NFT membership, or quadratic weighting. It's a final liveness gate that can be added on top.

For DAOs that already require KYC (Civic, Coinbase Verifications, etc.), Entros is redundant in most cases — KYC catches what Entros catches plus more. **Entros is the primitive for DAOs that explicitly do not want KYC** but still want some bot-resistance signal.

---

## When to use it

**Good fit:**
- Privacy-conscious DAOs that won't require government ID
- DAOs experiencing bot-vote noise on low-stakes proposals
- Token-gated DAOs where the cost of buying tokens is low (cheap Sybil = vote farms)
- DAOs that want a "verified human" badge visible in their UI

**Marginal fit:**
- DAOs with strict KYC already in place (redundant)
- Treasury-control DAOs (need stronger gates than behavioral biometrics — combine with multi-sig + KYC)
- Single-vote-per-month DAOs (recency requirement is friction without much benefit)

**Bad fit:**
- DAOs targeting maximum participation (Entros adds 12s of friction per voting session)
- DAOs where members are pseudonymous developers with strong reputation already established (community trust does the work)

---

## Integration steps

### Prerequisites

- A Realms DAO created on `app.realms.today` (devnet or mainnet)
- DAO admin access (community mint authority)
- Realms V2 UI compatibility (custom voting program field is supported by default)

### Step 1: Configure the custom voting program

In your Realm's settings on `app.realms.today`:

1. Navigate to your Realm → Settings → Realm Settings
2. Find "Custom voting program ID" (under voter weight configuration)
3. Paste the Entros voter weight program ID:
   - **Devnet:** `99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534`
   - **Mainnet:** *(post-mainnet-launch)*
4. Save the configuration

The Realm now expects all voter weight calculations to come from the Entros plugin.

> **UI version note:** the exact menu path can drift between Realms releases. If you can't find "Custom voting program ID" under Settings → Realm Settings, check Settings → Advanced. Refer to current Realms documentation if neither location matches your installation.

### Step 2: Create the registrar (DAO admin, one-time)

The registrar holds the DAO's policy configuration: what minimum Trust Score is required, how recent the verification must be.

Call `create_registrar` (via Anchor client or the plugin's helper script) with:

| Parameter | Recommended starting value | Rationale |
|---|---|---|
| `min_trust_score` | `100` | Excludes brand-new identities, requires ~2-4 weeks of sustained verifications |
| `max_verification_age` | `86400` (24h) | Voter must have verified in the last day; balances UX with bot-staleness |
| `realm` | Your Realm's pubkey | Binds the registrar to this specific DAO |

```typescript
// Example using @coral-xyz/anchor
await program.methods
  .createRegistrar(100, new BN(86400))
  .accounts({
    realm: realmPubkey,
    realmAuthority: realmAuthority.publicKey,
    governingTokenMint: communityMint,
    registrar: registrarPda,
    payer: realmAuthority.publicKey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### Step 3: Voters initialize their voter weight records

Each member who wants to vote needs a one-time `create_voter_weight_record` call. This is typically wrapped in a "Connect Wallet → Verify with Entros" flow on the DAO's frontend, or members can do it from a CLI helper.

```typescript
await program.methods
  .createVoterWeightRecord()
  .accounts({
    registrar: registrarPda,
    voterWeightRecord: voterWeightRecordPda,
    governingTokenOwner: voterPubkey,
    payer: voterPubkey,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

Records are "born expired" — they need an `update_voter_weight_record` call before each vote.

### Step 4: Per-vote update (happens transparently in the same transaction)

When a member casts a vote on the Realms UI, the wallet bundles `update_voter_weight_record` immediately before the governance instruction. The plugin reads the voter's Entros IdentityState PDA, validates Trust Score and recency, and sets `voter_weight = 1` with a ~40-second expiry. The governance program then accepts the vote.

If the voter doesn't meet the threshold:
- Trust Score below `min_trust_score` → `voter_weight = 0` → vote silently has no effect
- Verification older than `max_verification_age` → same outcome
- No Entros Anchor exists → same outcome

### Step 5 (recommended): Stack with token-voter

Most production deployments will NOT use Entros alone. The standard pattern is:

```
Realm config:
  community voter weight: token-voter (proves token holdings)
  voter weight addin: entros-voter-weight (proves liveness)
```

Realms supports this via plugin chaining. The economic stake comes from token-voter, the liveness gate comes from Entros. Either alone is weaker than both.

---

## Configuration tuning

| Use case | min_trust_score | max_verification_age | Stack with |
|---|---|---|---|
| Casual community voting | 50 | 7 days (604800s) | token-voter |
| Standard governance | 100 | 24h (86400s) | token-voter |
| Treasury proposals | 250 | 6h (21600s) | token-voter + multi-sig |
| Constitution amendments | 500 | 1h (3600s) | token-voter + KYC |
| Anti-Sybil airdrops via on-chain vote | 100 | 24h | token-voter + quadratic-voter |

These are starting points. Tune based on your member base's verification cadence.

---

## Stacking patterns

### Pattern 1: token-voter + Entros (most common)

DAO requires both token holdings AND a recently verified human Anchor. Voter weight = token amount × (Entros pass: 1 / Entros fail: 0). Effectively gates token-weighted voting on liveness.

### Pattern 2: NFT-voter + Entros

DAO requires a membership NFT AND a recently verified human Anchor. Useful for DAOs where membership is binary (you have the NFT or you don't) and Entros adds the bot filter.

### Pattern 3: quadratic + Entros

DAO uses quadratic voting (sqrt of tokens) AND Entros gating. Caps both whale dominance and bot dominance simultaneously.

### Pattern 4: Entros only (rare, low-stakes only)

For DAOs where membership is open and the only gate is "are you a recently verified human." Useful for community polling or sentiment proposals where economic stake doesn't apply. Not recommended for any vote that controls real value.

---

## Gotchas

1. **Voter weight expires fast (~40 seconds).** This is intentional — prevents stale weight records being reused — but means the wallet must call `update_voter_weight_record` and the governance instruction in the same transaction. The Realms UI handles this automatically; custom integrations need to bundle them.

2. **Entros IdentityState PDA must exist.** Voters who haven't completed at least one Entros verification on `entros.io/verify` will fail the gate silently. Surface a clear "Verify your humanness with Entros" CTA in your DAO's UI before showing the vote button.

3. **Trust Score takes time to grow.** A brand-new identity starts at Trust Score 0. The default `min_trust_score=100` requires ~2-4 weeks of sustained weekly verifications. For DAOs with new members or short voting windows, consider a lower threshold initially.

4. **Devnet vs mainnet PDAs.** The Entros IdentityState PDA seed is wallet-specific but program-id-specific. A user verified on devnet does NOT automatically have a mainnet anchor (and vice versa). DAOs operating on mainnet need members to verify on mainnet specifically.

5. **No CPI fallback to entros-anchor.** The plugin reads the IdentityState PDA via raw byte deserialization, not Anchor cross-program-invocation. This is intentional (avoids version-coupling) but means if Entros's account layout changes incompatibly in the future, the plugin must be redeployed. Watch the Entros AUDIT.md for layout changes.

6. **Recency window vs UX friction.** Tight recency (6h) means members must verify before each voting session — high friction. Loose recency (7 days) lets stale verifications pass — lower bot-resistance. There's no universally right answer; tune to your DAO's voting cadence.

---

## Reference deployment

| Field | Value |
|---|---|
| Devnet program ID | `99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534` |
| Mainnet program ID | *(pending mainnet launch)* |
| Source | https://github.com/entros-protocol/entros-governance-plugin |
| Tests | 38 (20 unit + 18 integration against real spl-governance + entros-anchor genesis programs) |
| Realms UI | V2 supports custom voting program ID natively, no fork needed |

---

## Pre-launch checklist

Before you flip the plugin on for production governance:

- [ ] Test the full vote flow on devnet with at least 2 verified wallets and 1 unverified wallet (verify the unverified wallet's vote silently fails)
- [ ] Document the verification step in your DAO's onboarding docs (link to `entros.io/verify`)
- [ ] Decide your `min_trust_score` and `max_verification_age` and document the rationale for members
- [ ] Decide your stacking pattern (token-voter + Entros, NFT-voter + Entros, etc.) and configure accordingly
- [ ] Have a fallback plan if the Entros validator service is degraded (members can't verify → can they still vote?)
- [ ] Brief your member base on what Entros catches and doesn't catch — be honest about the limits

---

## Support

- Open an issue at https://github.com/entros-protocol/entros-governance-plugin/issues
- Reach out via the Entros Protocol Discord (link on entros.io)
- For threat-model and security questions: see https://entros.io/security

---

## License

MIT (consistent with the rest of the Entros Protocol stack).
