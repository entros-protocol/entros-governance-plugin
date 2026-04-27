/**
 * Generates pre-serialized IdentityState account fixtures for integration tests.
 *
 * Creates two test voter accounts:
 * - VOTER_A: trust_score=200 (passes min_trust_score=100)
 * - VOTER_B: trust_score=50 (fails min_trust_score=100)
 *
 * Outputs JSON files that the Anchor test validator loads via [[test.validator.account]].
 *
 * Usage: npx tsx scripts/generate-test-fixtures.ts
 */

import { Keypair, PublicKey } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const ENTROS_ANCHOR_PROGRAM_ID = new PublicKey(
  "GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2"
);

// Deterministic test keypairs (generated once, hardcoded for reproducibility)
// VOTER_A: high trust score (200)
const VOTER_A_SECRET = new Uint8Array([
  176,171,215,96,83,161,231,229,103,176,227,100,38,79,206,50,
  203,76,176,209,107,97,246,126,238,162,159,213,173,119,40,108,
  49,143,213,97,153,225,182,193,75,95,250,131,152,21,82,239,
  241,194,146,251,64,97,224,172,235,104,14,73,218,231,19,15,
]);

// VOTER_B: low trust score (50)
const VOTER_B_SECRET = new Uint8Array([
  84,94,164,12,45,138,92,108,91,174,39,105,154,110,64,182,
  100,253,150,41,226,243,8,8,59,121,56,53,141,28,180,19,
  94,96,206,206,67,214,1,76,103,202,1,217,194,143,42,124,
  60,233,160,57,79,217,12,116,14,199,224,122,17,244,146,232,
]);

const IDENTITY_STATE_DISCRIMINATOR = Buffer.from([
  156, 32, 87, 93, 52, 155, 248, 207,
]);

const IDENTITY_STATE_SIZE = 207;

function buildIdentityStateData(
  owner: PublicKey,
  trustScore: number,
  lastVerificationTimestamp: number,
): Buffer {
  const data = Buffer.alloc(IDENTITY_STATE_SIZE);
  let offset = 0;

  // discriminator (8)
  IDENTITY_STATE_DISCRIMINATOR.copy(data, offset);
  offset += 8;

  // owner (32)
  owner.toBuffer().copy(data, offset);
  offset += 32;

  // creation_timestamp (i64 LE)
  data.writeBigInt64LE(BigInt(lastVerificationTimestamp - 86400), offset);
  offset += 8;

  // last_verification_timestamp (i64 LE)
  data.writeBigInt64LE(BigInt(lastVerificationTimestamp), offset);
  offset += 8;

  // verification_count (u32 LE)
  data.writeUInt32LE(trustScore > 0 ? trustScore / 100 : 0, offset);
  offset += 4;

  // trust_score (u16 LE)
  data.writeUInt16LE(trustScore, offset);
  offset += 2;

  // remaining fields (commitment, mint, bump, recent_timestamps) -- zero-filled
  return data;
}

function writeFixture(
  filepath: string,
  pubkey: PublicKey,
  data: Buffer,
  owner: PublicKey,
) {
  // Format expected by `solana-test-validator --account`
  const fixture = {
    pubkey: pubkey.toBase58(),
    account: {
      lamports: 2039280,
      data: [data.toString("base64"), "base64"],
      owner: owner.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: data.length,
    },
  };
  fs.writeFileSync(filepath, JSON.stringify(fixture, null, 2));
}

function main() {
  const voterA = Keypair.fromSecretKey(VOTER_A_SECRET);
  const voterB = Keypair.fromSecretKey(VOTER_B_SECRET);

  console.log("VOTER_A pubkey:", voterA.publicKey.toBase58());
  console.log("VOTER_B pubkey:", voterB.publicKey.toBase58());

  // Compute IdentityState PDAs
  const [pdaA] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity"), voterA.publicKey.toBuffer()],
    ENTROS_ANCHOR_PROGRAM_ID,
  );
  const [pdaB] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity"), voterB.publicKey.toBuffer()],
    ENTROS_ANCHOR_PROGRAM_ID,
  );

  console.log("VOTER_A IdentityState PDA:", pdaA.toBase58());
  console.log("VOTER_B IdentityState PDA:", pdaB.toBase58());

  // Build account data
  // last_verification_timestamp = 1700000000 (Nov 2023)
  // With max_verification_age = 2000000000, this passes until year 2086
  const dataA = buildIdentityStateData(voterA.publicKey, 200, 1700000000);
  const dataB = buildIdentityStateData(voterB.publicKey, 50, 1700000000);

  // Write fixtures
  const fixturesDir = path.resolve(__dirname, "../tests/fixtures");
  writeFixture(
    path.join(fixturesDir, "identity-state-a.json"),
    pdaA,
    dataA,
    ENTROS_ANCHOR_PROGRAM_ID,
  );
  writeFixture(
    path.join(fixturesDir, "identity-state-b.json"),
    pdaB,
    dataB,
    ENTROS_ANCHOR_PROGRAM_ID,
  );

  console.log("\nFixtures written to tests/fixtures/");
  console.log("\nAdd to Anchor.toml:");
  console.log(`[[test.validator.account]]`);
  console.log(`address = "${pdaA.toBase58()}"`);
  console.log(`filename = "tests/fixtures/identity-state-a.json"`);
  console.log();
  console.log(`[[test.validator.account]]`);
  console.log(`address = "${pdaB.toBase58()}"`);
  console.log(`filename = "tests/fixtures/identity-state-b.json"`);
}

main();
