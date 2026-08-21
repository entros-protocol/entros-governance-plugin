/**
 * Generates pre-serialized IdentityState account fixtures for integration tests.
 *
 * Creates three test voter accounts:
 * - VOTER_A: trust_score=200 (passes min_trust_score=100)
 * - VOTER_B: trust_score=50 (fails min_trust_score=100)
 * - VOTER_C: trust_score=200 but a wrong account discriminator. This exercises the
 *   discriminator type-confusion guard in update_voter_weight_record (owner + PDA
 *   pass; only the discriminator check rejects).
 *
 * Outputs JSON files that the Anchor test validator loads via [[test.validator.account]].
 *
 * Usage: npm run fixtures:generate
 * Usage with an isolated output: npm run fixtures:generate -- --output-dir <path>
 */

import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
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

// VOTER_C: high trust score (200), but its fixture carries a WRONG account
// discriminator. Owner + PDA pass; only the discriminator type-confusion guard
// in update_voter_weight_record rejects it.
const VOTER_C_SECRET = new Uint8Array([
  94,31,55,141,69,236,105,147,234,20,85,165,247,47,215,59,
  77,222,67,95,93,144,57,151,115,136,105,29,15,181,192,140,
  227,49,209,215,148,113,232,115,251,223,165,251,109,253,0,60,
  81,61,52,187,251,15,177,100,255,43,41,25,156,243,154,154,
]);

const IDENTITY_STATE_DISCRIMINATOR = Buffer.from([
  156, 32, 87, 93, 52, 155, 248, 207,
]);

// This discriminator represents another account type. The parser must reject it
// before reading fields at fixed offsets.
const WRONG_DISCRIMINATOR = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

const IDENTITY_STATE_SIZE = 207;

function buildIdentityStateData(
  owner: PublicKey,
  trustScore: number,
  lastVerificationTimestamp: number,
  discriminator: Buffer = IDENTITY_STATE_DISCRIMINATOR,
): Buffer {
  const data = Buffer.alloc(IDENTITY_STATE_SIZE);
  let offset = 0;

  // discriminator (8)
  discriminator.copy(data, offset);
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

function writeFundedWalletFixture(
  filepath: string,
  pubkey: PublicKey,
  lamports: number,
) {
  const fixture = {
    pubkey: pubkey.toBase58(),
    account: {
      lamports,
      data: ["", "base64"],
      owner: SystemProgram.programId.toBase58(),
      executable: false,
      rentEpoch: 0,
      space: 0,
    },
  };
  fs.writeFileSync(filepath, JSON.stringify(fixture, null, 2));
}

function identityPda(voter: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("identity"), voter.toBuffer()],
    ENTROS_ANCHOR_PROGRAM_ID,
  )[0];
}

function parseOutputDirectory(args: readonly string[]): string {
  if (args.length === 0) {
    return path.resolve(__dirname, "../tests/fixtures");
  }

  if (args.length !== 2 || args[0] !== "--output-dir" || args[1].length === 0) {
    throw new Error("Usage: generate-test-fixtures.ts [--output-dir <path>]");
  }

  return path.resolve(args[1]);
}

function main() {
  const voterA = Keypair.fromSecretKey(VOTER_A_SECRET);
  const voterB = Keypair.fromSecretKey(VOTER_B_SECRET);
  const voterC = Keypair.fromSecretKey(VOTER_C_SECRET);

  const pdaA = identityPda(voterA.publicKey);
  const pdaB = identityPda(voterB.publicKey);
  const pdaC = identityPda(voterC.publicKey);

  console.log("VOTER_A pubkey:", voterA.publicKey.toBase58(), "PDA:", pdaA.toBase58());
  console.log("VOTER_B pubkey:", voterB.publicKey.toBase58(), "PDA:", pdaB.toBase58());
  console.log("VOTER_C pubkey:", voterC.publicKey.toBase58(), "PDA:", pdaC.toBase58());

  // Build account data.
  // last_verification_timestamp = 1700000000 (Nov 2023); with max_verification_age
  // = 2000000000 this passes until year 2086.
  const dataA = buildIdentityStateData(voterA.publicKey, 200, 1700000000);
  const dataB = buildIdentityStateData(voterB.publicKey, 50, 1700000000);
  // VOTER_C: trust + recency would pass; only the wrong discriminator triggers rejection.
  const dataC = buildIdentityStateData(
    voterC.publicKey,
    200,
    1700000000,
    WRONG_DISCRIMINATOR,
  );

  const outputArgs = process.argv.slice(2);
  const fixturesDir = parseOutputDirectory(outputArgs);
  fs.mkdirSync(fixturesDir, { recursive: true });
  writeFixture(path.join(fixturesDir, "identity-state-a.json"), pdaA, dataA, ENTROS_ANCHOR_PROGRAM_ID);
  writeFixture(path.join(fixturesDir, "identity-state-b.json"), pdaB, dataB, ENTROS_ANCHOR_PROGRAM_ID);
  writeFixture(path.join(fixturesDir, "identity-state-c.json"), pdaC, dataC, ENTROS_ANCHOR_PROGRAM_ID);
  if (outputArgs.length > 0) {
    writeFundedWalletFixture(
      path.join(fixturesDir, "voter-a-wallet.json"),
      voterA.publicKey,
      1_000 * 1_000_000_000,
    );
    writeFundedWalletFixture(
      path.join(fixturesDir, "voter-b-wallet.json"),
      voterB.publicKey,
      10 * 1_000_000_000,
    );
    writeFundedWalletFixture(
      path.join(fixturesDir, "voter-c-wallet.json"),
      voterC.publicKey,
      10 * 1_000_000_000,
    );
  }

  console.log(`\nFixtures written to ${fixturesDir}`);
  console.log("\nAdd to Anchor.toml:");
  for (const [pda, file] of [
    [pdaA, "identity-state-a.json"],
    [pdaB, "identity-state-b.json"],
    [pdaC, "identity-state-c.json"],
  ] as const) {
    console.log(`[[test.validator.account]]`);
    console.log(`address = "${pda.toBase58()}"`);
    console.log(`filename = "tests/fixtures/${file}"`);
    console.log();
  }
}

main();
