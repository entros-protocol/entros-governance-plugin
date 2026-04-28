/**
 * End-to-end devnet test for the Entros voter weight plugin.
 *
 * 1. Creates an SPL token mint
 * 2. Creates a Realms DAO with the Entros plugin as voter weight addin
 * 3. Calls create_registrar on the Entros voter weight plugin
 * 4. Calls create_voter_weight_record for the test voter
 * 5. Calls update_voter_weight_record with the voter's Entros IdentityState
 * 6. Reads the VoterWeightRecord and verifies voter_weight = 1
 *
 * Prerequisites:
 * - Entros voter weight plugin deployed to devnet
 * - Wallet has an Entros IdentityState on devnet (verified via entros.io)
 * - Solana CLI configured for devnet with a funded keypair
 *
 * Usage: npx tsx scripts/test-devnet.ts
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import {
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

// Program IDs
const GOVERNANCE_PROGRAM_ID = new PublicKey("GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw");
const PLUGIN_PROGRAM_ID = new PublicKey("99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534");
const ENTROS_ANCHOR_PROGRAM_ID = new PublicKey("GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2");

// Load keypair
const keypairPath = process.env.KEYPAIR_PATH || path.resolve(__dirname, "../../.config/devnet-authority.json");
if (!fs.existsSync(keypairPath)) {
  console.error(`Keypair not found at ${keypairPath}. Set KEYPAIR_PATH or create the file.`);
  process.exit(1);
}
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf-8"))));
const connection = new Connection("https://api.devnet.solana.com", "confirmed");

// Plugin instruction discriminators (Anchor: sha256("global:<instruction_name>")[0..8])
function anchorDiscriminator(name: string): Buffer {
  return crypto.createHash("sha256").update(`global:${name}`).digest().slice(0, 8);
}

// ---- spl-governance CreateRealm instruction builder ----

function buildCreateRealmInstruction(
  realmName: string,
  realmAuthority: PublicKey,
  communityMint: PublicKey,
  payerKey: PublicKey,
  voterWeightAddin: PublicKey | null,
): { instruction: TransactionInstruction; realmPda: PublicKey } {
  const [realmPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance"), Buffer.from(realmName)],
    GOVERNANCE_PROGRAM_ID,
  );
  const [communityHolding] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance"), realmPda.toBuffer(), communityMint.toBuffer()],
    GOVERNANCE_PROGRAM_ID,
  );
  const [realmConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("realm-config"), realmPda.toBuffer()],
    GOVERNANCE_PROGRAM_ID,
  );

  const accounts = [
    { pubkey: realmPda, isSigner: false, isWritable: true },
    { pubkey: realmAuthority, isSigner: false, isWritable: false },
    { pubkey: communityMint, isSigner: false, isWritable: false },
    { pubkey: communityHolding, isSigner: false, isWritable: true },
    { pubkey: payerKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
    // No council mint -- skip council accounts entirely (not PublicKey.default)
    // RealmConfig comes right after rent when no council
    { pubkey: realmConfig, isSigner: false, isWritable: true },
  ];

  // Add voter weight addin if provided
  if (voterWeightAddin) {
    accounts.push({ pubkey: voterWeightAddin, isSigner: false, isWritable: false });
  }

  // Serialize instruction data
  const nameBytes = Buffer.from(realmName, "utf-8");
  const parts: Buffer[] = [];

  // Instruction index: 0 (CreateRealm)
  parts.push(Buffer.from([0]));

  // name: Borsh String
  const nameLen = Buffer.alloc(4);
  nameLen.writeUInt32LE(nameBytes.length);
  parts.push(nameLen);
  parts.push(nameBytes);

  // RealmConfigArgs:
  // use_council_mint: false
  parts.push(Buffer.from([0]));

  // min_community_weight_to_create_governance: u64 = 1
  const minWeight = Buffer.alloc(8);
  minWeight.writeBigUInt64LE(1n);
  parts.push(minWeight);

  // community_mint_max_voter_weight_source: SupplyFraction(10_000_000_000)
  parts.push(Buffer.from([0])); // SupplyFraction variant
  const fraction = Buffer.alloc(8);
  fraction.writeBigUInt64LE(10_000_000_000n); // 100%
  parts.push(fraction);

  // community_token_config_args:
  parts.push(Buffer.from([voterWeightAddin ? 1 : 0])); // use_voter_weight_addin
  parts.push(Buffer.from([0])); // use_max_voter_weight_addin
  parts.push(Buffer.from([0])); // token_type = Liquid

  // council_token_config_args:
  parts.push(Buffer.from([0])); // use_voter_weight_addin
  parts.push(Buffer.from([0])); // use_max_voter_weight_addin
  parts.push(Buffer.from([2])); // token_type = Dormant

  return {
    instruction: new TransactionInstruction({
      programId: GOVERNANCE_PROGRAM_ID,
      keys: accounts,
      data: Buffer.concat(parts),
    }),
    realmPda,
  };
}

// ---- Plugin instruction builders ----

function buildCreateRegistrarInstruction(
  realmPda: PublicKey,
  communityMint: PublicKey,
  realmAuthority: PublicKey,
  payerKey: PublicKey,
  minTrustScore: number,
  maxVerificationAge: bigint,
): { instruction: TransactionInstruction; registrarPda: PublicKey } {
  const [registrarPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registrar"), realmPda.toBuffer(), communityMint.toBuffer()],
    PLUGIN_PROGRAM_ID,
  );

  const disc = anchorDiscriminator("create_registrar");
  const data = Buffer.alloc(8 + 2 + 8);
  disc.copy(data, 0);
  data.writeUInt16LE(minTrustScore, 8);
  data.writeBigInt64LE(maxVerificationAge, 10);

  return {
    instruction: new TransactionInstruction({
      programId: PLUGIN_PROGRAM_ID,
      keys: [
        { pubkey: registrarPda, isSigner: false, isWritable: true },
        { pubkey: GOVERNANCE_PROGRAM_ID, isSigner: false, isWritable: false },
        { pubkey: realmPda, isSigner: false, isWritable: false },
        { pubkey: communityMint, isSigner: false, isWritable: false },
        { pubkey: realmAuthority, isSigner: true, isWritable: false },
        { pubkey: payerKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
    registrarPda,
  };
}

function buildCreateVoterWeightRecordInstruction(
  registrarPda: PublicKey,
  realmPda: PublicKey,
  communityMint: PublicKey,
  voterKey: PublicKey,
  payerKey: PublicKey,
): { instruction: TransactionInstruction; vwrPda: PublicKey } {
  const [vwrPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("voter-weight-record"),
      realmPda.toBuffer(),
      communityMint.toBuffer(),
      voterKey.toBuffer(),
    ],
    PLUGIN_PROGRAM_ID,
  );

  const disc = anchorDiscriminator("create_voter_weight_record");
  const data = Buffer.alloc(8 + 32);
  disc.copy(data, 0);
  voterKey.toBuffer().copy(data, 8);

  return {
    instruction: new TransactionInstruction({
      programId: PLUGIN_PROGRAM_ID,
      keys: [
        { pubkey: registrarPda, isSigner: false, isWritable: false },
        { pubkey: vwrPda, isSigner: false, isWritable: true },
        { pubkey: voterKey, isSigner: true, isWritable: false },
        { pubkey: payerKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
    vwrPda,
  };
}

function buildUpdateVoterWeightRecordInstruction(
  registrarPda: PublicKey,
  vwrPda: PublicKey,
  voterKey: PublicKey,
  identityPda: PublicKey,
): TransactionInstruction {
  const disc = anchorDiscriminator("update_voter_weight_record");

  return new TransactionInstruction({
    programId: PLUGIN_PROGRAM_ID,
    keys: [
      { pubkey: registrarPda, isSigner: false, isWritable: false },
      { pubkey: vwrPda, isSigner: false, isWritable: true },
      { pubkey: voterKey, isSigner: true, isWritable: false },
      // remaining_accounts[0] = Entros IdentityState PDA
      { pubkey: identityPda, isSigner: false, isWritable: false },
    ],
    data: disc,
  });
}

// ---- Main ----

async function main() {
  console.log("=== Entros Voter Weight Plugin: End-to-End Devnet Test ===\n");
  console.log("Payer:", payer.publicKey.toBase58());

  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  if (balance < 0.1 * 1e9) {
    console.error("Insufficient balance. Need at least 0.1 SOL.");
    process.exit(1);
  }

  // 1. Check Entros IdentityState exists
  const [identityPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("identity"), payer.publicKey.toBuffer()],
    ENTROS_ANCHOR_PROGRAM_ID,
  );

  const identityAccount = await connection.getAccountInfo(identityPda);
  if (!identityAccount) {
    console.error("No Entros IdentityState found. Verify at entros.io/verify first.");
    process.exit(1);
  }

  const trustScore = identityAccount.data.readUInt16LE(60);
  const lastVerif = Number(identityAccount.data.readBigInt64LE(48));
  console.log("Entros Trust Score:", trustScore);
  console.log("Last Verified:", new Date(lastVerif * 1000).toISOString());

  // 2. Create SPL token mint (community token)
  console.log("\n--- Step 1: Create community token mint ---");
  const mintKeypair = Keypair.generate();
  const mintRent = await getMinimumBalanceForRentExemptMint(connection);

  const createMintTx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payer.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      lamports: mintRent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      0, // decimals
      payer.publicKey, // mint authority
      null, // freeze authority
    ),
  );

  await sendAndConfirmTransaction(connection, createMintTx, [payer, mintKeypair]);
  console.log("Community mint:", mintKeypair.publicKey.toBase58());

  // 3. Create Realm with Entros plugin as voter weight addin
  console.log("\n--- Step 2: Create Realms DAO ---");
  const realmName = `Entros-Test-${Date.now().toString(36)}`;

  const { instruction: createRealmIx, realmPda } = buildCreateRealmInstruction(
    realmName,
    payer.publicKey, // realm authority = payer
    mintKeypair.publicKey,
    payer.publicKey,
    PLUGIN_PROGRAM_ID, // voter weight addin
  );

  const createRealmTx = new Transaction().add(createRealmIx);
  const realmSig = await sendAndConfirmTransaction(connection, createRealmTx, [payer]);
  console.log("Realm:", realmPda.toBase58());
  console.log("Realm name:", realmName);
  console.log("Tx:", realmSig);

  // 4. Create Registrar
  console.log("\n--- Step 3: Create Registrar ---");
  const { instruction: createRegistrarIx, registrarPda } = buildCreateRegistrarInstruction(
    realmPda,
    mintKeypair.publicKey,
    payer.publicKey,
    payer.publicKey,
    100, // min_trust_score = 100 (requires at least one re-verification)
    2592000n, // max_verification_age = 30 days
  );

  const registrarTx = new Transaction().add(createRegistrarIx);
  const registrarSig = await sendAndConfirmTransaction(connection, registrarTx, [payer]);
  console.log("Registrar:", registrarPda.toBase58());
  console.log("Min Trust Score: 100");
  console.log("Max Verification Age: 30 days");
  console.log("Tx:", registrarSig);

  // 5. Create VoterWeightRecord
  console.log("\n--- Step 4: Create VoterWeightRecord ---");
  const { instruction: createVwrIx, vwrPda } = buildCreateVoterWeightRecordInstruction(
    registrarPda,
    realmPda,
    mintKeypair.publicKey,
    payer.publicKey,
    payer.publicKey,
  );

  const vwrTx = new Transaction().add(createVwrIx);
  const vwrSig = await sendAndConfirmTransaction(connection, vwrTx, [payer]);
  console.log("VoterWeightRecord:", vwrPda.toBase58());
  console.log("Tx:", vwrSig);

  // 6. Update VoterWeightRecord (the core test)
  console.log("\n--- Step 5: Update VoterWeightRecord ---");
  const updateIx = buildUpdateVoterWeightRecordInstruction(
    registrarPda,
    vwrPda,
    payer.publicKey,
    identityPda,
  );

  const updateTx = new Transaction().add(updateIx);
  const updateSig = await sendAndConfirmTransaction(connection, updateTx, [payer]);
  console.log("Tx:", updateSig);

  // 7. Read and verify the VoterWeightRecord
  console.log("\n--- Step 6: Verify VoterWeightRecord ---");
  const vwrAccount = await connection.getAccountInfo(vwrPda);
  if (!vwrAccount) {
    console.error("FAIL: VoterWeightRecord not found");
    process.exit(1);
  }

  const vwrData = vwrAccount.data;

  // VoterWeightRecord layout (Borsh):
  // 0-7: account_discriminator (8 bytes)
  // 8-39: realm (32 bytes)
  // 40-71: governing_token_mint (32 bytes)
  // 72-103: governing_token_owner (32 bytes)
  // 104-111: voter_weight (u64)
  // 112: voter_weight_expiry Option tag
  // 113-120: voter_weight_expiry value (u64) if Some

  const voterWeight = vwrData.readBigUInt64LE(104);
  const expiryTag = vwrData.readUInt8(112);
  const expirySlot = expiryTag === 1 ? vwrData.readBigUInt64LE(113) : null;
  const recordRealm = new PublicKey(vwrData.slice(8, 40));
  const recordOwner = new PublicKey(vwrData.slice(72, 104));

  console.log("Voter Weight:", voterWeight.toString());
  console.log("Expiry Slot:", expirySlot?.toString() ?? "None");
  console.log("Realm matches:", recordRealm.equals(realmPda) ? "YES" : "NO");
  console.log("Owner matches:", recordOwner.equals(payer.publicKey) ? "YES" : "NO");

  // Final verdict
  console.log("\n=== RESULTS ===");
  if (voterWeight === 1n && expirySlot !== null && expirySlot > 0n) {
    console.log("PASS: Voter weight = 1, expiry set. Entros voter weight plugin works end-to-end.");
  } else {
    console.log("FAIL: Unexpected voter weight or expiry.");
    process.exit(1);
  }

  console.log("\nExplorer links:");
  console.log(`  Realm: https://explorer.solana.com/address/${realmPda.toBase58()}?cluster=devnet`);
  console.log(`  Registrar: https://explorer.solana.com/address/${registrarPda.toBase58()}?cluster=devnet`);
  console.log(`  VoterWeightRecord: https://explorer.solana.com/address/${vwrPda.toBase58()}?cluster=devnet`);
  console.log(`  Plugin: https://explorer.solana.com/address/${PLUGIN_PROGRAM_ID.toBase58()}?cluster=devnet`);
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
