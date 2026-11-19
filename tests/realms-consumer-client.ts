import {
  AccountInfo,
  Commitment,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import * as crypto from "crypto";
import {
  ENTROS_ANCHOR_PROGRAM_ID,
  GOVERNANCE_PROGRAM_ID,
  PLUGIN_PROGRAM_ID,
  VoterWeightActionTag,
  anchorDiscriminator,
} from "./helpers";

export {
  ENTROS_ANCHOR_PROGRAM_ID,
  GOVERNANCE_PROGRAM_ID,
  PLUGIN_PROGRAM_ID,
  VoterWeightActionTag,
};

export const REGISTRAR_DISCRIMINATOR = accountDiscriminator("Registrar");
export const REGISTRAR_MIN_LEN = 178;

export const IDENTITY_STATE_DISCRIMINATOR = Buffer.from([
  156, 32, 87, 93, 52, 155, 248, 207,
]);
export const IDENTITY_STATE_MIN_LEN = 62;
export const IDENTITY_LAST_VERIFICATION_OFFSET = 48;
export const IDENTITY_TRUST_SCORE_OFFSET = 60;

export const MIGRATION_RECORD_DISCRIMINATOR = Buffer.from([
  16, 36, 116, 243, 192, 61, 40, 1,
]);
export const MIGRATION_RECORD_MIN_LEN = 57;
export const MIGRATION_RECORD_SLOT_OFFSET = 16;

export const VOTER_WEIGHT_RECORD_DISCRIMINATOR = Buffer.from([
  46, 249, 155, 75, 153, 248, 116, 9,
]);

const I64_MIN = -(1n << 63n);
const I64_MAX = (1n << 63n) - 1n;

const GOVERNANCE_ACCOUNT_TYPE_PROPOSAL_V1 = 5;
const GOVERNANCE_ACCOUNT_TYPE_PROPOSAL_V2 = 14;
const PROPOSAL_STATE_VOTING = 2;
const MAX_PROPOSAL_STATE = 9;

export interface AccountInfoReader {
  getAccountInfo(
    publicKey: PublicKey,
    commitmentOrConfig?: Commitment
  ): Promise<AccountInfo<Buffer> | null>;
  getMultipleAccountsInfo?(
    publicKeys: PublicKey[],
    commitmentOrConfig?: Commitment
  ): Promise<(AccountInfo<Buffer> | null)[]>;
}

export interface ConsumerPdas {
  registrar: PublicKey;
  voterWeightRecord: PublicKey;
  identityState: PublicKey;
  migrationRecord: PublicKey;
}

export interface ParsedRegistrar {
  governanceProgramId: PublicKey;
  realm: PublicKey;
  governingTokenMint: PublicKey;
  minTrustScore: number;
  maxVerificationAge: bigint;
}

export interface ParsedIdentityState {
  owner: PublicKey;
  creationTimestamp: bigint;
  lastVerificationTimestamp: bigint;
  verificationCount: number;
  trustScore: number;
}

export interface ParsedMigrationRecord {
  migratedAt: bigint;
  migratedSlot: bigint;
  bump: number;
  previousWallet: PublicKey;
}

export interface ParsedVoterWeightRecord {
  realm: PublicKey;
  governingTokenMint: PublicKey;
  governingTokenOwner: PublicKey;
  voterWeight: bigint;
  voterWeightExpiry: bigint | null;
  weightAction: VoterWeightActionTag | null;
  weightActionTarget: PublicKey | null;
}

export interface ParsedProposalVotingInfo {
  accountType: "ProposalV1" | "ProposalV2";
  governance: PublicKey;
  governingTokenMint: PublicKey;
  state: number;
  votingAtSlot: bigint | null;
}

export type PreflightIneligibilityReason =
  | "invalid_weight_action_target"
  | "registrar_not_found"
  | "invalid_registrar_owner"
  | "invalid_registrar_data"
  | "governance_program_mismatch"
  | "invalid_voter_weight_record"
  | "identity_not_found"
  | "invalid_identity_owner"
  | "invalid_identity_data"
  | "insufficient_trust_score"
  | "verification_expired"
  | "invalid_migration_record_data"
  | "migrated_identity_needs_action_target"
  | "invalid_proposal_account"
  | "proposal_not_in_voting"
  | "identity_migrated_after_voting_start";

export interface PreflightEligibleResult {
  eligible: true;
  needsCreateVwr: boolean;
  pdas: ConsumerPdas;
  registrar: ParsedRegistrar;
  trustScore: number;
  lastVerificationTimestamp: bigint;
  verificationAgeSeconds: bigint;
  migratedSlot: bigint | null;
  votingAtSlot: bigint | null;
}

export interface PreflightIneligibleResult {
  eligible: false;
  reason: PreflightIneligibilityReason;
  message: string;
  needsCreateVwr?: boolean;
  pdas: ConsumerPdas;
  trustScore?: number;
  minTrustScore?: number;
  lastVerificationTimestamp?: bigint;
  verificationAgeSeconds?: bigint;
  maxVerificationAge?: bigint;
  migratedSlot?: bigint | null;
  votingAtSlot?: bigint | null;
}

export type PreflightVoterEligibilityResult =
  | PreflightEligibleResult
  | PreflightIneligibleResult;

export interface PreflightVoterEligibilityParams {
  connection: AccountInfoReader;
  realm: PublicKey;
  governingTokenMint: PublicKey;
  voter: PublicKey;
  governanceProgramId?: PublicKey;
  pluginProgramId?: PublicKey;
  entrosAnchorProgramId?: PublicKey;
  action?: VoterWeightActionTag | null;
  actionTarget?: PublicKey | null;
  nowSeconds?: number | bigint;
  commitment?: Commitment;
}

export interface BuildAtomicGovernanceParams {
  realm: PublicKey;
  governingTokenMint: PublicKey;
  voter: PublicKey;
  payer?: PublicKey;
  needsCreateVwr: boolean;
  action: VoterWeightActionTag;
  actionTarget: PublicKey;
  governanceInstructions:
    | TransactionInstruction
    | readonly TransactionInstruction[];
  pluginProgramId?: PublicKey;
  entrosAnchorProgramId?: PublicKey;
}

export interface BuiltAtomicGovernanceInstructions {
  instructions: TransactionInstruction[];
  pdas: ConsumerPdas;
}

export interface BuiltAtomicGovernanceTransaction
  extends BuiltAtomicGovernanceInstructions {
  transaction: Transaction;
}

export function accountDiscriminator(name: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`account:${name}`)
    .digest()
    .subarray(0, 8);
}

// ---- PDA derivations ----

export function deriveRegistrarPda(
  realm: PublicKey,
  governingTokenMint: PublicKey,
  pluginProgramId: PublicKey = PLUGIN_PROGRAM_ID
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("registrar"), realm.toBuffer(), governingTokenMint.toBuffer()],
    pluginProgramId
  )[0];
}

export function deriveVoterWeightRecordPda(
  realm: PublicKey,
  governingTokenMint: PublicKey,
  voter: PublicKey,
  pluginProgramId: PublicKey = PLUGIN_PROGRAM_ID
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("voter-weight-record"),
      realm.toBuffer(),
      governingTokenMint.toBuffer(),
      voter.toBuffer(),
    ],
    pluginProgramId
  )[0];
}

export function deriveIdentityStatePda(
  voter: PublicKey,
  entrosAnchorProgramId: PublicKey = ENTROS_ANCHOR_PROGRAM_ID
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("identity"), voter.toBuffer()],
    entrosAnchorProgramId
  )[0];
}

export function deriveMigrationRecordPda(
  voter: PublicKey,
  entrosAnchorProgramId: PublicKey = ENTROS_ANCHOR_PROGRAM_ID
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("migration"), voter.toBuffer()],
    entrosAnchorProgramId
  )[0];
}

export function deriveConsumerPdas(params: {
  realm: PublicKey;
  governingTokenMint: PublicKey;
  voter: PublicKey;
  pluginProgramId?: PublicKey;
  entrosAnchorProgramId?: PublicKey;
}): ConsumerPdas {
  const pluginProgramId = params.pluginProgramId ?? PLUGIN_PROGRAM_ID;
  const entrosAnchorProgramId =
    params.entrosAnchorProgramId ?? ENTROS_ANCHOR_PROGRAM_ID;
  return {
    registrar: deriveRegistrarPda(
      params.realm,
      params.governingTokenMint,
      pluginProgramId
    ),
    voterWeightRecord: deriveVoterWeightRecordPda(
      params.realm,
      params.governingTokenMint,
      params.voter,
      pluginProgramId
    ),
    identityState: deriveIdentityStatePda(params.voter, entrosAnchorProgramId),
    migrationRecord: deriveMigrationRecordPda(
      params.voter,
      entrosAnchorProgramId
    ),
  };
}

// ---- Account parsers ----

export function parseRegistrarAccount(data: Buffer): ParsedRegistrar | null {
  if (data.length < REGISTRAR_MIN_LEN) {
    return null;
  }
  if (!data.subarray(0, 8).equals(REGISTRAR_DISCRIMINATOR)) {
    return null;
  }
  return {
    governanceProgramId: new PublicKey(data.subarray(8, 40)),
    realm: new PublicKey(data.subarray(40, 72)),
    governingTokenMint: new PublicKey(data.subarray(72, 104)),
    minTrustScore: data.readUInt16LE(104),
    maxVerificationAge: data.readBigInt64LE(106),
  };
}

export function parseIdentityStateAccount(
  data: Buffer
): ParsedIdentityState | null {
  if (data.length < IDENTITY_STATE_MIN_LEN) {
    return null;
  }
  if (!data.subarray(0, 8).equals(IDENTITY_STATE_DISCRIMINATOR)) {
    return null;
  }
  return {
    owner: new PublicKey(data.subarray(8, 40)),
    creationTimestamp: data.readBigInt64LE(40),
    lastVerificationTimestamp: data.readBigInt64LE(
      IDENTITY_LAST_VERIFICATION_OFFSET
    ),
    verificationCount: data.readUInt32LE(56),
    trustScore: data.readUInt16LE(IDENTITY_TRUST_SCORE_OFFSET),
  };
}

export function parseMigrationRecordAccount(
  data: Buffer
): ParsedMigrationRecord | null {
  if (data.length < MIGRATION_RECORD_MIN_LEN) {
    return null;
  }
  if (!data.subarray(0, 8).equals(MIGRATION_RECORD_DISCRIMINATOR)) {
    return null;
  }
  return {
    migratedAt: data.readBigInt64LE(8),
    migratedSlot: data.readBigUInt64LE(MIGRATION_RECORD_SLOT_OFFSET),
    bump: data.readUInt8(24),
    previousWallet: new PublicKey(data.subarray(25, 57)),
  };
}

export function parseVoterWeightRecordAccount(
  data: Buffer
): ParsedVoterWeightRecord | null {
  // Minimum Borsh size when all three optional fields are None: 123 bytes.
  if (data.length < 123) {
    return null;
  }
  if (!data.subarray(0, 8).equals(VOTER_WEIGHT_RECORD_DISCRIMINATOR)) {
    return null;
  }

  const realm = new PublicKey(data.subarray(8, 40));
  const governingTokenMint = new PublicKey(data.subarray(40, 72));
  const governingTokenOwner = new PublicKey(data.subarray(72, 104));
  const voterWeight = data.readBigUInt64LE(104);

  let offset = 112;
  const expiryTag = data.readUInt8(offset);
  offset += 1;
  let voterWeightExpiry: bigint | null = null;
  if (expiryTag === 1) {
    if (offset + 8 > data.length) {
      return null;
    }
    voterWeightExpiry = data.readBigUInt64LE(offset);
    offset += 8;
  } else if (expiryTag !== 0) {
    return null;
  }

  if (offset + 1 > data.length) {
    return null;
  }
  const actionTag = data.readUInt8(offset);
  offset += 1;
  let weightAction: VoterWeightActionTag | null = null;
  if (actionTag === 1) {
    if (offset + 1 > data.length) {
      return null;
    }
    const rawAction = data.readUInt8(offset);
    offset += 1;
    if (rawAction > VoterWeightActionTag.SignOffProposal) {
      return null;
    }
    weightAction = rawAction as VoterWeightActionTag;
  } else if (actionTag !== 0) {
    return null;
  }

  if (offset + 1 > data.length) {
    return null;
  }
  const targetTag = data.readUInt8(offset);
  offset += 1;
  let weightActionTarget: PublicKey | null = null;
  if (targetTag === 1) {
    if (offset + 32 > data.length) {
      return null;
    }
    weightActionTarget = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;
  } else if (targetTag !== 0) {
    return null;
  }

  // Trailing 8-byte reserved field must fit in the buffer.
  if (offset + 8 > data.length) {
    return null;
  }

  return {
    realm,
    governingTokenMint,
    governingTokenOwner,
    voterWeight,
    voterWeightExpiry,
    weightAction,
    weightActionTarget,
  };
}

class BorshCursor {
  private offset = 0;

  constructor(private readonly data: Buffer) {}

  readU8(): number | null {
    if (this.offset + 1 > this.data.length) {
      return null;
    }
    const value = this.data.readUInt8(this.offset);
    this.offset += 1;
    return value;
  }

  readU32(): number | null {
    if (this.offset + 4 > this.data.length) {
      return null;
    }
    const value = this.data.readUInt32LE(this.offset);
    this.offset += 4;
    return value;
  }

  readU64(): bigint | null {
    if (this.offset + 8 > this.data.length) {
      return null;
    }
    const value = this.data.readBigUInt64LE(this.offset);
    this.offset += 8;
    return value;
  }

  readPubkey(): PublicKey | null {
    if (this.offset + 32 > this.data.length) {
      return null;
    }
    const key = new PublicKey(this.data.subarray(this.offset, this.offset + 32));
    this.offset += 32;
    return key;
  }

  skip(bytes: number): boolean {
    if (bytes < 0 || this.offset + bytes > this.data.length) {
      return false;
    }
    this.offset += bytes;
    return true;
  }

  skipOptionFixed(innerBytes: number): boolean {
    const tag = this.readU8();
    if (tag === 0) {
      return true;
    }
    if (tag === 1) {
      return this.skip(innerBytes);
    }
    return false;
  }

  skipString(): boolean {
    const len = this.readU32();
    if (len === null) {
      return false;
    }
    return this.skip(len);
  }

  skipOptionVoteThreshold(): boolean {
    const tag = this.readU8();
    if (tag === 0) {
      return true;
    }
    if (tag !== 1) {
      return false;
    }
    const variant = this.readU8();
    if (variant === 0 || variant === 1) {
      return this.skip(1);
    }
    return variant === 2;
  }

  readOptionU64(): { ok: true; value: bigint | null } | { ok: false } {
    const tag = this.readU8();
    if (tag === 0) {
      return { ok: true, value: null };
    }
    if (tag === 1) {
      const value = this.readU64();
      return value === null ? { ok: false } : { ok: true, value };
    }
    return { ok: false };
  }
}

/**
 * Parses `voting_at_slot` from an SPL Governance `ProposalV1` or `ProposalV2`
 * account using the same Borsh layout as `spl_governance::state::proposal`.
 */
export function parseProposalVotingStartSlot(
  data: Buffer
): ParsedProposalVotingInfo | null {
  const cursor = new BorshCursor(data);
  const accountType = cursor.readU8();
  if (
    accountType !== GOVERNANCE_ACCOUNT_TYPE_PROPOSAL_V1 &&
    accountType !== GOVERNANCE_ACCOUNT_TYPE_PROPOSAL_V2
  ) {
    return null;
  }

  const governance = cursor.readPubkey();
  const governingTokenMint = cursor.readPubkey();
  const state = cursor.readU8();
  const tokenOwnerRecord = cursor.readPubkey();
  const signatoriesCount = cursor.readU8();
  const signatoriesSignedOffCount = cursor.readU8();

  if (
    !governance ||
    !governingTokenMint ||
    state === null ||
    state > MAX_PROPOSAL_STATE ||
    !tokenOwnerRecord ||
    signatoriesCount === null ||
    signatoriesSignedOffCount === null
  ) {
    return null;
  }

  if (accountType === GOVERNANCE_ACCOUNT_TYPE_PROPOSAL_V1) {
    // yes_votes_count (8) + no_votes_count (8) + 3 * instruction counters (6) + draft_at (8)
    if (!cursor.skip(30)) {
      return null;
    }
    // signing_off_at: Option<i64>, voting_at: Option<i64>
    if (!cursor.skipOptionFixed(8) || !cursor.skipOptionFixed(8)) {
      return null;
    }
    const votingAtSlot = cursor.readOptionU64();
    if (!votingAtSlot.ok) {
      return null;
    }
    // voting_completed_at, executing_at, closed_at
    if (
      !cursor.skipOptionFixed(8) ||
      !cursor.skipOptionFixed(8) ||
      !cursor.skipOptionFixed(8)
    ) {
      return null;
    }
    const executionFlags = cursor.readU8();
    if (executionFlags === null || executionFlags > 2) {
      return null;
    }
    // max_vote_weight, vote_threshold, name, description_link
    if (
      !cursor.skipOptionFixed(8) ||
      !cursor.skipOptionVoteThreshold() ||
      !cursor.skipString() ||
      !cursor.skipString()
    ) {
      return null;
    }
    return {
      accountType: "ProposalV1",
      governance,
      governingTokenMint,
      state,
      votingAtSlot: votingAtSlot.value,
    };
  }

  // ProposalV2: VoteType
  const voteTypeTag = cursor.readU8();
  if (voteTypeTag === 1) {
    const choiceType = cursor.readU8();
    if (choiceType === null || choiceType > 1 || !cursor.skip(3)) {
      return null;
    }
  } else if (voteTypeTag !== 0) {
    return null;
  }

  // options: Vec<ProposalOption>
  const optionCount = cursor.readU32();
  if (optionCount === null) {
    return null;
  }
  for (let i = 0; i < optionCount; i++) {
    if (!cursor.skipString()) {
      return null;
    }
    // vote_weight (u64)
    if (!cursor.skip(8)) {
      return null;
    }
    const voteResult = cursor.readU8();
    if (voteResult === null || voteResult > 2) {
      return null;
    }
    // transactions_executed_count, transactions_count, transactions_next_index (3 * u16)
    if (!cursor.skip(6)) {
      return null;
    }
  }

  // deny_vote_weight: Option<u64>, reserved1: u8, abstain_vote_weight: Option<u64>,
  // start_voting_at: Option<i64>, draft_at: i64, signing_off_at: Option<i64>, voting_at: Option<i64>
  if (
    !cursor.skipOptionFixed(8) ||
    !cursor.skip(1) ||
    !cursor.skipOptionFixed(8) ||
    !cursor.skipOptionFixed(8) ||
    !cursor.skip(8) ||
    !cursor.skipOptionFixed(8) ||
    !cursor.skipOptionFixed(8)
  ) {
    return null;
  }

  const votingAtSlot = cursor.readOptionU64();
  if (!votingAtSlot.ok) {
    return null;
  }

  // voting_completed_at, executing_at, closed_at
  if (
    !cursor.skipOptionFixed(8) ||
    !cursor.skipOptionFixed(8) ||
    !cursor.skipOptionFixed(8)
  ) {
    return null;
  }
  const executionFlags = cursor.readU8();
  if (executionFlags === null || executionFlags > 2) {
    return null;
  }
  // max_vote_weight, max_voting_time, vote_threshold, reserved [u8; 64],
  // name, description_link, veto_vote_weight
  if (
    !cursor.skipOptionFixed(8) ||
    !cursor.skipOptionFixed(4) ||
    !cursor.skipOptionVoteThreshold() ||
    !cursor.skip(64) ||
    !cursor.skipString() ||
    !cursor.skipString() ||
    !cursor.skip(8)
  ) {
    return null;
  }

  return {
    accountType: "ProposalV2",
    governance,
    governingTokenMint,
    state,
    votingAtSlot: votingAtSlot.value,
  };
}

// ---- Pre-flight eligibility check ----

async function readAccounts(
  connection: AccountInfoReader,
  pubkeys: PublicKey[],
  commitment?: Commitment
): Promise<(AccountInfo<Buffer> | null)[]> {
  if (connection.getMultipleAccountsInfo) {
    return connection.getMultipleAccountsInfo(pubkeys, commitment);
  }
  return Promise.all(
    pubkeys.map((key) => connection.getAccountInfo(key, commitment))
  );
}

function checkedI64Sub(lhs: bigint, rhs: bigint): bigint {
  const diff = lhs - rhs;
  if (diff < I64_MIN || diff > I64_MAX) {
    return I64_MAX;
  }
  return diff;
}

/**
 * Checks on-chain Registrar, VoterWeightRecord, IdentityState, MigrationRecord,
 * and (for CastVote) Proposal accounts before prompting a wallet signature.
 */
export async function preflightVoterEligibility(
  params: PreflightVoterEligibilityParams
): Promise<PreflightVoterEligibilityResult> {
  const pluginProgramId = params.pluginProgramId ?? PLUGIN_PROGRAM_ID;
  const entrosAnchorProgramId =
    params.entrosAnchorProgramId ?? ENTROS_ANCHOR_PROGRAM_ID;
  const pdas = deriveConsumerPdas({
    realm: params.realm,
    governingTokenMint: params.governingTokenMint,
    voter: params.voter,
    pluginProgramId,
    entrosAnchorProgramId,
  });

  const isActionBound = params.action !== undefined && params.action !== null;
  const isCastVote = params.action === VoterWeightActionTag.CastVote;

  if (isActionBound) {
    if (
      !params.actionTarget ||
      params.actionTarget.equals(PublicKey.default)
    ) {
      return {
        eligible: false,
        reason: "invalid_weight_action_target",
        message:
          "Action-bound updates require a non-default weight action target.",
        pdas,
      };
    }
  }

  const keysToFetch: PublicKey[] = [
    pdas.registrar,
    pdas.voterWeightRecord,
    pdas.identityState,
    pdas.migrationRecord,
  ];
  if (isCastVote && params.actionTarget) {
    keysToFetch.push(params.actionTarget);
  }

  const accounts = await readAccounts(
    params.connection,
    keysToFetch,
    params.commitment
  );
  const [
    registrarInfo,
    vwrInfo,
    identityInfo,
    migrationInfo,
    proposalInfo = null,
  ] = accounts;

  // 1. Validate Registrar
  if (!registrarInfo) {
    return {
      eligible: false,
      reason: "registrar_not_found",
      message: "No Entros registrar exists for this realm and governing mint.",
      pdas,
    };
  }
  if (!registrarInfo.owner.equals(pluginProgramId)) {
    return {
      eligible: false,
      reason: "invalid_registrar_owner",
      message: "Registrar account is not owned by the voter weight plugin.",
      pdas,
    };
  }
  const registrar = parseRegistrarAccount(registrarInfo.data);
  if (
    !registrar ||
    !registrar.realm.equals(params.realm) ||
    !registrar.governingTokenMint.equals(params.governingTokenMint) ||
    registrar.maxVerificationAge <= 0n
  ) {
    return {
      eligible: false,
      reason: "invalid_registrar_data",
      message: "Registrar account data is malformed or mismatched.",
      pdas,
    };
  }
  if (
    params.governanceProgramId &&
    !registrar.governanceProgramId.equals(params.governanceProgramId)
  ) {
    return {
      eligible: false,
      reason: "governance_program_mismatch",
      message:
        "Registrar governance program does not match the requested governance program.",
      pdas,
    };
  }

  // 2. Check VoterWeightRecord existence and integrity
  let needsCreateVwr = true;
  if (vwrInfo) {
    if (!vwrInfo.owner.equals(pluginProgramId)) {
      return {
        eligible: false,
        reason: "invalid_voter_weight_record",
        message:
          "Existing voter weight record is not owned by the voter weight plugin.",
        pdas,
      };
    }
    const parsedVwr = parseVoterWeightRecordAccount(vwrInfo.data);
    if (
      !parsedVwr ||
      !parsedVwr.realm.equals(params.realm) ||
      !parsedVwr.governingTokenMint.equals(params.governingTokenMint) ||
      !parsedVwr.governingTokenOwner.equals(params.voter)
    ) {
      return {
        eligible: false,
        reason: "invalid_voter_weight_record",
        message: "Existing voter weight record data is malformed or mismatched.",
        pdas,
      };
    }
    needsCreateVwr = false;
  }

  // 3. Validate Entros IdentityState
  if (!identityInfo) {
    return {
      eligible: false,
      reason: "identity_not_found",
      message: "No Entros IdentityState account exists for this wallet.",
      needsCreateVwr,
      pdas,
    };
  }
  if (!identityInfo.owner.equals(entrosAnchorProgramId)) {
    return {
      eligible: false,
      reason: "invalid_identity_owner",
      message: "Identity account is not owned by the Entros Anchor program.",
      needsCreateVwr,
      pdas,
    };
  }
  const identity = parseIdentityStateAccount(identityInfo.data);
  if (!identity) {
    return {
      eligible: false,
      reason: "invalid_identity_data",
      message: "Identity account data failed length or discriminator validation.",
      needsCreateVwr,
      pdas,
    };
  }
  if (identity.trustScore < registrar.minTrustScore) {
    return {
      eligible: false,
      reason: "insufficient_trust_score",
      message: `Trust score ${identity.trustScore} is below the DAO minimum ${registrar.minTrustScore}.`,
      needsCreateVwr,
      pdas,
      trustScore: identity.trustScore,
      minTrustScore: registrar.minTrustScore,
      lastVerificationTimestamp: identity.lastVerificationTimestamp,
    };
  }

  const nowBig =
    params.nowSeconds !== undefined
      ? typeof params.nowSeconds === "bigint"
        ? params.nowSeconds
        : BigInt(Math.trunc(params.nowSeconds))
      : BigInt(Math.floor(Date.now() / 1000));
  const verificationAgeSeconds = checkedI64Sub(
    nowBig,
    identity.lastVerificationTimestamp
  );
  if (verificationAgeSeconds >= registrar.maxVerificationAge) {
    return {
      eligible: false,
      reason: "verification_expired",
      message: `Last verification age (${verificationAgeSeconds.toString()}s) meets or exceeds the DAO limit (${registrar.maxVerificationAge.toString()}s).`,
      needsCreateVwr,
      pdas,
      trustScore: identity.trustScore,
      minTrustScore: registrar.minTrustScore,
      lastVerificationTimestamp: identity.lastVerificationTimestamp,
      verificationAgeSeconds,
      maxVerificationAge: registrar.maxVerificationAge,
    };
  }

  // 4. Check MigrationRecord and Proposal rules for standalone updates and CastVote.
  // Non-vote actions do not inspect MigrationRecord or Proposal on-chain.
  let migratedSlot: bigint | null = null;
  let votingAtSlot: bigint | null = null;

  if (!isActionBound || isCastVote) {
    if (migrationInfo && migrationInfo.owner.equals(entrosAnchorProgramId)) {
      const parsedMigration = parseMigrationRecordAccount(migrationInfo.data);
      if (!parsedMigration) {
        return {
          eligible: false,
          reason: "invalid_migration_record_data",
          message:
            "Migration record account failed length or discriminator validation.",
          needsCreateVwr,
          pdas,
          trustScore: identity.trustScore,
          lastVerificationTimestamp: identity.lastVerificationTimestamp,
          verificationAgeSeconds,
        };
      }
      migratedSlot = parsedMigration.migratedSlot;
    }

    if (!isActionBound && migratedSlot !== null) {
      return {
        eligible: false,
        reason: "migrated_identity_needs_action_target",
        message:
          "A wallet that received a migrated identity must use an action-bound update.",
        needsCreateVwr,
        pdas,
        trustScore: identity.trustScore,
        lastVerificationTimestamp: identity.lastVerificationTimestamp,
        verificationAgeSeconds,
        migratedSlot,
      };
    }

    if (isCastVote) {
      const effectiveGovernanceProgramId =
        params.governanceProgramId ?? registrar.governanceProgramId;
      if (
        !proposalInfo ||
        !proposalInfo.owner.equals(effectiveGovernanceProgramId)
      ) {
        return {
          eligible: false,
          reason: "invalid_proposal_account",
          message:
            "Proposal account does not exist or is not owned by the governance program.",
          needsCreateVwr,
          pdas,
          trustScore: identity.trustScore,
          lastVerificationTimestamp: identity.lastVerificationTimestamp,
          verificationAgeSeconds,
          migratedSlot,
        };
      }
      const parsedProposal = parseProposalVotingStartSlot(proposalInfo.data);
      if (!parsedProposal) {
        return {
          eligible: false,
          reason: "invalid_proposal_account",
          message: "Proposal account data could not be decoded.",
          needsCreateVwr,
          pdas,
          trustScore: identity.trustScore,
          lastVerificationTimestamp: identity.lastVerificationTimestamp,
          verificationAgeSeconds,
          migratedSlot,
        };
      }
      if (
        parsedProposal.votingAtSlot === null ||
        parsedProposal.state !== PROPOSAL_STATE_VOTING
      ) {
        return {
          eligible: false,
          reason: "proposal_not_in_voting",
          message: "Proposal is not in the Voting state.",
          needsCreateVwr,
          pdas,
          trustScore: identity.trustScore,
          lastVerificationTimestamp: identity.lastVerificationTimestamp,
          verificationAgeSeconds,
          migratedSlot,
          votingAtSlot: parsedProposal.votingAtSlot,
        };
      }
      votingAtSlot = parsedProposal.votingAtSlot;

      // Strict comparison: migration in the slot voting started is refused.
      if (migratedSlot !== null && !(migratedSlot < votingAtSlot)) {
        return {
          eligible: false,
          reason: "identity_migrated_after_voting_start",
          message: `Identity migrated at slot ${migratedSlot.toString()}, which is not before proposal voting start slot ${votingAtSlot.toString()}.`,
          needsCreateVwr,
          pdas,
          trustScore: identity.trustScore,
          lastVerificationTimestamp: identity.lastVerificationTimestamp,
          verificationAgeSeconds,
          migratedSlot,
          votingAtSlot,
        };
      }
    }
  }

  return {
    eligible: true,
    needsCreateVwr,
    pdas,
    registrar,
    trustScore: identity.trustScore,
    lastVerificationTimestamp: identity.lastVerificationTimestamp,
    verificationAgeSeconds,
    migratedSlot,
    votingAtSlot,
  };
}

// ---- Atomic instruction and transaction composition ----

function createVoterWeightRecordIx(
  registrar: PublicKey,
  voterWeightRecord: PublicKey,
  voter: PublicKey,
  payer: PublicKey,
  pluginProgramId: PublicKey
): TransactionInstruction {
  const disc = anchorDiscriminator("create_voter_weight_record");
  const data = Buffer.alloc(8 + 32);
  disc.copy(data, 0);
  voter.toBuffer().copy(data, 8);

  return new TransactionInstruction({
    programId: pluginProgramId,
    keys: [
      { pubkey: registrar, isSigner: false, isWritable: false },
      { pubkey: voterWeightRecord, isSigner: false, isWritable: true },
      { pubkey: voter, isSigner: true, isWritable: false },
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

function updateVoterWeightRecordForActionIx(
  pdas: ConsumerPdas,
  voter: PublicKey,
  action: VoterWeightActionTag,
  actionTarget: PublicKey,
  pluginProgramId: PublicKey
): TransactionInstruction {
  const disc = anchorDiscriminator("update_voter_weight_record_for_action");
  const data = Buffer.alloc(8 + 1 + 32);
  disc.copy(data, 0);
  data.writeUInt8(action, 8);
  actionTarget.toBuffer().copy(data, 9);

  const keys = [
    { pubkey: pdas.registrar, isSigner: false, isWritable: false },
    { pubkey: pdas.voterWeightRecord, isSigner: false, isWritable: true },
    { pubkey: voter, isSigner: true, isWritable: false },
    { pubkey: pdas.identityState, isSigner: false, isWritable: false },
  ];

  if (action === VoterWeightActionTag.CastVote) {
    keys.push(
      { pubkey: pdas.migrationRecord, isSigner: false, isWritable: false },
      { pubkey: actionTarget, isSigner: false, isWritable: false }
    );
  }

  return new TransactionInstruction({
    programId: pluginProgramId,
    keys,
    data,
  });
}

/**
 * Builds the ordered instructions for an atomic Realms governance transaction:
 * `[create_voter_weight_record?, update_voter_weight_record_for_action, ...governanceInstructions]`.
 */
export function buildAtomicGovernanceInstructions(
  params: BuildAtomicGovernanceParams
): BuiltAtomicGovernanceInstructions {
  if (params.actionTarget.equals(PublicKey.default)) {
    throw new Error(
      "Action-bound updates require a non-default weight action target."
    );
  }

  const governanceList = Array.isArray(params.governanceInstructions)
    ? [...params.governanceInstructions]
    : [params.governanceInstructions];
  if (governanceList.length === 0) {
    throw new Error("At least one governance instruction is required.");
  }

  const pluginProgramId = params.pluginProgramId ?? PLUGIN_PROGRAM_ID;
  const entrosAnchorProgramId =
    params.entrosAnchorProgramId ?? ENTROS_ANCHOR_PROGRAM_ID;
  const payer = params.payer ?? params.voter;
  const pdas = deriveConsumerPdas({
    realm: params.realm,
    governingTokenMint: params.governingTokenMint,
    voter: params.voter,
    pluginProgramId,
    entrosAnchorProgramId,
  });

  const instructions: TransactionInstruction[] = [];
  if (params.needsCreateVwr) {
    instructions.push(
      createVoterWeightRecordIx(
        pdas.registrar,
        pdas.voterWeightRecord,
        params.voter,
        payer,
        pluginProgramId
      )
    );
  }
  instructions.push(
    updateVoterWeightRecordForActionIx(
      pdas,
      params.voter,
      params.action,
      params.actionTarget,
      pluginProgramId
    )
  );
  instructions.push(...governanceList);

  return { instructions, pdas };
}

/**
 * Builds one atomic Transaction containing optional VoterWeightRecord creation,
 * the action-bound voter-weight update, and the consuming spl-governance instruction(s).
 */
export function buildAtomicGovernanceTransaction(
  params: BuildAtomicGovernanceParams
): BuiltAtomicGovernanceTransaction {
  const built = buildAtomicGovernanceInstructions(params);
  const transaction = new Transaction().add(...built.instructions);
  return { ...built, transaction };
}
