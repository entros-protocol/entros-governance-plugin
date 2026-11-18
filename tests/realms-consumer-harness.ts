import {
  AccountInfo,
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
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
import { expect } from "chai";
import {
  ENTROS_ANCHOR_PROGRAM_ID,
  GOVERNANCE_PROGRAM_ID,
  PLUGIN_PROGRAM_ID,
  VoterWeightActionTag,
  anchorDiscriminator,
  buildCastVoteInstruction,
  buildCreateGovernanceInstruction,
  buildCreateProposalInstruction,
  buildCreateRealmInstruction,
  buildCreateRegistrarInstruction,
  buildCreateTokenOwnerRecordInstruction,
  buildSignOffProposalInstruction,
  buildUpdateRegistrarInstruction,
} from "./helpers";
import {
  AccountInfoReader,
  IDENTITY_STATE_DISCRIMINATOR,
  MIGRATION_RECORD_DISCRIMINATOR,
  MIGRATION_RECORD_MIN_LEN,
  REGISTRAR_DISCRIMINATOR,
  REGISTRAR_MIN_LEN,
  VOTER_WEIGHT_RECORD_DISCRIMINATOR,
  buildAtomicGovernanceInstructions,
  buildAtomicGovernanceTransaction,
  deriveConsumerPdas,
  deriveIdentityStatePda,
  deriveMigrationRecordPda,
  deriveRegistrarPda,
  deriveVoterWeightRecordPda,
  parseIdentityStateAccount,
  parseMigrationRecordAccount,
  parseProposalVotingStartSlot,
  parseRegistrarAccount,
  parseVoterWeightRecordAccount,
  preflightVoterEligibility,
} from "./realms-consumer-client";

// Deterministic localnet fixture keypairs matching scripts/generate-test-fixtures.ts.
const VOTER_A = Keypair.fromSecretKey(
  new Uint8Array([
    176, 171, 215, 96, 83, 161, 231, 229, 103, 176, 227, 100, 38, 79, 206, 50,
    203, 76, 176, 209, 107, 97, 246, 126, 238, 162, 159, 213, 173, 119, 40,
    108, 49, 143, 213, 97, 153, 225, 182, 193, 75, 95, 250, 131, 152, 21, 82,
    239, 241, 194, 146, 251, 64, 97, 224, 172, 235, 104, 14, 73, 218, 231, 19,
    15,
  ])
);

const VOTER_B = Keypair.fromSecretKey(
  new Uint8Array([
    84, 94, 164, 12, 45, 138, 92, 108, 91, 174, 39, 105, 154, 110, 64, 182,
    100, 253, 150, 41, 226, 243, 8, 8, 59, 121, 56, 53, 141, 28, 180, 19, 94,
    96, 206, 206, 67, 214, 1, 76, 103, 202, 1, 217, 194, 143, 42, 124, 60,
    233, 160, 57, 79, 217, 12, 116, 14, 199, 224, 122, 17, 244, 146, 232,
  ])
);

const VOTER_C = Keypair.fromSecretKey(
  new Uint8Array([
    94, 31, 55, 141, 69, 236, 105, 147, 234, 20, 85, 165, 247, 47, 215, 59,
    77, 222, 67, 95, 93, 144, 57, 151, 115, 136, 105, 29, 15, 181, 192, 140,
    227, 49, 209, 215, 148, 113, 232, 115, 251, 223, 165, 251, 109, 253, 0, 60,
    81, 61, 52, 187, 251, 15, 177, 100, 255, 43, 41, 25, 156, 243, 154, 154,
  ])
);

const VOTER_D = Keypair.fromSecretKey(
  new Uint8Array([
    114, 88, 10, 140, 125, 118, 118, 100, 17, 35, 223, 92, 178, 17, 194, 239,
    234, 174, 31, 197, 141, 240, 115, 15, 224, 193, 209, 131, 58, 175, 182,
    193, 19, 117, 210, 98, 48, 66, 152, 207, 182, 64, 16, 121, 6, 208, 133, 17,
    253, 254, 92, 163, 255, 221, 114, 36, 236, 145, 113, 29, 166, 27, 226, 193,
  ])
);

const VOTER_E = Keypair.fromSecretKey(
  new Uint8Array([
    143, 238, 18, 196, 164, 64, 212, 237, 116, 171, 122, 248, 99, 232, 114,
    213, 231, 56, 196, 92, 11, 187, 3, 206, 153, 23, 89, 34, 156, 109, 205, 32,
    204, 40, 39, 192, 160, 52, 196, 208, 203, 146, 165, 76, 86, 191, 234, 145,
    67, 16, 250, 37, 198, 238, 160, 86, 111, 39, 188, 88, 15, 112, 211, 75,
  ])
);

const LATE_MIGRATION_SLOT = 1n << 62n;

// ---- Synthetic account builders for unit tests ----

function makeAccountInfo(
  owner: PublicKey,
  data: Buffer,
  lamports = 2_039_280
): AccountInfo<Buffer> {
  return {
    data,
    executable: false,
    lamports,
    owner,
    rentEpoch: 0,
  };
}

function makeMockReader(
  entries: ReadonlyMap<string, AccountInfo<Buffer>>
): AccountInfoReader {
  return {
    async getAccountInfo(pubkey: PublicKey) {
      return entries.get(pubkey.toBase58()) ?? null;
    },
    async getMultipleAccountsInfo(pubkeys: PublicKey[]) {
      return pubkeys.map((key) => entries.get(key.toBase58()) ?? null);
    },
  };
}

function encodeRegistrar(params: {
  governanceProgramId: PublicKey;
  realm: PublicKey;
  governingTokenMint: PublicKey;
  minTrustScore: number;
  maxVerificationAge: bigint;
}): Buffer {
  const data = Buffer.alloc(REGISTRAR_MIN_LEN);
  REGISTRAR_DISCRIMINATOR.copy(data, 0);
  params.governanceProgramId.toBuffer().copy(data, 8);
  params.realm.toBuffer().copy(data, 40);
  params.governingTokenMint.toBuffer().copy(data, 72);
  data.writeUInt16LE(params.minTrustScore, 104);
  data.writeBigInt64LE(params.maxVerificationAge, 106);
  return data;
}

function encodeIdentityState(params: {
  owner: PublicKey;
  trustScore: number;
  lastVerificationTimestamp: bigint;
  discriminator?: Buffer;
  size?: number;
}): Buffer {
  const data = Buffer.alloc(params.size ?? 207);
  const disc = params.discriminator ?? IDENTITY_STATE_DISCRIMINATOR;
  disc.copy(data, 0);
  if (data.length >= 40) {
    params.owner.toBuffer().copy(data, 8);
  }
  if (data.length >= 48) {
    data.writeBigInt64LE(params.lastVerificationTimestamp - 86400n, 40);
  }
  if (data.length >= 56) {
    data.writeBigInt64LE(params.lastVerificationTimestamp, 48);
  }
  if (data.length >= 60) {
    data.writeUInt32LE(2, 56);
  }
  if (data.length >= 62) {
    data.writeUInt16LE(params.trustScore, 60);
  }
  return data;
}

function encodeMigrationRecord(params: {
  migratedAt?: bigint;
  migratedSlot: bigint;
  bump?: number;
  previousWallet?: PublicKey;
  discriminator?: Buffer;
  size?: number;
}): Buffer {
  const data = Buffer.alloc(params.size ?? MIGRATION_RECORD_MIN_LEN);
  const disc = params.discriminator ?? MIGRATION_RECORD_DISCRIMINATOR;
  disc.copy(data, 0);
  if (data.length >= 16) {
    data.writeBigInt64LE(params.migratedAt ?? 1_700_000_000n, 8);
  }
  if (data.length >= 24) {
    data.writeBigUInt64LE(params.migratedSlot, 16);
  }
  if (data.length >= 25) {
    data.writeUInt8(params.bump ?? 255, 24);
  }
  if (data.length >= 57) {
    (params.previousWallet ?? Keypair.generate().publicKey)
      .toBuffer()
      .copy(data, 25);
  }
  return data;
}

function encodeVoterWeightRecord(params: {
  realm: PublicKey;
  governingTokenMint: PublicKey;
  governingTokenOwner: PublicKey;
  voterWeight: bigint;
  voterWeightExpiry: bigint | null;
  weightAction: VoterWeightActionTag | null;
  weightActionTarget: PublicKey | null;
}): Buffer {
  const parts: Buffer[] = [
    VOTER_WEIGHT_RECORD_DISCRIMINATOR,
    params.realm.toBuffer(),
    params.governingTokenMint.toBuffer(),
    params.governingTokenOwner.toBuffer(),
  ];
  const weightBuf = Buffer.alloc(8);
  weightBuf.writeBigUInt64LE(params.voterWeight);
  parts.push(weightBuf);

  if (params.voterWeightExpiry === null) {
    parts.push(Buffer.from([0]));
  } else {
    const expBuf = Buffer.alloc(9);
    expBuf.writeUInt8(1, 0);
    expBuf.writeBigUInt64LE(params.voterWeightExpiry, 1);
    parts.push(expBuf);
  }

  if (params.weightAction === null) {
    parts.push(Buffer.from([0]));
  } else {
    parts.push(Buffer.from([1, params.weightAction]));
  }

  if (params.weightActionTarget === null) {
    parts.push(Buffer.from([0]));
  } else {
    parts.push(Buffer.from([1]), params.weightActionTarget.toBuffer());
  }

  parts.push(Buffer.alloc(8));
  return Buffer.concat(parts);
}

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const len = Buffer.alloc(4);
  len.writeUInt32LE(bytes.length);
  return Buffer.concat([len, bytes]);
}

function optionU64(value: bigint | null): Buffer {
  if (value === null) {
    return Buffer.from([0]);
  }
  const buf = Buffer.alloc(9);
  buf.writeUInt8(1, 0);
  buf.writeBigUInt64LE(value, 1);
  return buf;
}

function optionI64(value: bigint | null): Buffer {
  if (value === null) {
    return Buffer.from([0]);
  }
  const buf = Buffer.alloc(9);
  buf.writeUInt8(1, 0);
  buf.writeBigInt64LE(value, 1);
  return buf;
}

function encodeProposalV2(params: {
  governance: PublicKey;
  governingTokenMint: PublicKey;
  state: number;
  votingAtSlot: bigint | null;
  multiChoice?: boolean;
}): Buffer {
  const draftAt = Buffer.alloc(8);
  draftAt.writeBigInt64LE(1_700_000_000n);
  const optionCount = Buffer.alloc(4);
  optionCount.writeUInt32LE(1);

  return Buffer.concat([
    Buffer.from([14]), // ProposalV2
    params.governance.toBuffer(),
    params.governingTokenMint.toBuffer(),
    Buffer.from([params.state]),
    Keypair.generate().publicKey.toBuffer(), // token_owner_record
    Buffer.from([0, 0]), // signatories_count, signatories_signed_off_count
    params.multiChoice ? Buffer.from([1, 0, 1, 1, 1]) : Buffer.from([0]),
    optionCount,
    borshString("Approve"),
    Buffer.alloc(8), // vote_weight
    Buffer.from([0]), // OptionVoteResult::None
    Buffer.alloc(6), // transaction counters
    optionU64(0n), // deny_vote_weight
    Buffer.from([0]), // reserved1
    Buffer.from([0]), // abstain_vote_weight: None
    Buffer.from([0]), // start_voting_at: None
    draftAt,
    Buffer.from([0]), // signing_off_at: None
    optionI64(params.votingAtSlot === null ? null : 1_700_000_100n), // voting_at
    optionU64(params.votingAtSlot),
    Buffer.from([0]), // voting_completed_at: None
    Buffer.from([0]), // executing_at: None
    Buffer.from([0]), // closed_at: None
    Buffer.from([0]), // execution_flags: None
    Buffer.from([0]), // max_vote_weight: None
    Buffer.from([0]), // max_voting_time: None
    Buffer.from([0]), // vote_threshold: None
    Buffer.alloc(64), // reserved
    borshString("Test Proposal"),
    borshString(""),
    Buffer.alloc(8), // veto_vote_weight
  ]);
}

function encodeProposalV1(params: {
  governance: PublicKey;
  governingTokenMint: PublicKey;
  state: number;
  votingAtSlot: bigint | null;
}): Buffer {
  const draftAt = Buffer.alloc(8);
  draftAt.writeBigInt64LE(1_700_000_000n);

  return Buffer.concat([
    Buffer.from([5]), // ProposalV1
    params.governance.toBuffer(),
    params.governingTokenMint.toBuffer(),
    Buffer.from([params.state]),
    Keypair.generate().publicKey.toBuffer(), // token_owner_record
    Buffer.from([0, 0]), // signatories counts
    Buffer.alloc(16), // yes_votes_count, no_votes_count
    Buffer.alloc(6), // instruction counters
    draftAt,
    Buffer.from([0]), // signing_off_at: None
    optionI64(params.votingAtSlot === null ? null : 1_700_000_100n), // voting_at
    optionU64(params.votingAtSlot),
    Buffer.from([0]), // voting_completed_at: None
    Buffer.from([0]), // executing_at: None
    Buffer.from([0]), // closed_at: None
    Buffer.from([0]), // execution_flags: None
    Buffer.from([0]), // max_vote_weight: None
    Buffer.from([0]), // vote_threshold: None
    borshString("Legacy Proposal"),
    borshString(""),
  ]);
}

function expectError(err: unknown, errorCode: number): void {
  const hexCode = "0x" + errorCode.toString(16);
  const record =
    typeof err === "object" && err !== null
      ? (err as Record<string, unknown>)
      : {};
  const msg =
    err instanceof Error
      ? err.message
      : typeof record.message === "string"
        ? record.message
        : "";
  const rawLogs = record.logs ?? record.transactionLogs;
  const logs = Array.isArray(rawLogs)
    ? rawLogs.filter((entry): entry is string => typeof entry === "string")
    : [];
  const combined = msg + " " + logs.join(" ");
  expect(
    combined.includes(hexCode) ||
      combined.includes(`custom program error: ${hexCode}`),
    `Expected error code ${hexCode} (${errorCode}) but got: ${combined}`
  ).to.be.true;
}

describe("realms consumer client unit tests", () => {
  const realm = Keypair.generate().publicKey;
  const mint = Keypair.generate().publicKey;
  const voter = Keypair.generate().publicKey;
  const governance = Keypair.generate().publicKey;
  const proposal = Keypair.generate().publicKey;
  const nowSeconds = 1_800_000_000n;
  const recentTimestamp = 1_799_999_000n;

  function buildBaseAccounts(options?: {
    withVwr?: boolean;
    minTrustScore?: number;
    maxVerificationAge?: bigint;
    trustScore?: number;
    lastVerificationTimestamp?: bigint;
    migrationSlot?: bigint | null;
    migrationOwner?: PublicKey;
    proposalVotingAtSlot?: bigint | null;
  }): Map<string, AccountInfo<Buffer>> {
    const pdas = deriveConsumerPdas({
      realm,
      governingTokenMint: mint,
      voter,
    });
    const map = new Map<string, AccountInfo<Buffer>>();

    map.set(
      pdas.registrar.toBase58(),
      makeAccountInfo(
        PLUGIN_PROGRAM_ID,
        encodeRegistrar({
          governanceProgramId: GOVERNANCE_PROGRAM_ID,
          realm,
          governingTokenMint: mint,
          minTrustScore: options?.minTrustScore ?? 100,
          maxVerificationAge: options?.maxVerificationAge ?? 86400n,
        })
      )
    );

    if (options?.withVwr) {
      map.set(
        pdas.voterWeightRecord.toBase58(),
        makeAccountInfo(
          PLUGIN_PROGRAM_ID,
          encodeVoterWeightRecord({
            realm,
            governingTokenMint: mint,
            governingTokenOwner: voter,
            voterWeight: 0n,
            voterWeightExpiry: 0n,
            weightAction: null,
            weightActionTarget: null,
          })
        )
      );
    }

    map.set(
      pdas.identityState.toBase58(),
      makeAccountInfo(
        ENTROS_ANCHOR_PROGRAM_ID,
        encodeIdentityState({
          owner: voter,
          trustScore: options?.trustScore ?? 200,
          lastVerificationTimestamp:
            options?.lastVerificationTimestamp ?? recentTimestamp,
        })
      )
    );

    if (options?.migrationSlot !== undefined && options.migrationSlot !== null) {
      map.set(
        pdas.migrationRecord.toBase58(),
        makeAccountInfo(
          options.migrationOwner ?? ENTROS_ANCHOR_PROGRAM_ID,
          encodeMigrationRecord({ migratedSlot: options.migrationSlot })
        )
      );
    }

    if (options?.proposalVotingAtSlot !== undefined) {
      map.set(
        proposal.toBase58(),
        makeAccountInfo(
          GOVERNANCE_PROGRAM_ID,
          encodeProposalV2({
            governance,
            governingTokenMint: mint,
            state: options.proposalVotingAtSlot === null ? 0 : 2,
            votingAtSlot: options.proposalVotingAtSlot,
          })
        )
      );
    }

    return map;
  }

  describe("PDA derivation and parsers", () => {
    it("derives all four consumer PDAs consistently", () => {
      const pdas = deriveConsumerPdas({
        realm,
        governingTokenMint: mint,
        voter,
      });
      expect(pdas.registrar.equals(deriveRegistrarPda(realm, mint))).to.be.true;
      expect(
        pdas.voterWeightRecord.equals(
          deriveVoterWeightRecordPda(realm, mint, voter)
        )
      ).to.be.true;
      expect(pdas.identityState.equals(deriveIdentityStatePda(voter))).to.be
        .true;
      expect(pdas.migrationRecord.equals(deriveMigrationRecordPda(voter))).to.be
        .true;
    });

    it("parses ProposalV1, ProposalV2 SingleChoice, and ProposalV2 MultiChoice", () => {
      const v1 = parseProposalVotingStartSlot(
        encodeProposalV1({
          governance,
          governingTokenMint: mint,
          state: 2,
          votingAtSlot: 420n,
        })
      );
      expect(v1).to.not.be.null;
      expect(v1!.accountType).to.equal("ProposalV1");
      expect(v1!.votingAtSlot).to.equal(420n);

      const v2Single = parseProposalVotingStartSlot(
        encodeProposalV2({
          governance,
          governingTokenMint: mint,
          state: 2,
          votingAtSlot: 777n,
        })
      );
      expect(v2Single).to.not.be.null;
      expect(v2Single!.accountType).to.equal("ProposalV2");
      expect(v2Single!.votingAtSlot).to.equal(777n);

      const v2Multi = parseProposalVotingStartSlot(
        encodeProposalV2({
          governance,
          governingTokenMint: mint,
          state: 0,
          votingAtSlot: null,
          multiChoice: true,
        })
      );
      expect(v2Multi).to.not.be.null;
      expect(v2Multi!.votingAtSlot).to.be.null;
    });

    it("rejects truncated and wrong-discriminator accounts in parsers", () => {
      expect(parseRegistrarAccount(Buffer.alloc(REGISTRAR_MIN_LEN - 1))).to.be
        .null;
      expect(
        parseIdentityStateAccount(
          encodeIdentityState({
            owner: voter,
            trustScore: 200,
            lastVerificationTimestamp: recentTimestamp,
            discriminator: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
          })
        )
      ).to.be.null;
      expect(
        parseMigrationRecordAccount(
          encodeMigrationRecord({ migratedSlot: 10n, size: 56 })
        )
      ).to.be.null;
      expect(parseVoterWeightRecordAccount(Buffer.alloc(100))).to.be.null;
      expect(parseProposalVotingStartSlot(Buffer.from([14, 0, 1]))).to.be.null;
    });

    it("round-trips an action-bound VoterWeightRecord at variable Borsh offsets", () => {
      const encoded = encodeVoterWeightRecord({
        realm,
        governingTokenMint: mint,
        governingTokenOwner: voter,
        voterWeight: 1n,
        voterWeightExpiry: 42_000n,
        weightAction: VoterWeightActionTag.CastVote,
        weightActionTarget: proposal,
      });
      const decoded = parseVoterWeightRecordAccount(encoded);
      expect(decoded).to.not.be.null;
      expect(decoded!.realm.equals(realm)).to.be.true;
      expect(decoded!.governingTokenMint.equals(mint)).to.be.true;
      expect(decoded!.governingTokenOwner.equals(voter)).to.be.true;
      expect(decoded!.voterWeight).to.equal(1n);
      expect(decoded!.voterWeightExpiry).to.equal(42_000n);
      expect(decoded!.weightAction).to.equal(VoterWeightActionTag.CastVote);
      expect(decoded!.weightActionTarget!.equals(proposal)).to.be.true;
    });
  });

  describe("preflightVoterEligibility", () => {
    it("marks a cold eligible voter with needsCreateVwr=true", async () => {
      const accounts = buildBaseAccounts({
        withVwr: false,
        proposalVotingAtSlot: 500n,
      });
      const result = await preflightVoterEligibility({
        connection: makeMockReader(accounts),
        realm,
        governingTokenMint: mint,
        voter,
        governanceProgramId: GOVERNANCE_PROGRAM_ID,
        action: VoterWeightActionTag.CastVote,
        actionTarget: proposal,
        nowSeconds,
      });

      expect(result.eligible).to.be.true;
      if (result.eligible) {
        expect(result.needsCreateVwr).to.be.true;
        expect(result.trustScore).to.equal(200);
        expect(result.migratedSlot).to.be.null;
        expect(result.votingAtSlot).to.equal(500n);
      }
    });

    it("marks a warm eligible voter with needsCreateVwr=false", async () => {
      const accounts = buildBaseAccounts({
        withVwr: true,
        proposalVotingAtSlot: 500n,
      });
      const result = await preflightVoterEligibility({
        connection: makeMockReader(accounts),
        realm,
        governingTokenMint: mint,
        voter,
        governanceProgramId: GOVERNANCE_PROGRAM_ID,
        action: VoterWeightActionTag.CastVote,
        actionTarget: proposal,
        nowSeconds,
      });

      expect(result.eligible).to.be.true;
      if (result.eligible) {
        expect(result.needsCreateVwr).to.be.false;
      }
    });

    it("rejects default or missing action target on action-bound preflight", async () => {
      const accounts = buildBaseAccounts({ withVwr: true });
      const reader = makeMockReader(accounts);

      const zeroTarget = await preflightVoterEligibility({
        connection: reader,
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: PublicKey.default,
        nowSeconds,
      });
      expect(zeroTarget.eligible).to.be.false;
      if (!zeroTarget.eligible) {
        expect(zeroTarget.reason).to.equal("invalid_weight_action_target");
      }

      const missingTarget = await preflightVoterEligibility({
        connection: reader,
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CreateProposal,
        nowSeconds,
      });
      expect(missingTarget.eligible).to.be.false;
      if (!missingTarget.eligible) {
        expect(missingTarget.reason).to.equal("invalid_weight_action_target");
      }
    });

    it("refuses a migrated wallet for standalone update_voter_weight_record", async () => {
      const accounts = buildBaseAccounts({
        withVwr: true,
        migrationSlot: 10n,
      });
      const result = await preflightVoterEligibility({
        connection: makeMockReader(accounts),
        realm,
        governingTokenMint: mint,
        voter,
        action: null,
        nowSeconds,
      });

      expect(result.eligible).to.be.false;
      if (!result.eligible) {
        expect(result.reason).to.equal("migrated_identity_needs_action_target");
        expect(result.migratedSlot).to.equal(10n);
      }
    });

    it("allows a migrated wallet for non-vote action-bound updates", async () => {
      const accounts = buildBaseAccounts({
        withVwr: false,
        migrationSlot: LATE_MIGRATION_SLOT,
      });
      const result = await preflightVoterEligibility({
        connection: makeMockReader(accounts),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: governance,
        nowSeconds,
      });

      expect(result.eligible).to.be.true;
      if (result.eligible) {
        expect(result.needsCreateVwr).to.be.true;
      }
    });

    it("treats SystemProgram-owned lamports at the migration PDA as no migration", async () => {
      const pdas = deriveConsumerPdas({ realm, governingTokenMint: mint, voter });
      const accounts = buildBaseAccounts({
        withVwr: true,
        proposalVotingAtSlot: 500n,
      });
      accounts.set(
        pdas.migrationRecord.toBase58(),
        makeAccountInfo(SystemProgram.programId, Buffer.alloc(0), 10_000_000)
      );

      const standalone = await preflightVoterEligibility({
        connection: makeMockReader(accounts),
        realm,
        governingTokenMint: mint,
        voter,
        action: null,
        nowSeconds,
      });
      expect(standalone.eligible).to.be.true;
      if (standalone.eligible) {
        expect(standalone.migratedSlot).to.be.null;
      }
    });

    it("enforces strict migratedSlot < votingAtSlot on CastVote", async () => {
      const before = await preflightVoterEligibility({
        connection: makeMockReader(
          buildBaseAccounts({ migrationSlot: 499n, proposalVotingAtSlot: 500n })
        ),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CastVote,
        actionTarget: proposal,
        nowSeconds,
      });
      expect(before.eligible).to.be.true;

      const equalSlot = await preflightVoterEligibility({
        connection: makeMockReader(
          buildBaseAccounts({ migrationSlot: 500n, proposalVotingAtSlot: 500n })
        ),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CastVote,
        actionTarget: proposal,
        nowSeconds,
      });
      expect(equalSlot.eligible).to.be.false;
      if (!equalSlot.eligible) {
        expect(equalSlot.reason).to.equal("identity_migrated_after_voting_start");
        expect(equalSlot.migratedSlot).to.equal(500n);
        expect(equalSlot.votingAtSlot).to.equal(500n);
      }

      const afterSlot = await preflightVoterEligibility({
        connection: makeMockReader(
          buildBaseAccounts({ migrationSlot: 501n, proposalVotingAtSlot: 500n })
        ),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CastVote,
        actionTarget: proposal,
        nowSeconds,
      });
      expect(afterSlot.eligible).to.be.false;
      if (!afterSlot.eligible) {
        expect(afterSlot.reason).to.equal("identity_migrated_after_voting_start");
      }
    });

    it("rejects draft, completed, and invalid proposal accounts for CastVote", async () => {
      const draft = await preflightVoterEligibility({
        connection: makeMockReader(
          buildBaseAccounts({ migrationSlot: 10n, proposalVotingAtSlot: null })
        ),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CastVote,
        actionTarget: proposal,
        nowSeconds,
      });
      expect(draft.eligible).to.be.false;
      if (!draft.eligible) {
        expect(draft.reason).to.equal("proposal_not_in_voting");
      }

      const closedAccounts = buildBaseAccounts({ migrationSlot: 10n });
      closedAccounts.set(
        proposal.toBase58(),
        makeAccountInfo(
          GOVERNANCE_PROGRAM_ID,
          encodeProposalV2({
            governance,
            governingTokenMint: mint,
            state: 3, // ProposalState::Succeeded
            votingAtSlot: 500n,
          })
        )
      );
      const closed = await preflightVoterEligibility({
        connection: makeMockReader(closedAccounts),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CastVote,
        actionTarget: proposal,
        nowSeconds,
      });
      expect(closed.eligible).to.be.false;
      if (!closed.eligible) {
        expect(closed.reason).to.equal("proposal_not_in_voting");
      }

      const missingProposal = await preflightVoterEligibility({
        connection: makeMockReader(buildBaseAccounts({ migrationSlot: 10n })),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CastVote,
        actionTarget: proposal,
        nowSeconds,
      });
      expect(missingProposal.eligible).to.be.false;
      if (!missingProposal.eligible) {
        expect(missingProposal.reason).to.equal("invalid_proposal_account");
      }
    });

    it("rejects missing registrar, mismatched governance program, and missing identity", async () => {
      const emptyResult = await preflightVoterEligibility({
        connection: makeMockReader(new Map()),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: governance,
        nowSeconds,
      });
      expect(emptyResult.eligible).to.be.false;
      if (!emptyResult.eligible) {
        expect(emptyResult.reason).to.equal("registrar_not_found");
      }

      const mismatchGov = await preflightVoterEligibility({
        connection: makeMockReader(buildBaseAccounts()),
        realm,
        governingTokenMint: mint,
        voter,
        governanceProgramId: Keypair.generate().publicKey,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: governance,
        nowSeconds,
      });
      expect(mismatchGov.eligible).to.be.false;
      if (!mismatchGov.eligible) {
        expect(mismatchGov.reason).to.equal("governance_program_mismatch");
      }

      const pdas = deriveConsumerPdas({ realm, governingTokenMint: mint, voter });
      const noIdentityAccounts = buildBaseAccounts();
      noIdentityAccounts.delete(pdas.identityState.toBase58());
      const missingIdentity = await preflightVoterEligibility({
        connection: makeMockReader(noIdentityAccounts),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: governance,
        nowSeconds,
      });
      expect(missingIdentity.eligible).to.be.false;
      if (!missingIdentity.eligible) {
        expect(missingIdentity.reason).to.equal("identity_not_found");
      }
    });

    it("rejects insufficient trust score, expired verification, and malformed accounts", async () => {
      const lowScore = await preflightVoterEligibility({
        connection: makeMockReader(
          buildBaseAccounts({ trustScore: 99, minTrustScore: 100 })
        ),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: governance,
        nowSeconds,
      });
      expect(lowScore.eligible).to.be.false;
      if (!lowScore.eligible) {
        expect(lowScore.reason).to.equal("insufficient_trust_score");
      }

      // Exact boundary: age === maxVerificationAge must fail (strict `<`).
      const expired = await preflightVoterEligibility({
        connection: makeMockReader(
          buildBaseAccounts({
            maxVerificationAge: 1000n,
            lastVerificationTimestamp: nowSeconds - 1000n,
          })
        ),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: governance,
        nowSeconds,
      });
      expect(expired.eligible).to.be.false;
      if (!expired.eligible) {
        expect(expired.reason).to.equal("verification_expired");
      }

      const pdas = deriveConsumerPdas({ realm, governingTokenMint: mint, voter });
      const wrongOwnerAccounts = buildBaseAccounts();
      wrongOwnerAccounts.set(
        pdas.identityState.toBase58(),
        makeAccountInfo(
          PLUGIN_PROGRAM_ID,
          encodeIdentityState({
            owner: voter,
            trustScore: 200,
            lastVerificationTimestamp: recentTimestamp,
          })
        )
      );
      const wrongOwner = await preflightVoterEligibility({
        connection: makeMockReader(wrongOwnerAccounts),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: governance,
        nowSeconds,
      });
      expect(wrongOwner.eligible).to.be.false;
      if (!wrongOwner.eligible) {
        expect(wrongOwner.reason).to.equal("invalid_identity_owner");
      }

      const badMigrationAccounts = buildBaseAccounts({
        proposalVotingAtSlot: 500n,
      });
      badMigrationAccounts.set(
        pdas.migrationRecord.toBase58(),
        makeAccountInfo(
          ENTROS_ANCHOR_PROGRAM_ID,
          encodeMigrationRecord({ migratedSlot: 10n, size: 40 })
        )
      );
      const badMigration = await preflightVoterEligibility({
        connection: makeMockReader(badMigrationAccounts),
        realm,
        governingTokenMint: mint,
        voter,
        action: VoterWeightActionTag.CastVote,
        actionTarget: proposal,
        nowSeconds,
      });
      expect(badMigration.eligible).to.be.false;
      if (!badMigration.eligible) {
        expect(badMigration.reason).to.equal("invalid_migration_record_data");
      }
    });
  });

  describe("atomic transaction composition", () => {
    const dummyGovIx = new TransactionInstruction({
      programId: GOVERNANCE_PROGRAM_ID,
      keys: [{ pubkey: realm, isSigner: false, isWritable: false }],
      data: Buffer.from([6]),
    });

    it("prepends create_voter_weight_record when needsCreateVwr is true", () => {
      const separatePayer = Keypair.generate().publicKey;
      const built = buildAtomicGovernanceTransaction({
        realm,
        governingTokenMint: mint,
        voter,
        payer: separatePayer,
        needsCreateVwr: true,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: governance,
        governanceInstructions: dummyGovIx,
      });

      expect(built.transaction.instructions).to.have.lengthOf(3);
      const createIx = built.instructions[0];
      expect(
        createIx.data
          .subarray(0, 8)
          .equals(anchorDiscriminator("create_voter_weight_record"))
      ).to.be.true;
      expect(createIx.keys[2].pubkey.equals(voter)).to.be.true;
      expect(createIx.keys[2].isSigner).to.be.true;
      expect(createIx.keys[3].pubkey.equals(separatePayer)).to.be.true;
      expect(createIx.keys[3].isSigner).to.be.true;
      expect(createIx.keys[3].isWritable).to.be.true;
      expect(
        built.instructions[1].data
          .subarray(0, 8)
          .equals(anchorDiscriminator("update_voter_weight_record_for_action"))
      ).to.be.true;
      // Non-vote action passes only [registrar, vwr, voter, identityState].
      expect(built.instructions[1].keys).to.have.lengthOf(4);
      expect(
        built.instructions[1].keys[3].pubkey.equals(built.pdas.identityState)
      ).to.be.true;
      expect(built.instructions[2]).to.equal(dummyGovIx);
    });

    it("omits create_voter_weight_record when warm and appends migration + proposal accounts for CastVote", () => {
      const built = buildAtomicGovernanceInstructions({
        realm,
        governingTokenMint: mint,
        voter,
        needsCreateVwr: false,
        action: VoterWeightActionTag.CastVote,
        actionTarget: proposal,
        governanceInstructions: dummyGovIx,
      });

      expect(built.instructions).to.have.lengthOf(2);
      const updateIx = built.instructions[0];
      expect(
        updateIx.data
          .subarray(0, 8)
          .equals(anchorDiscriminator("update_voter_weight_record_for_action"))
      ).to.be.true;
      expect(updateIx.data.readUInt8(8)).to.equal(VoterWeightActionTag.CastVote);
      expect(new PublicKey(updateIx.data.subarray(9, 41)).equals(proposal)).to
        .be.true;
      // CastVote passes [registrar, vwr, voter, identityState, migrationRecord, proposal].
      expect(updateIx.keys).to.have.lengthOf(6);
      expect(updateIx.keys[3].pubkey.equals(built.pdas.identityState)).to.be
        .true;
      expect(updateIx.keys[4].pubkey.equals(built.pdas.migrationRecord)).to.be
        .true;
      expect(updateIx.keys[5].pubkey.equals(proposal)).to.be.true;
    });

    it("throws on default action target or empty governance instructions", () => {
      expect(() =>
        buildAtomicGovernanceTransaction({
          realm,
          governingTokenMint: mint,
          voter,
          needsCreateVwr: false,
          action: VoterWeightActionTag.CreateGovernance,
          actionTarget: PublicKey.default,
          governanceInstructions: dummyGovIx,
        })
      ).to.throw("non-default weight action target");

      expect(() =>
        buildAtomicGovernanceTransaction({
          realm,
          governingTokenMint: mint,
          voter,
          needsCreateVwr: false,
          action: VoterWeightActionTag.CreateGovernance,
          actionTarget: realm,
          governanceInstructions: [],
        })
      ).to.throw("At least one governance instruction");
    });
  });
});

describe("realms atomic consumer localnet harness", () => {
  const connection = new Connection("http://localhost:8899", "confirmed");
  const payer = VOTER_A;

  let realmAuthority: Keypair;
  let communityMint: PublicKey;
  let realmPda: PublicKey;
  let registrarPda: PublicKey;
  let governancePda: PublicKey;
  let votingProposalPda: PublicKey;

  const tokenOwnerRecords = new Map<string, PublicKey>();

  const torOf = (voter: Keypair): PublicKey => {
    const tor = tokenOwnerRecords.get(voter.publicKey.toBase58());
    if (!tor) {
      throw new Error(`Missing TokenOwnerRecord for ${voter.publicKey.toBase58()}`);
    }
    return tor;
  };

  async function waitForSlotAfter(targetSlot: bigint): Promise<void> {
    for (let attempt = 0; attempt < 60; attempt++) {
      const current = BigInt(await connection.getSlot("confirmed"));
      if (current > targetSlot) {
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error(`Timed out waiting for slot > ${targetSlot.toString()}`);
  }

  before(async () => {
    realmAuthority = Keypair.generate();
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: realmAuthority.publicKey,
          lamports: LAMPORTS_PER_SOL,
        })
      ),
      [payer]
    );

    // Create an isolated mint with supply 100 so a single binary vote keeps the proposal in Voting.
    const mintKeypair = Keypair.generate();
    const mintRent = await getMinimumBalanceForRentExemptMint(connection);
    const supplyAta = getAssociatedTokenAddressSync(
      mintKeypair.publicKey,
      payer.publicKey
    );
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
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
      ),
      [payer, mintKeypair]
    );
    communityMint = mintKeypair.publicKey;

    const realm = buildCreateRealmInstruction(
      `Consumer-Harness-${Date.now().toString(36)}`,
      realmAuthority.publicKey,
      communityMint,
      payer.publicKey,
      PLUGIN_PROGRAM_ID
    );
    realmPda = realm.realmPda;
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(realm.instruction),
      [payer]
    );

    const registrar = buildCreateRegistrarInstruction(
      realmPda,
      communityMint,
      realmAuthority.publicKey,
      payer.publicKey,
      100,
      2_000_000_000n
    );
    registrarPda = registrar.registrarPda;
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(registrar.instruction),
      [payer, realmAuthority]
    );

    // Create TokenOwnerRecords for each fixture voter without creating any VoterWeightRecords.
    for (const voter of [VOTER_A, VOTER_B, VOTER_C, VOTER_D, VOTER_E]) {
      const tor = buildCreateTokenOwnerRecordInstruction(
        realmPda,
        voter.publicKey,
        communityMint,
        payer.publicKey
      );
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(tor.instruction),
        [payer]
      );
      tokenOwnerRecords.set(voter.publicKey.toBase58(), tor.tokenOwnerRecordPda);
    }

    // Realm authority creates the Governance so all voters begin cold without a VWR.
    const gov = buildCreateGovernanceInstruction(
      realmPda,
      Keypair.generate().publicKey,
      torOf(VOTER_A),
      payer.publicKey,
      realmAuthority.publicKey
    );
    governancePda = gov.governancePda;
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(gov.instruction),
      [payer, realmAuthority]
    );
  });

  it("atomically creates VWR, updates action-bound weight, and runs CreateProposal for a cold voter", async () => {
    const preflight = await preflightVoterEligibility({
      connection,
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_A.publicKey,
      governanceProgramId: GOVERNANCE_PROGRAM_ID,
      action: VoterWeightActionTag.CreateProposal,
      actionTarget: governancePda,
    });

    expect(preflight.eligible).to.be.true;
    if (!preflight.eligible) {
      expect.fail(`Expected eligible cold voter, got ${preflight.reason}`);
    }
    expect(preflight.needsCreateVwr).to.be.true;

    const createProposal = buildCreateProposalInstruction(
      realmPda,
      governancePda,
      torOf(VOTER_A),
      communityMint,
      VOTER_A.publicKey,
      VOTER_A.publicKey,
      Keypair.generate().publicKey,
      preflight.pdas.voterWeightRecord,
      "Atomic consumer proposal"
    );

    const built = buildAtomicGovernanceTransaction({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_A.publicKey,
      payer: VOTER_A.publicKey,
      needsCreateVwr: preflight.needsCreateVwr,
      action: VoterWeightActionTag.CreateProposal,
      actionTarget: governancePda,
      governanceInstructions: createProposal.instruction,
    });
    expect(built.transaction.instructions).to.have.lengthOf(3);

    const preSlot = BigInt(await connection.getSlot("confirmed"));
    await sendAndConfirmTransaction(connection, built.transaction, [VOTER_A]);
    const postSlot = BigInt(await connection.getSlot("confirmed"));

    votingProposalPda = createProposal.proposalPda;
    const proposalAccount = await connection.getAccountInfo(votingProposalPda);
    expect(proposalAccount).to.not.be.null;

    const vwrAccount = await connection.getAccountInfo(
      built.pdas.voterWeightRecord
    );
    expect(vwrAccount).to.not.be.null;
    const parsedVwr = parseVoterWeightRecordAccount(vwrAccount!.data);
    expect(parsedVwr).to.not.be.null;
    expect(parsedVwr!.voterWeight).to.equal(1n);
    expect(parsedVwr!.voterWeightExpiry).to.not.be.null;
    expect(parsedVwr!.voterWeightExpiry! >= preSlot).to.be.true;
    expect(parsedVwr!.voterWeightExpiry! <= postSlot).to.be.true;
    expect(parsedVwr!.weightAction).to.equal(
      VoterWeightActionTag.CreateProposal
    );
    expect(parsedVwr!.weightActionTarget!.equals(governancePda)).to.be.true;

    // Sign off the proposal so it enters Voting state for CastVote tests.
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        buildSignOffProposalInstruction(
          realmPda,
          governancePda,
          votingProposalPda,
          VOTER_A.publicKey,
          torOf(VOTER_A)
        )
      ),
      [VOTER_A]
    );

    const signedOffAccount = await connection.getAccountInfo(votingProposalPda);
    const parsedProposal = parseProposalVotingStartSlot(signedOffAccount!.data);
    expect(parsedProposal).to.not.be.null;
    expect(parsedProposal!.votingAtSlot).to.not.be.null;
    expect(parsedProposal!.votingAtSlot! > 0n).to.be.true;
  });

  it("atomically updates an existing VWR and executes CastVote in one transaction", async () => {
    const preflight = await preflightVoterEligibility({
      connection,
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_A.publicKey,
      governanceProgramId: GOVERNANCE_PROGRAM_ID,
      action: VoterWeightActionTag.CastVote,
      actionTarget: votingProposalPda,
    });

    expect(preflight.eligible).to.be.true;
    if (!preflight.eligible) {
      expect.fail(`Expected eligible warm voter, got ${preflight.reason}`);
    }
    expect(preflight.needsCreateVwr).to.be.false;
    expect(preflight.migratedSlot).to.be.null;
    expect(preflight.votingAtSlot).to.not.be.null;

    const castVote = buildCastVoteInstruction(
      realmPda,
      governancePda,
      votingProposalPda,
      torOf(VOTER_A),
      torOf(VOTER_A),
      VOTER_A.publicKey,
      communityMint,
      VOTER_A.publicKey,
      preflight.pdas.voterWeightRecord
    );

    const built = buildAtomicGovernanceTransaction({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_A.publicKey,
      needsCreateVwr: preflight.needsCreateVwr,
      action: VoterWeightActionTag.CastVote,
      actionTarget: votingProposalPda,
      governanceInstructions: castVote.instruction,
    });
    expect(built.transaction.instructions).to.have.lengthOf(2);

    const preSlot = BigInt(await connection.getSlot("confirmed"));
    await sendAndConfirmTransaction(connection, built.transaction, [VOTER_A]);
    const postSlot = BigInt(await connection.getSlot("confirmed"));

    expect(await connection.getAccountInfo(castVote.voteRecordPda)).to.not.be
      .null;

    const vwrAccount = await connection.getAccountInfo(
      built.pdas.voterWeightRecord
    );
    const parsedVwr = parseVoterWeightRecordAccount(vwrAccount!.data);
    expect(parsedVwr).to.not.be.null;
    expect(parsedVwr!.voterWeight).to.equal(1n);
    expect(parsedVwr!.voterWeightExpiry! >= preSlot).to.be.true;
    expect(parsedVwr!.voterWeightExpiry! <= postSlot).to.be.true;
    expect(parsedVwr!.weightAction).to.equal(VoterWeightActionTag.CastVote);
    expect(parsedVwr!.weightActionTarget!.equals(votingProposalPda)).to.be.true;
  });

  it("passes pre-flight and atomically casts a vote for a pre-voting migrated cold voter (VOTER_D)", async () => {
    const standalonePreflight = await preflightVoterEligibility({
      connection,
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_D.publicKey,
      governanceProgramId: GOVERNANCE_PROGRAM_ID,
      action: null,
    });
    expect(standalonePreflight.eligible).to.be.false;
    if (!standalonePreflight.eligible) {
      expect(standalonePreflight.reason).to.equal(
        "migrated_identity_needs_action_target"
      );
    }

    const preflight = await preflightVoterEligibility({
      connection,
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_D.publicKey,
      governanceProgramId: GOVERNANCE_PROGRAM_ID,
      action: VoterWeightActionTag.CastVote,
      actionTarget: votingProposalPda,
    });
    expect(preflight.eligible).to.be.true;
    if (!preflight.eligible) {
      expect.fail(`Expected VOTER_D eligible, got ${preflight.reason}`);
    }
    expect(preflight.needsCreateVwr).to.be.true;
    expect(preflight.migratedSlot).to.equal(0n);
    expect(preflight.votingAtSlot! > 0n).to.be.true;

    const castVote = buildCastVoteInstruction(
      realmPda,
      governancePda,
      votingProposalPda,
      torOf(VOTER_A),
      torOf(VOTER_D),
      VOTER_D.publicKey,
      communityMint,
      VOTER_D.publicKey,
      preflight.pdas.voterWeightRecord
    );

    const built = buildAtomicGovernanceTransaction({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_D.publicKey,
      needsCreateVwr: preflight.needsCreateVwr,
      action: VoterWeightActionTag.CastVote,
      actionTarget: votingProposalPda,
      governanceInstructions: castVote.instruction,
    });
    expect(built.transaction.instructions).to.have.lengthOf(3);

    const preSlot = BigInt(await connection.getSlot("confirmed"));
    await sendAndConfirmTransaction(connection, built.transaction, [VOTER_D]);
    const postSlot = BigInt(await connection.getSlot("confirmed"));

    expect(await connection.getAccountInfo(castVote.voteRecordPda)).to.not.be
      .null;
    const vwrAccount = await connection.getAccountInfo(
      built.pdas.voterWeightRecord
    );
    const parsedVwr = parseVoterWeightRecordAccount(vwrAccount!.data);
    expect(parsedVwr).to.not.be.null;
    expect(parsedVwr!.voterWeight).to.equal(1n);
    expect(parsedVwr!.voterWeightExpiry! >= preSlot).to.be.true;
    expect(parsedVwr!.voterWeightExpiry! <= postSlot).to.be.true;
    expect(parsedVwr!.weightAction).to.equal(VoterWeightActionTag.CastVote);
    expect(parsedVwr!.weightActionTarget!.equals(votingProposalPda)).to.be.true;
  });

  it("rejects a post-voting migrated voter (VOTER_E) in pre-flight and on-chain", async () => {
    const preflight = await preflightVoterEligibility({
      connection,
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_E.publicKey,
      governanceProgramId: GOVERNANCE_PROGRAM_ID,
      action: VoterWeightActionTag.CastVote,
      actionTarget: votingProposalPda,
    });
    expect(preflight.eligible).to.be.false;
    if (!preflight.eligible) {
      expect(preflight.reason).to.equal("identity_migrated_after_voting_start");
      expect(preflight.migratedSlot).to.equal(LATE_MIGRATION_SLOT);
      expect(preflight.votingAtSlot).to.not.be.null;
    }

    const castVote = buildCastVoteInstruction(
      realmPda,
      governancePda,
      votingProposalPda,
      torOf(VOTER_A),
      torOf(VOTER_E),
      VOTER_E.publicKey,
      communityMint,
      VOTER_E.publicKey,
      preflight.pdas.voterWeightRecord
    );

    const built = buildAtomicGovernanceTransaction({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_E.publicKey,
      needsCreateVwr: true,
      action: VoterWeightActionTag.CastVote,
      actionTarget: votingProposalPda,
      governanceInstructions: castVote.instruction,
    });

    try {
      await sendAndConfirmTransaction(connection, built.transaction, [VOTER_E]);
      expect.fail("Should have failed with IdentityMigratedAfterVotingStart");
    } catch (err) {
      expectError(err, 6022); // EntrosVoterError::IdentityMigratedAfterVotingStart
    }

    // Atomic rollback leaves neither VWR nor VoteRecord on-chain.
    expect(await connection.getAccountInfo(built.pdas.voterWeightRecord)).to.be
      .null;
    expect(await connection.getAccountInfo(castVote.voteRecordPda)).to.be.null;
  });

  it("rejects insufficient trust score (VOTER_B) in pre-flight and on-chain", async () => {
    const preflight = await preflightVoterEligibility({
      connection,
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_B.publicKey,
      governanceProgramId: GOVERNANCE_PROGRAM_ID,
      action: VoterWeightActionTag.CastVote,
      actionTarget: votingProposalPda,
    });
    expect(preflight.eligible).to.be.false;
    if (!preflight.eligible) {
      expect(preflight.reason).to.equal("insufficient_trust_score");
      expect(preflight.trustScore).to.equal(50);
      expect(preflight.minTrustScore).to.equal(100);
    }

    const castVote = buildCastVoteInstruction(
      realmPda,
      governancePda,
      votingProposalPda,
      torOf(VOTER_A),
      torOf(VOTER_B),
      VOTER_B.publicKey,
      communityMint,
      VOTER_B.publicKey,
      preflight.pdas.voterWeightRecord
    );
    const built = buildAtomicGovernanceTransaction({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_B.publicKey,
      needsCreateVwr: true,
      action: VoterWeightActionTag.CastVote,
      actionTarget: votingProposalPda,
      governanceInstructions: castVote.instruction,
    });

    try {
      await sendAndConfirmTransaction(connection, built.transaction, [VOTER_B]);
      expect.fail("Should have failed with InsufficientTrustScore");
    } catch (err) {
      expectError(err, 6005); // EntrosVoterError::InsufficientTrustScore
    }

    expect(await connection.getAccountInfo(built.pdas.voterWeightRecord)).to.be
      .null;
    expect(await connection.getAccountInfo(castVote.voteRecordPda)).to.be.null;
  });

  it("rejects wrong identity discriminator (VOTER_C) in pre-flight and on-chain", async () => {
    const preflight = await preflightVoterEligibility({
      connection,
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_C.publicKey,
      governanceProgramId: GOVERNANCE_PROGRAM_ID,
      action: VoterWeightActionTag.CreateProposal,
      actionTarget: governancePda,
    });
    expect(preflight.eligible).to.be.false;
    if (!preflight.eligible) {
      expect(preflight.reason).to.equal("invalid_identity_data");
    }

    const createProposal = buildCreateProposalInstruction(
      realmPda,
      governancePda,
      torOf(VOTER_C),
      communityMint,
      VOTER_C.publicKey,
      VOTER_C.publicKey,
      Keypair.generate().publicKey,
      preflight.pdas.voterWeightRecord,
      "Bad discriminator proposal"
    );
    const built = buildAtomicGovernanceTransaction({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_C.publicKey,
      needsCreateVwr: true,
      action: VoterWeightActionTag.CreateProposal,
      actionTarget: governancePda,
      governanceInstructions: createProposal.instruction,
    });

    try {
      await sendAndConfirmTransaction(connection, built.transaction, [VOTER_C]);
      expect.fail("Should have failed with InvalidIdentityData");
    } catch (err) {
      expectError(err, 6004); // EntrosVoterError::InvalidIdentityData
    }
    expect(await connection.getAccountInfo(built.pdas.voterWeightRecord)).to.be
      .null;
  });

  it("rejects stale verification in pre-flight and on-chain (VerificationExpired)", async () => {
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(
        buildUpdateRegistrarInstruction(
          registrarPda,
          realmPda,
          realmAuthority.publicKey,
          100,
          1n
        )
      ),
      [realmAuthority]
    );

    try {
      const preflight = await preflightVoterEligibility({
        connection,
        realm: realmPda,
        governingTokenMint: communityMint,
        voter: VOTER_A.publicKey,
        governanceProgramId: GOVERNANCE_PROGRAM_ID,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: governancePda,
      });
      expect(preflight.eligible).to.be.false;
      if (!preflight.eligible) {
        expect(preflight.reason).to.equal("verification_expired");
      }

      const createProposal = buildCreateProposalInstruction(
        realmPda,
        governancePda,
        torOf(VOTER_A),
        communityMint,
        VOTER_A.publicKey,
        VOTER_A.publicKey,
        Keypair.generate().publicKey,
        preflight.pdas.voterWeightRecord,
        "Expired verification proposal"
      );
      const built = buildAtomicGovernanceTransaction({
        realm: realmPda,
        governingTokenMint: communityMint,
        voter: VOTER_A.publicKey,
        needsCreateVwr: false,
        action: VoterWeightActionTag.CreateProposal,
        actionTarget: governancePda,
        governanceInstructions: createProposal.instruction,
      });

      try {
        await sendAndConfirmTransaction(connection, built.transaction, [
          VOTER_A,
        ]);
        expect.fail("Should have failed with VerificationExpired");
      } catch (err) {
        expectError(err, 6006); // EntrosVoterError::VerificationExpired
      }
    } finally {
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          buildUpdateRegistrarInstruction(
            registrarPda,
            realmPda,
            realmAuthority.publicKey,
            100,
            2_000_000_000n
          )
        ),
        [realmAuthority]
      );
    }
  });

  it("rejects wrong action binding in spl-governance (VoterWeightRecordInvalidAction)", async () => {
    const pdas = deriveConsumerPdas({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_A.publicKey,
    });
    const createProposal = buildCreateProposalInstruction(
      realmPda,
      governancePda,
      torOf(VOTER_A),
      communityMint,
      VOTER_A.publicKey,
      VOTER_A.publicKey,
      Keypair.generate().publicKey,
      pdas.voterWeightRecord,
      "Wrong action proposal"
    );

    const built = buildAtomicGovernanceTransaction({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_A.publicKey,
      needsCreateVwr: false,
      action: VoterWeightActionTag.CreateGovernance,
      actionTarget: governancePda,
      governanceInstructions: createProposal.instruction,
    });

    try {
      await sendAndConfirmTransaction(connection, built.transaction, [VOTER_A]);
      expect.fail("Should have failed with VoterWeightRecordInvalidAction");
    } catch (err) {
      expectError(err, 587); // GovernanceError::VoterWeightRecordInvalidAction (0x24b)
    }
  });

  it("rejects wrong action target in spl-governance (VoterWeightRecordInvalidActionTarget)", async () => {
    const pdas = deriveConsumerPdas({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_A.publicKey,
    });
    const createProposal = buildCreateProposalInstruction(
      realmPda,
      governancePda,
      torOf(VOTER_A),
      communityMint,
      VOTER_A.publicKey,
      VOTER_A.publicKey,
      Keypair.generate().publicKey,
      pdas.voterWeightRecord,
      "Wrong target proposal"
    );

    const built = buildAtomicGovernanceTransaction({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_A.publicKey,
      needsCreateVwr: false,
      action: VoterWeightActionTag.CreateProposal,
      actionTarget: Keypair.generate().publicKey,
      governanceInstructions: createProposal.instruction,
    });

    try {
      await sendAndConfirmTransaction(connection, built.transaction, [VOTER_A]);
      expect.fail(
        "Should have failed with VoterWeightRecordInvalidActionTarget"
      );
    } catch (err) {
      expectError(err, 588); // GovernanceError::VoterWeightRecordInvalidActionTarget (0x24c)
    }
  });

  it("rejects cross-slot delayed settlement in spl-governance (VoterWeightRecordExpired)", async () => {
    const pdas = deriveConsumerPdas({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_A.publicKey,
    });
    const createProposal = buildCreateProposalInstruction(
      realmPda,
      governancePda,
      torOf(VOTER_A),
      communityMint,
      VOTER_A.publicKey,
      VOTER_A.publicKey,
      Keypair.generate().publicKey,
      pdas.voterWeightRecord,
      "Delayed proposal"
    );

    const built = buildAtomicGovernanceInstructions({
      realm: realmPda,
      governingTokenMint: communityMint,
      voter: VOTER_A.publicKey,
      needsCreateVwr: false,
      action: VoterWeightActionTag.CreateProposal,
      actionTarget: governancePda,
      governanceInstructions: createProposal.instruction,
    });
    const [updateIx, proposalIx] = built.instructions;

    // Submit the weight update alone in transaction 1.
    await sendAndConfirmTransaction(
      connection,
      new Transaction().add(updateIx),
      [VOTER_A]
    );

    const vwrAccount = await connection.getAccountInfo(pdas.voterWeightRecord);
    const parsedVwr = parseVoterWeightRecordAccount(vwrAccount!.data);
    expect(parsedVwr).to.not.be.null;
    expect(parsedVwr!.voterWeightExpiry).to.not.be.null;

    // Wait for the chain to advance past Some(clock.slot).
    await waitForSlotAfter(parsedVwr!.voterWeightExpiry!);

    try {
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(proposalIx),
        [VOTER_A]
      );
      expect.fail("Should have failed with VoterWeightRecordExpired");
    } catch (err) {
      expectError(err, 577); // GovernanceError::VoterWeightRecordExpired (0x241)
    }
  });
});
