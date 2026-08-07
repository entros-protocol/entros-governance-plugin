# Realms integration status and plan

The Entros voter-weight addin is deployed on Solana devnet. It is an on-chain prototype, not a turnkey Realms UI integration.

## Current on-chain behavior

The program stores one registrar for a realm and governing token mint. The realm authority configures minimum Trust Score and maximum verification age.

A voter creates a `VoterWeightRecord` for their wallet. Before a governance action, the voter can request a record update.

The update reads the wallet's Entros `IdentityState` account. It checks the account owner, discriminator, wallet binding, Trust Score, and verification recency.

An eligible update writes binary voter weight `1` with a 100-slot expiry. An ineligible update returns an error and writes no zero-weight record.

The program does not run behavioral checks. It trusts the Anchor state produced by the wider Entros verification flow.

## Current limitations

Normal Realms UI execution requires a JS client that constructs the addin instructions. This repository does not contain that client.

The current registrar stores no predecessor plugin ID. The update instruction accepts no input voter-weight record.

The program therefore cannot chain with token, NFT, or quadratic voter-weight plugins today. Composition remains planned work.

Only the devnet program is deployed:

```text
99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534
```

There is no Entros mainnet deployment.

## Intended integration

The planned Realms client will:

1. Derive the registrar and voter-weight record addresses.
2. Create missing voter-weight records.
3. Add `update_voter_weight_record` before the governance action.
4. Surface eligibility errors before wallet approval.
5. Derive its cluster from the active connection.
6. Register with the supported Realms UI plugin interface.

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
npx tsx scripts/generate-test-fixtures.ts
GOVERNANCE_TEST_LEDGER="$(mktemp -d /tmp/entros-governance.XXXXXX)"

solana-test-validator \
  --ledger "$GOVERNANCE_TEST_LEDGER" \
  --bpf-program 99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534 target/deploy/entros_voter_weight.so \
  --bpf-program GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2 tests/fixtures/entros_anchor.so \
  --bpf-program GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw tests/fixtures/spl_governance.so \
  --account 63cKuvoe9WuNH9Ds6aXF7iSc4jHmJc4ZkxdHTaitJ5tr tests/fixtures/identity-state-a.json \
  --account 73gAPp8WuNzdHh4E5ySQNFR3jpw8qs5YFaYPp8iyt6FZ tests/fixtures/identity-state-b.json \
  --account 6VdajMuuCa29fiXNysyyjkFCbuhFJHHhpWXSvyZW9JnP tests/fixtures/identity-state-c.json \
  --quiet
```

Run the test suite in another terminal:

```bash
npx ts-mocha -p ./tsconfig.json -t 120000 tests/**/*.ts
```

The current suite contains 20 unit tests and 19 integration tests.

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
- The 100-slot expiry is replaced with a duration-derived policy.
- Public docs match the deployed cluster and client behavior.

## Support

Open an issue at <https://github.com/entros-protocol/entros-governance-plugin/issues>.

Security reports must follow the repository `SECURITY.md` process.

## License

MIT.
