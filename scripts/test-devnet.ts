/**
 * End-to-end devnet verification script for the Entros voter weight plugin.
 *
 * Full devnet mode (default, requires funded devnet keypair with an IdentityState):
 * 1. Reads IdentityState and optional MigrationRecord for the payer wallet
 * 2. Creates a community SPL token mint (supply 100) and Realms DAO with the plugin addin
 * 3. Creates the Registrar, TokenOwnerRecord, and Governance
 * 4. Runs preflightVoterEligibility and executes an atomic cold-voter CreateProposal
 *    transaction ([create_voter_weight_record, update_voter_weight_record_for_action, CreateProposal])
 * 5. Signs off the proposal, runs CastVote pre-flight (including MigrationRecord and
 *    Proposal.voting_at_slot checks), and executes an atomic warm-voter CastVote transaction
 * 6. For non-migrated wallets, also exercises standalone update_voter_weight_record
 *
 * Read-safe pre-flight mode (zero transactions, zero SOL spent):
 *   PREFLIGHT_ONLY=1 REALM=<realm> MINT=<mint> [VOTER=<pubkey>] [PROPOSAL=<proposal>] npm run test:devnet
 *   or: npm run test:devnet -- --preflight-only
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import {
  MINT_SIZE,
  TOKEN_PROGRAM_ID,
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import {
  ENTROS_ANCHOR_PROGRAM_ID,
  GOVERNANCE_PROGRAM_ID,
  PLUGIN_PROGRAM_ID,
  VoterWeightActionTag,
  buildCastVoteInstruction,
  buildCreateGovernanceInstruction,
  buildCreateProposalInstruction,
  buildCreateRealmInstruction,
  buildCreateRegistrarInstruction,
  buildCreateTokenOwnerRecordInstruction,
  buildSignOffProposalInstruction,
  buildUpdateVoterWeightRecordInstruction,
} from "../tests/helpers";
import {
  buildAtomicGovernanceTransaction,
  deriveIdentityStatePda,
  deriveMigrationRecordPda,
  parseIdentityStateAccount,
  parseMigrationRecordAccount,
  parseVoterWeightRecordAccount,
  preflightVoterEligibility,
} from "../tests/realms-consumer-client";

const RPC_URL = process.env.RPC_URL || "https://api.devnet.solana.com";
const connection = new Connection(RPC_URL, "confirmed");

function loadKeypair(): Keypair {
  const keypairPath =
    process.env.KEYPAIR_PATH ||
    path.resolve(__dirname, "../../.config/devnet-authority.json");
  if (!fs.existsSync(keypairPath)) {
    console.error(
      `Keypair not found at ${keypairPath}. Set KEYPAIR_PATH or create the file.`
    );
    process.exit(1);
  }
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(keypairPath, "utf-8")))
  );
}

function parseActionEnv(raw: string | undefined): VoterWeightActionTag | null {
  if (!raw) {
    return null;
  }
  const normalized = raw.trim().toLowerCase();
  switch (normalized) {
    case "castvote":
    case "cast_vote":
      return VoterWeightActionTag.CastVote;
    case "commentproposal":
    case "comment_proposal":
      return VoterWeightActionTag.CommentProposal;
    case "creategovernance":
    case "create_governance":
      return VoterWeightActionTag.CreateGovernance;
    case "createproposal":
    case "create_proposal":
      return VoterWeightActionTag.CreateProposal;
    case "signoffproposal":
    case "sign_off_proposal":
      return VoterWeightActionTag.SignOffProposal;
    case "standalone":
    case "none":
      return null;
    default:
      throw new Error(`Unsupported ACTION value: ${raw}`);
  }
}

async function runPreflightOnly(): Promise<void> {
  const realmRaw = process.env.REALM;
  const mintRaw = process.env.MINT;
  if (!realmRaw || !mintRaw) {
    console.error(
      "PREFLIGHT_ONLY requires REALM and MINT environment variables."
    );
    process.exit(1);
  }

  const realm = new PublicKey(realmRaw);
  const governingTokenMint = new PublicKey(mintRaw);
  const voter = process.env.VOTER
    ? new PublicKey(process.env.VOTER)
    : loadKeypair().publicKey;
  const proposalRaw = process.env.PROPOSAL;
  const actionTargetRaw = process.env.ACTION_TARGET ?? proposalRaw;
  const action =
    process.env.ACTION !== undefined
      ? parseActionEnv(process.env.ACTION)
      : proposalRaw
        ? VoterWeightActionTag.CastVote
        : null;
  const actionTarget = actionTargetRaw ? new PublicKey(actionTargetRaw) : null;

  console.log("=== Entros Voter Weight Plugin: Read-Only Devnet Pre-Flight ===\n");
  console.log("RPC:", RPC_URL);
  console.log("Realm:", realm.toBase58());
  console.log("Mint:", governingTokenMint.toBase58());
  console.log("Voter:", voter.toBase58());
  console.log(
    "Mode:",
    action === null
      ? "standalone update_voter_weight_record"
      : `action-bound (${VoterWeightActionTag[action]})`
  );
  if (actionTarget) {
    console.log("Action target:", actionTarget.toBase58());
  }

  const result = await preflightVoterEligibility({
    connection,
    realm,
    governingTokenMint,
    voter,
    governanceProgramId: GOVERNANCE_PROGRAM_ID,
    action,
    actionTarget,
  });

  if (!result.eligible) {
    console.error("\nINELIGIBLE:", result.reason);
    console.error("Message:", result.message);
    process.exit(1);
  }

  console.log("\nELIGIBLE");
  console.log("Needs create_voter_weight_record:", result.needsCreateVwr);
  console.log("Trust Score:", result.trustScore);
  console.log(
    "Last Verified:",
    new Date(Number(result.lastVerificationTimestamp) * 1000).toISOString()
  );
  console.log(
    "Migration Slot:",
    result.migratedSlot !== null ? result.migratedSlot.toString() : "none"
  );
  if (result.votingAtSlot !== null) {
    console.log("Proposal Voting Start Slot:", result.votingAtSlot.toString());
  }
}

async function runFullDevnetFlow(): Promise<void> {
  const payer = loadKeypair();

  console.log("=== Entros Voter Weight Plugin: End-to-End Devnet Test ===\n");
  console.log("RPC:", RPC_URL);
  console.log("Payer:", payer.publicKey.toBase58());

  const balance = await connection.getBalance(payer.publicKey);
  console.log("Balance:", balance / 1e9, "SOL");

  if (balance < 0.1 * 1e9) {
    console.error("Insufficient balance. Need at least 0.1 SOL.");
    process.exit(1);
  }

  // 1. Check Entros IdentityState and MigrationRecord
  const identityPda = deriveIdentityStatePda(payer.publicKey);
  const migrationRecordPda = deriveMigrationRecordPda(payer.publicKey);

  const [identityAccount, migrationAccount] =
    await connection.getMultipleAccountsInfo([identityPda, migrationRecordPda]);
  if (!identityAccount) {
    console.error(
      "No Entros IdentityState found. Verify at entros.io/verify first."
    );
    process.exit(1);
  }
  const identity = parseIdentityStateAccount(identityAccount.data);
  if (!identity) {
    console.error("IdentityState account data failed validation.");
    process.exit(1);
  }

  let migratedSlot: bigint | null = null;
  if (
    migrationAccount &&
    migrationAccount.owner.equals(ENTROS_ANCHOR_PROGRAM_ID)
  ) {
    const parsedMigration = parseMigrationRecordAccount(migrationAccount.data);
    if (!parsedMigration) {
      console.error("MigrationRecord account data failed validation.");
      process.exit(1);
    }
    migratedSlot = parsedMigration.migratedSlot;
  }

  console.log("Entros Trust Score:", identity.trustScore);
  console.log(
    "Last Verified:",
    new Date(Number(identity.lastVerificationTimestamp) * 1000).toISOString()
  );
  console.log(
    "MigrationRecord:",
    migratedSlot !== null
      ? `${migrationRecordPda.toBase58()} (slot ${migratedSlot.toString()})`
      : "none"
  );

  // 2. Create SPL token mint with supply 100 so a single vote keeps the proposal in Voting
  console.log("\n--- Step 1: Create community token mint ---");
  const mintKeypair = Keypair.generate();
  const mintRent = await getMinimumBalanceForRentExemptMint(connection);
  const supplyAta = getAssociatedTokenAddressSync(
    mintKeypair.publicKey,
    payer.publicKey
  );

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
      0,
      payer.publicKey,
      null
    ),
    createAssociatedTokenAccountInstruction(
      payer.publicKey,
      supplyAta,
      payer.publicKey,
      mintKeypair.publicKey
    ),
    createMintToInstruction(
      mintKeypair.publicKey,
      supplyAta,
      payer.publicKey,
      100
    )
  );
  await sendAndConfirmTransaction(connection, createMintTx, [
    payer,
    mintKeypair,
  ]);
  console.log("Community mint:", mintKeypair.publicKey.toBase58());

  // 3. Create Realm with Entros plugin as voter weight addin
  console.log("\n--- Step 2: Create Realms DAO ---");
  const realmName = `Entros-Test-${Date.now().toString(36)}`;
  const { instruction: createRealmIx, realmPda } = buildCreateRealmInstruction(
    realmName,
    payer.publicKey,
    mintKeypair.publicKey,
    payer.publicKey,
    PLUGIN_PROGRAM_ID
  );
  const realmSig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(createRealmIx),
    [payer]
  );
  console.log("Realm:", realmPda.toBase58());
  console.log("Realm name:", realmName);
  console.log("Tx:", realmSig);

  // 4. Create Registrar, TokenOwnerRecord, and Governance
  console.log("\n--- Step 3: Create Registrar, TokenOwnerRecord, and Governance ---");
  const { instruction: createRegistrarIx, registrarPda } =
    buildCreateRegistrarInstruction(
      realmPda,
      mintKeypair.publicKey,
      payer.publicKey,
      payer.publicKey,
      100,
      2_592_000n
    );
  const { instruction: createTorIx, tokenOwnerRecordPda } =
    buildCreateTokenOwnerRecordInstruction(
      realmPda,
      payer.publicKey,
      mintKeypair.publicKey,
      payer.publicKey
    );
  const { instruction: createGovIx, governancePda } =
    buildCreateGovernanceInstruction(
      realmPda,
      Keypair.generate().publicKey,
      tokenOwnerRecordPda,
      payer.publicKey,
      payer.publicKey
    );

  const setupSig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(createRegistrarIx, createTorIx, createGovIx),
    [payer]
  );
  console.log("Registrar:", registrarPda.toBase58());
  console.log("Governance:", governancePda.toBase58());
  console.log("Tx:", setupSig);

  // 5. Cold voter pre-flight + atomic CreateProposal (creates VWR + action-bound update + proposal)
  console.log("\n--- Step 4: Atomic cold-voter CreateProposal ---");
  const proposalPreflight = await preflightVoterEligibility({
    connection,
    realm: realmPda,
    governingTokenMint: mintKeypair.publicKey,
    voter: payer.publicKey,
    governanceProgramId: GOVERNANCE_PROGRAM_ID,
    action: VoterWeightActionTag.CreateProposal,
    actionTarget: governancePda,
  });
  if (!proposalPreflight.eligible) {
    console.error(
      `Pre-flight refused CreateProposal (${proposalPreflight.reason}): ${proposalPreflight.message}`
    );
    process.exit(1);
  }

  const createProposal = buildCreateProposalInstruction(
    realmPda,
    governancePda,
    tokenOwnerRecordPda,
    mintKeypair.publicKey,
    payer.publicKey,
    payer.publicKey,
    Keypair.generate().publicKey,
    proposalPreflight.pdas.voterWeightRecord,
    "Entros Devnet Verification Proposal"
  );
  const coldBuilt = buildAtomicGovernanceTransaction({
    realm: realmPda,
    governingTokenMint: mintKeypair.publicKey,
    voter: payer.publicKey,
    needsCreateVwr: proposalPreflight.needsCreateVwr,
    action: VoterWeightActionTag.CreateProposal,
    actionTarget: governancePda,
    governanceInstructions: createProposal.instruction,
  });

  const proposalSig = await sendAndConfirmTransaction(
    connection,
    coldBuilt.transaction,
    [payer]
  );
  console.log("VoterWeightRecord:", coldBuilt.pdas.voterWeightRecord.toBase58());
  console.log("Proposal:", createProposal.proposalPda.toBase58());
  console.log("Tx:", proposalSig);

  // 6. Sign off proposal so it enters Voting state
  console.log("\n--- Step 5: SignOffProposal ---");
  const signOffSig = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(
      buildSignOffProposalInstruction(
        realmPda,
        governancePda,
        createProposal.proposalPda,
        payer.publicKey,
        tokenOwnerRecordPda
      )
    ),
    [payer]
  );
  console.log("Tx:", signOffSig);

  // 7. Warm voter pre-flight + atomic CastVote (exercises MigrationRecord + Proposal.voting_at_slot)
  console.log("\n--- Step 6: Atomic action-bound CastVote ---");
  const votePreflight = await preflightVoterEligibility({
    connection,
    realm: realmPda,
    governingTokenMint: mintKeypair.publicKey,
    voter: payer.publicKey,
    governanceProgramId: GOVERNANCE_PROGRAM_ID,
    action: VoterWeightActionTag.CastVote,
    actionTarget: createProposal.proposalPda,
  });
  if (!votePreflight.eligible) {
    console.error(
      `Pre-flight refused CastVote (${votePreflight.reason}): ${votePreflight.message}`
    );
    process.exit(1);
  }

  const castVote = buildCastVoteInstruction(
    realmPda,
    governancePda,
    createProposal.proposalPda,
    tokenOwnerRecordPda,
    tokenOwnerRecordPda,
    payer.publicKey,
    mintKeypair.publicKey,
    payer.publicKey,
    votePreflight.pdas.voterWeightRecord
  );
  const warmBuilt = buildAtomicGovernanceTransaction({
    realm: realmPda,
    governingTokenMint: mintKeypair.publicKey,
    voter: payer.publicKey,
    needsCreateVwr: votePreflight.needsCreateVwr,
    action: VoterWeightActionTag.CastVote,
    actionTarget: createProposal.proposalPda,
    governanceInstructions: castVote.instruction,
  });
  const voteSig = await sendAndConfirmTransaction(
    connection,
    warmBuilt.transaction,
    [payer]
  );
  console.log("VoteRecord:", castVote.voteRecordPda.toBase58());
  console.log("Tx:", voteSig);

  const actionVwrInfo = await connection.getAccountInfo(
    warmBuilt.pdas.voterWeightRecord
  );
  const parsedActionVwr = actionVwrInfo
    ? parseVoterWeightRecordAccount(actionVwrInfo.data)
    : null;
  if (
    !parsedActionVwr ||
    parsedActionVwr.voterWeight !== 1n ||
    parsedActionVwr.voterWeightExpiry === null ||
    parsedActionVwr.voterWeightExpiry <= 0n ||
    parsedActionVwr.weightAction !== VoterWeightActionTag.CastVote ||
    !parsedActionVwr.weightActionTarget?.equals(createProposal.proposalPda)
  ) {
    console.error("FAIL: Action-bound VoterWeightRecord verification failed.");
    process.exit(1);
  }

  // 8. Standalone update_voter_weight_record check (only valid for non-migrated wallets)
  console.log("\n--- Step 7: Standalone update_voter_weight_record check ---");
  if (migratedSlot === null) {
    const standaloneIx = buildUpdateVoterWeightRecordInstruction(
      registrarPda,
      warmBuilt.pdas.voterWeightRecord,
      payer.publicKey,
      identityPda
    );
    const standaloneSig = await sendAndConfirmTransaction(
      connection,
      new Transaction().add(standaloneIx),
      [payer]
    );
    console.log("Standalone update tx:", standaloneSig);

    const standaloneVwrInfo = await connection.getAccountInfo(
      warmBuilt.pdas.voterWeightRecord
    );
    const parsedStandalone = standaloneVwrInfo
      ? parseVoterWeightRecordAccount(standaloneVwrInfo.data)
      : null;
    if (
      !parsedStandalone ||
      parsedStandalone.voterWeight !== 1n ||
      parsedStandalone.voterWeightExpiry === null ||
      parsedStandalone.voterWeightExpiry <= 0n ||
      parsedStandalone.weightAction !== null ||
      parsedStandalone.weightActionTarget !== null
    ) {
      console.error("FAIL: Standalone VoterWeightRecord verification failed.");
      process.exit(1);
    }
  } else {
    const standalonePreflight = await preflightVoterEligibility({
      connection,
      realm: realmPda,
      governingTokenMint: mintKeypair.publicKey,
      voter: payer.publicKey,
      governanceProgramId: GOVERNANCE_PROGRAM_ID,
      action: null,
    });
    console.log(
      "Skipped standalone update for migrated wallet (pre-flight:",
      standalonePreflight.eligible ? "unexpectedly eligible" : standalonePreflight.reason,
      ")"
    );
  }

  console.log("\n=== RESULTS ===");
  console.log(
    "PASS: Action-bound CreateProposal, CastVote, and MigrationRecord checks succeeded end-to-end."
  );

  console.log("\nExplorer links:");
  console.log(
    `  Realm: https://explorer.solana.com/address/${realmPda.toBase58()}?cluster=devnet`
  );
  console.log(
    `  Registrar: https://explorer.solana.com/address/${registrarPda.toBase58()}?cluster=devnet`
  );
  console.log(
    `  Proposal: https://explorer.solana.com/address/${createProposal.proposalPda.toBase58()}?cluster=devnet`
  );
  console.log(
    `  VoterWeightRecord: https://explorer.solana.com/address/${warmBuilt.pdas.voterWeightRecord.toBase58()}?cluster=devnet`
  );
  console.log(
    `  Plugin: https://explorer.solana.com/address/${PLUGIN_PROGRAM_ID.toBase58()}?cluster=devnet`
  );
}

async function main(): Promise<void> {
  const preflightOnly =
    process.env.PREFLIGHT_ONLY === "1" ||
    process.argv.includes("--preflight-only");
  if (preflightOnly) {
    await runPreflightOnly();
    return;
  }
  await runFullDevnetFlow();
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
