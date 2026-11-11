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
 * - VOTER_D: trust_score=200 and a migration record at slot 0. Its identity arrived
 *   before any proposal in a test entered voting.
 * - VOTER_E: trust_score=200 and a migration record at a slot no test reaches. Its
 *   identity arrived after every proposal in a test entered voting.
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

// VOTER_D: high trust score (200), migrated to this wallet at slot 0
const VOTER_D_SECRET = new Uint8Array([
  114,88,10,140,125,118,118,100,17,35,223,92,178,17,194,239,
  234,174,31,197,141,240,115,15,224,193,209,131,58,175,182,193,
  19,117,210,98,48,66,152,207,182,64,16,121,6,208,133,17,
  253,254,92,163,255,221,114,36,236,145,113,29,166,27,226,193,
]);

// VOTER_E: high trust score (200), migrated to this wallet at a late slot
const VOTER_E_SECRET = new Uint8Array([
  143,238,18,196,164,64,212,237,116,171,122,248,99,232,114,213,
  231,56,196,92,11,187,3,206,153,23,89,34,156,109,205,32,
  204,40,39,192,160,52,196,208,203,146,165,76,86,191,234,145,
  67,16,250,37,198,238,160,86,111,39,188,88,15,112,211,75,
]);

// sha256("account:MigrationRecord")[0..8]
const MIGRATION_RECORD_DISCRIMINATOR = Buffer.from([
  16, 36, 116, 243, 192, 61, 40, 1,
]);
const MIGRATION_RECORD_SIZE = 57;
// No local validator run reaches this slot.
const LATE_MIGRATION_SLOT = 1n << 62n;

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

function buildMigrationRecordData(
  migratedAt: number,
  migratedSlot: bigint,
  bump: number,
  previousWallet: PublicKey,
): Buffer {
  const data = Buffer.alloc(MIGRATION_RECORD_SIZE);
  MIGRATION_RECORD_DISCRIMINATOR.copy(data, 0);
  data.writeBigInt64LE(BigInt(migratedAt), 8);
  data.writeBigUInt64LE(migratedSlot, 16);
  data.writeUInt8(bump, 24);
  previousWallet.toBuffer().copy(data, 25);
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

function migrationRecordPda(voter: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("migration"), voter.toBuffer()],
    ENTROS_ANCHOR_PROGRAM_ID,
  );
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

  const voterD = Keypair.fromSecretKey(VOTER_D_SECRET);
  const voterE = Keypair.fromSecretKey(VOTER_E_SECRET);
  const pdaA = identityPda(voterA.publicKey);
  const pdaB = identityPda(voterB.publicKey);
  const pdaC = identityPda(voterC.publicKey);
  const pdaD = identityPda(voterD.publicKey);
  const pdaE = identityPda(voterE.publicKey);
  const [recordD, recordBumpD] = migrationRecordPda(voterD.publicKey);
  const [recordE, recordBumpE] = migrationRecordPda(voterE.publicKey);

  console.log("VOTER_A pubkey:", voterA.publicKey.toBase58(), "PDA:", pdaA.toBase58());
  console.log("VOTER_B pubkey:", voterB.publicKey.toBase58(), "PDA:", pdaB.toBase58());
  console.log("VOTER_C pubkey:", voterC.publicKey.toBase58(), "PDA:", pdaC.toBase58());
  console.log("VOTER_D pubkey:", voterD.publicKey.toBase58(), "PDA:", pdaD.toBase58(), "record:", recordD.toBase58());
  console.log("VOTER_E pubkey:", voterE.publicKey.toBase58(), "PDA:", pdaE.toBase58(), "record:", recordE.toBase58());

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

  const dataD = buildIdentityStateData(voterD.publicKey, 200, 1700000000);
  const dataE = buildIdentityStateData(voterE.publicKey, 200, 1700000000);
  // Each record names the wallet its identity came from. Any wallet serves here.
  const recordDataD = buildMigrationRecordData(
    1600000000,
    0n,
    recordBumpD,
    voterA.publicKey,
  );
  const recordDataE = buildMigrationRecordData(
    1700000000,
    LATE_MIGRATION_SLOT,
    recordBumpE,
    voterB.publicKey,
  );

  const outputArgs = process.argv.slice(2);
  const fixturesDir = parseOutputDirectory(outputArgs);
  fs.mkdirSync(fixturesDir, { recursive: true });
  writeFixture(path.join(fixturesDir, "identity-state-a.json"), pdaA, dataA, ENTROS_ANCHOR_PROGRAM_ID);
  writeFixture(path.join(fixturesDir, "identity-state-b.json"), pdaB, dataB, ENTROS_ANCHOR_PROGRAM_ID);
  writeFixture(path.join(fixturesDir, "identity-state-c.json"), pdaC, dataC, ENTROS_ANCHOR_PROGRAM_ID);
  writeFixture(path.join(fixturesDir, "identity-state-d.json"), pdaD, dataD, ENTROS_ANCHOR_PROGRAM_ID);
  writeFixture(path.join(fixturesDir, "identity-state-e.json"), pdaE, dataE, ENTROS_ANCHOR_PROGRAM_ID);
  writeFixture(path.join(fixturesDir, "migration-record-d.json"), recordD, recordDataD, ENTROS_ANCHOR_PROGRAM_ID);
  writeFixture(path.join(fixturesDir, "migration-record-e.json"), recordE, recordDataE, ENTROS_ANCHOR_PROGRAM_ID);
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
    writeFundedWalletFixture(
      path.join(fixturesDir, "voter-d-wallet.json"),
      voterD.publicKey,
      10 * 1_000_000_000,
    );
    writeFundedWalletFixture(
      path.join(fixturesDir, "voter-e-wallet.json"),
      voterE.publicKey,
      10 * 1_000_000_000,
    );
  }

  console.log(`\nFixtures written to ${fixturesDir}`);
  console.log("\nAdd to Anchor.toml:");
  for (const [pda, file] of [
    [pdaA, "identity-state-a.json"],
    [pdaB, "identity-state-b.json"],
    [pdaC, "identity-state-c.json"],
    [pdaD, "identity-state-d.json"],
    [pdaE, "identity-state-e.json"],
    [recordD, "migration-record-d.json"],
    [recordE, "migration-record-e.json"],
  ] as const) {
    console.log(`[[test.validator.account]]`);
    console.log(`address = "${pda.toBase58()}"`);
    console.log(`filename = "tests/fixtures/${file}"`);
    console.log();
  }
}

main();
