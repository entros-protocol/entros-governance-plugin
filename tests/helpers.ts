import {
  PublicKey,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID } from "@solana/spl-token";
import * as crypto from "crypto";

export const GOVERNANCE_PROGRAM_ID = new PublicKey(
  "GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
);
export const PLUGIN_PROGRAM_ID = new PublicKey(
  "99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534"
);
export const ENTROS_ANCHOR_PROGRAM_ID = new PublicKey(
  "GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2"
);

export function anchorDiscriminator(name: string): Buffer {
  return crypto
    .createHash("sha256")
    .update(`global:${name}`)
    .digest()
    .slice(0, 8);
}

// ---- spl-governance CreateRealm ----

export function buildCreateRealmInstruction(
  realmName: string,
  realmAuthority: PublicKey,
  communityMint: PublicKey,
  payerKey: PublicKey,
  voterWeightAddin: PublicKey | null
): { instruction: TransactionInstruction; realmPda: PublicKey } {
  const [realmPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("governance"), Buffer.from(realmName)],
    GOVERNANCE_PROGRAM_ID
  );
  const [communityHolding] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("governance"),
      realmPda.toBuffer(),
      communityMint.toBuffer(),
    ],
    GOVERNANCE_PROGRAM_ID
  );
  const [realmConfig] = PublicKey.findProgramAddressSync(
    [Buffer.from("realm-config"), realmPda.toBuffer()],
    GOVERNANCE_PROGRAM_ID
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
    { pubkey: realmConfig, isSigner: false, isWritable: true },
  ];

  if (voterWeightAddin) {
    accounts.push({
      pubkey: voterWeightAddin,
      isSigner: false,
      isWritable: false,
    });
  }

  const nameBytes = Buffer.from(realmName, "utf-8");
  const parts: Buffer[] = [];

  parts.push(Buffer.from([0])); // CreateRealm = 0

  const nameLen = Buffer.alloc(4);
  nameLen.writeUInt32LE(nameBytes.length);
  parts.push(nameLen);
  parts.push(nameBytes);

  parts.push(Buffer.from([0])); // use_council_mint: false

  const minWeight = Buffer.alloc(8);
  minWeight.writeBigUInt64LE(1n);
  parts.push(minWeight);

  parts.push(Buffer.from([0])); // SupplyFraction
  const fraction = Buffer.alloc(8);
  fraction.writeBigUInt64LE(10_000_000_000n);
  parts.push(fraction);

  parts.push(Buffer.from([voterWeightAddin ? 1 : 0])); // use_voter_weight_addin
  parts.push(Buffer.from([0])); // use_max_voter_weight_addin
  parts.push(Buffer.from([0])); // token_type = Liquid

  parts.push(Buffer.from([0])); // council: use_voter_weight_addin
  parts.push(Buffer.from([0])); // council: use_max_voter_weight_addin
  parts.push(Buffer.from([2])); // council: token_type = Dormant

  return {
    instruction: new TransactionInstruction({
      programId: GOVERNANCE_PROGRAM_ID,
      keys: accounts,
      data: Buffer.concat(parts),
    }),
    realmPda,
  };
}

// ---- Plugin instructions ----

export function buildCreateRegistrarInstruction(
  realmPda: PublicKey,
  communityMint: PublicKey,
  realmAuthority: PublicKey,
  payerKey: PublicKey,
  minTrustScore: number,
  maxVerificationAge: bigint
): { instruction: TransactionInstruction; registrarPda: PublicKey } {
  const [registrarPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("registrar"), realmPda.toBuffer(), communityMint.toBuffer()],
    PLUGIN_PROGRAM_ID
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
        {
          pubkey: GOVERNANCE_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        { pubkey: realmPda, isSigner: false, isWritable: false },
        { pubkey: communityMint, isSigner: false, isWritable: false },
        { pubkey: realmAuthority, isSigner: true, isWritable: false },
        { pubkey: payerKey, isSigner: true, isWritable: true },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
      ],
      data,
    }),
    registrarPda,
  };
}

export function buildUpdateRegistrarInstruction(
  registrarPda: PublicKey,
  realmPda: PublicKey,
  realmAuthority: PublicKey,
  minTrustScore: number,
  maxVerificationAge: bigint
): TransactionInstruction {
  const disc = anchorDiscriminator("update_registrar");
  const data = Buffer.alloc(8 + 2 + 8);
  disc.copy(data, 0);
  data.writeUInt16LE(minTrustScore, 8);
  data.writeBigInt64LE(maxVerificationAge, 10);

  return new TransactionInstruction({
    programId: PLUGIN_PROGRAM_ID,
    keys: [
      { pubkey: registrarPda, isSigner: false, isWritable: true },
      { pubkey: realmPda, isSigner: false, isWritable: false },
      { pubkey: realmAuthority, isSigner: true, isWritable: false },
    ],
    data,
  });
}

export function buildCreateVoterWeightRecordInstruction(
  registrarPda: PublicKey,
  realmPda: PublicKey,
  communityMint: PublicKey,
  voterKey: PublicKey,
  payerKey: PublicKey
): { instruction: TransactionInstruction; vwrPda: PublicKey } {
  const [vwrPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("voter-weight-record"),
      realmPda.toBuffer(),
      communityMint.toBuffer(),
      voterKey.toBuffer(),
    ],
    PLUGIN_PROGRAM_ID
  );

  const disc = anchorDiscriminator("create_voter_weight_record");
  const data = Buffer.alloc(8 + 32);
  disc.copy(data, 0);
  voterKey.toBuffer().copy(data, 8);

  // Account order MUST match the Rust struct field order in
  // CreateVoterWeightRecord<'info>: registrar → voter_weight_record →
  // governing_token_owner_signer → payer → system_program.
  // governing_token_owner_signer was added in 1.x to gate VWR creation
  // on signer-equality with the instruction's `governing_token_owner`
  // arg (closes the front-running griefing case).
  return {
    instruction: new TransactionInstruction({
      programId: PLUGIN_PROGRAM_ID,
      keys: [
        { pubkey: registrarPda, isSigner: false, isWritable: false },
        { pubkey: vwrPda, isSigner: false, isWritable: true },
        { pubkey: voterKey, isSigner: true, isWritable: false },
        { pubkey: payerKey, isSigner: true, isWritable: true },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
      ],
      data,
    }),
    vwrPda,
  };
}

export function deriveMigrationRecordPda(voterKey: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("migration"), voterKey.toBuffer()],
    ENTROS_ANCHOR_PROGRAM_ID
  )[0];
}

/** Accounts the plugin reads after the identity. Tests override them to exercise refusals. */
export interface VoterEvidenceOverrides {
  /** Defaults to the voter's migration record address. `null` leaves it out. */
  migrationRecord?: PublicKey | null;
  /** Defaults to the action target for a vote. `null` leaves it out. */
  proposal?: PublicKey | null;
}

export function buildUpdateVoterWeightRecordInstruction(
  registrarPda: PublicKey,
  vwrPda: PublicKey,
  voterKey: PublicKey,
  identityPda: PublicKey,
  overrides: VoterEvidenceOverrides = {}
): TransactionInstruction {
  const disc = anchorDiscriminator("update_voter_weight_record");
  const keys = [
    { pubkey: registrarPda, isSigner: false, isWritable: false },
    { pubkey: vwrPda, isSigner: false, isWritable: true },
    { pubkey: voterKey, isSigner: true, isWritable: false },
    { pubkey: identityPda, isSigner: false, isWritable: false },
  ];
  const migrationRecord =
    overrides.migrationRecord === undefined
      ? deriveMigrationRecordPda(voterKey)
      : overrides.migrationRecord;
  if (migrationRecord) {
    keys.push({ pubkey: migrationRecord, isSigner: false, isWritable: false });
  }

  return new TransactionInstruction({
    programId: PLUGIN_PROGRAM_ID,
    keys,
    data: disc,
  });
}

export enum VoterWeightActionTag {
  CastVote = 0,
  CommentProposal = 1,
  CreateGovernance = 2,
  CreateProposal = 3,
  SignOffProposal = 4,
}

export function buildUpdateVoterWeightRecordForActionInstruction(
  registrarPda: PublicKey,
  vwrPda: PublicKey,
  voterKey: PublicKey,
  identityPda: PublicKey,
  weightAction: VoterWeightActionTag,
  weightActionTarget: PublicKey,
  overrides: VoterEvidenceOverrides = {}
): TransactionInstruction {
  const disc = anchorDiscriminator("update_voter_weight_record_for_action");
  const data = Buffer.alloc(8 + 1 + 32);
  disc.copy(data, 0);
  data.writeUInt8(weightAction, 8);
  weightActionTarget.toBuffer().copy(data, 9);

  const keys = [
    { pubkey: registrarPda, isSigner: false, isWritable: false },
    { pubkey: vwrPda, isSigner: false, isWritable: true },
    { pubkey: voterKey, isSigner: true, isWritable: false },
    { pubkey: identityPda, isSigner: false, isWritable: false },
  ];
  // A vote also carries the voter's migration record and the proposal.
  if (weightAction === VoterWeightActionTag.CastVote) {
    const migrationRecord =
      overrides.migrationRecord === undefined
        ? deriveMigrationRecordPda(voterKey)
        : overrides.migrationRecord;
    if (migrationRecord) {
      keys.push({ pubkey: migrationRecord, isSigner: false, isWritable: false });
    }
    const proposal =
      overrides.proposal === undefined ? weightActionTarget : overrides.proposal;
    if (proposal) {
      keys.push({ pubkey: proposal, isSigner: false, isWritable: false });
    }
  }

  return new TransactionInstruction({
    programId: PLUGIN_PROGRAM_ID,
    keys,
    data,
  });
}

// ---- spl-governance CreateTokenOwnerRecord & CreateGovernance ----

export function buildCreateTokenOwnerRecordInstruction(
  realmPda: PublicKey,
  governingTokenOwner: PublicKey,
  governingTokenMint: PublicKey,
  payerKey: PublicKey
): { instruction: TransactionInstruction; tokenOwnerRecordPda: PublicKey } {
  const [tokenOwnerRecordPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("governance"),
      realmPda.toBuffer(),
      governingTokenMint.toBuffer(),
      governingTokenOwner.toBuffer(),
    ],
    GOVERNANCE_PROGRAM_ID
  );

  // GovernanceInstruction::CreateTokenOwnerRecord = 23
  const data = Buffer.from([23]);

  return {
    instruction: new TransactionInstruction({
      programId: GOVERNANCE_PROGRAM_ID,
      keys: [
        { pubkey: realmPda, isSigner: false, isWritable: false },
        { pubkey: governingTokenOwner, isSigner: false, isWritable: false },
        { pubkey: tokenOwnerRecordPda, isSigner: false, isWritable: true },
        { pubkey: governingTokenMint, isSigner: false, isWritable: false },
        { pubkey: payerKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    }),
    tokenOwnerRecordPda,
  };
}

export function buildCreateGovernanceInstruction(
  realmPda: PublicKey,
  governedAccount: PublicKey,
  tokenOwnerRecordPda: PublicKey,
  payerKey: PublicKey,
  createAuthority: PublicKey,
  voterWeightRecordPda?: PublicKey
): { instruction: TransactionInstruction; governancePda: PublicKey } {
  const [governancePda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("account-governance"),
      realmPda.toBuffer(),
      governedAccount.toBuffer(),
    ],
    GOVERNANCE_PROGRAM_ID
  );
  const [realmConfigPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("realm-config"), realmPda.toBuffer()],
    GOVERNANCE_PROGRAM_ID
  );

  const keys = [
    { pubkey: realmPda, isSigner: false, isWritable: false },
    { pubkey: governancePda, isSigner: false, isWritable: true },
    { pubkey: governedAccount, isSigner: false, isWritable: false },
    { pubkey: tokenOwnerRecordPda, isSigner: false, isWritable: false },
    { pubkey: payerKey, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    { pubkey: createAuthority, isSigner: true, isWritable: false },
    { pubkey: realmConfigPda, isSigner: false, isWritable: false },
  ];

  if (voterWeightRecordPda) {
    keys.push({
      pubkey: voterWeightRecordPda,
      isSigner: false,
      isWritable: false,
    });
  }

  // GovernanceInstruction::CreateGovernance = 4
  const parts: Buffer[] = [];
  parts.push(Buffer.from([4]));
  parts.push(Buffer.from([0, 60])); // community_vote_threshold: YesVotePercentage(60)
  const minCommunityWeight = Buffer.alloc(8);
  minCommunityWeight.writeBigUInt64LE(1n);
  parts.push(minCommunityWeight);
  const minHoldUpTime = Buffer.alloc(4);
  minHoldUpTime.writeUInt32LE(0);
  parts.push(minHoldUpTime);
  const votingBaseTime = Buffer.alloc(4);
  votingBaseTime.writeUInt32LE(3600);
  parts.push(votingBaseTime);
  parts.push(Buffer.from([0])); // community_vote_tipping: Strict
  parts.push(Buffer.from([2])); // council_vote_threshold: Disabled
  parts.push(Buffer.from([2])); // council_veto_vote_threshold: Disabled
  const minCouncilWeight = Buffer.alloc(8);
  minCouncilWeight.writeBigUInt64LE(1n);
  parts.push(minCouncilWeight);
  parts.push(Buffer.from([2])); // council_vote_tipping: Disabled
  parts.push(Buffer.from([2])); // community_veto_vote_threshold: Disabled
  const votingCoolOffTime = Buffer.alloc(4);
  votingCoolOffTime.writeUInt32LE(0);
  parts.push(votingCoolOffTime);
  parts.push(Buffer.from([10])); // deposit_exempt_proposal_count: 10

  return {
    instruction: new TransactionInstruction({
      programId: GOVERNANCE_PROGRAM_ID,
      keys,
      data: Buffer.concat(parts),
    }),
    governancePda,
  };
}

// ---- spl-governance CreateProposal, SignOffProposal & CastVote ----

function borshString(value: string): Buffer {
  const bytes = Buffer.from(value, "utf8");
  const length = Buffer.alloc(4);
  length.writeUInt32LE(bytes.length);
  return Buffer.concat([length, bytes]);
}

function realmConfigPda(realmPda: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("realm-config"), realmPda.toBuffer()],
    GOVERNANCE_PROGRAM_ID
  )[0];
}

/** A single-choice proposal with one option and a deny option. */
export function buildCreateProposalInstruction(
  realmPda: PublicKey,
  governancePda: PublicKey,
  proposalOwnerRecordPda: PublicKey,
  governingTokenMint: PublicKey,
  governanceAuthority: PublicKey,
  payerKey: PublicKey,
  proposalSeed: PublicKey,
  voterWeightRecordPda: PublicKey,
  name: string
): { instruction: TransactionInstruction; proposalPda: PublicKey } {
  const [proposalPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("governance"),
      governancePda.toBuffer(),
      governingTokenMint.toBuffer(),
      proposalSeed.toBuffer(),
    ],
    GOVERNANCE_PROGRAM_ID
  );
  const [proposalDepositPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("proposal-deposit"),
      proposalPda.toBuffer(),
      payerKey.toBuffer(),
    ],
    GOVERNANCE_PROGRAM_ID
  );

  const optionCount = Buffer.alloc(4);
  optionCount.writeUInt32LE(1);
  // GovernanceInstruction::CreateProposal = 6
  const data = Buffer.concat([
    Buffer.from([6]),
    borshString(name),
    borshString(""), // description_link
    Buffer.from([0]), // vote_type: SingleChoice
    optionCount,
    borshString("Approve"),
    Buffer.from([1]), // use_deny_option
    proposalSeed.toBuffer(),
  ]);

  return {
    instruction: new TransactionInstruction({
      programId: GOVERNANCE_PROGRAM_ID,
      keys: [
        { pubkey: realmPda, isSigner: false, isWritable: false },
        { pubkey: proposalPda, isSigner: false, isWritable: true },
        { pubkey: governancePda, isSigner: false, isWritable: true },
        { pubkey: proposalOwnerRecordPda, isSigner: false, isWritable: true },
        { pubkey: governingTokenMint, isSigner: false, isWritable: false },
        { pubkey: governanceAuthority, isSigner: true, isWritable: false },
        { pubkey: payerKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: realmConfigPda(realmPda), isSigner: false, isWritable: false },
        { pubkey: voterWeightRecordPda, isSigner: false, isWritable: false },
        { pubkey: proposalDepositPda, isSigner: false, isWritable: true },
      ],
      data,
    }),
    proposalPda,
  };
}

/** The proposal owner signs off, which starts voting. */
export function buildSignOffProposalInstruction(
  realmPda: PublicKey,
  governancePda: PublicKey,
  proposalPda: PublicKey,
  proposalOwner: PublicKey,
  proposalOwnerRecordPda: PublicKey
): TransactionInstruction {
  // GovernanceInstruction::SignOffProposal = 12
  return new TransactionInstruction({
    programId: GOVERNANCE_PROGRAM_ID,
    keys: [
      { pubkey: realmPda, isSigner: false, isWritable: false },
      { pubkey: governancePda, isSigner: false, isWritable: false },
      { pubkey: proposalPda, isSigner: false, isWritable: true },
      { pubkey: proposalOwner, isSigner: true, isWritable: false },
      { pubkey: proposalOwnerRecordPda, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([12]),
  });
}

/** An approve vote with the voter's full weight on the single option. */
export function buildCastVoteInstruction(
  realmPda: PublicKey,
  governancePda: PublicKey,
  proposalPda: PublicKey,
  proposalOwnerRecordPda: PublicKey,
  voterTokenOwnerRecordPda: PublicKey,
  governanceAuthority: PublicKey,
  governingTokenMint: PublicKey,
  payerKey: PublicKey,
  voterWeightRecordPda: PublicKey
): { instruction: TransactionInstruction; voteRecordPda: PublicKey } {
  const [voteRecordPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("governance"),
      proposalPda.toBuffer(),
      voterTokenOwnerRecordPda.toBuffer(),
    ],
    GOVERNANCE_PROGRAM_ID
  );

  const choiceCount = Buffer.alloc(4);
  choiceCount.writeUInt32LE(1);
  // GovernanceInstruction::CastVote = 13, Vote::Approve = 0,
  // VoteChoice { rank: 0, weight_percentage: 100 }
  const data = Buffer.concat([
    Buffer.from([13]),
    Buffer.from([0]),
    choiceCount,
    Buffer.from([0, 100]),
  ]);

  return {
    instruction: new TransactionInstruction({
      programId: GOVERNANCE_PROGRAM_ID,
      keys: [
        { pubkey: realmPda, isSigner: false, isWritable: false },
        { pubkey: governancePda, isSigner: false, isWritable: true },
        { pubkey: proposalPda, isSigner: false, isWritable: true },
        { pubkey: proposalOwnerRecordPda, isSigner: false, isWritable: true },
        { pubkey: voterTokenOwnerRecordPda, isSigner: false, isWritable: true },
        { pubkey: governanceAuthority, isSigner: true, isWritable: false },
        { pubkey: voteRecordPda, isSigner: false, isWritable: true },
        { pubkey: governingTokenMint, isSigner: false, isWritable: false },
        { pubkey: payerKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: realmConfigPda(realmPda), isSigner: false, isWritable: false },
        { pubkey: voterWeightRecordPda, isSigner: false, isWritable: false },
      ],
      data,
    }),
    voteRecordPda,
  };
}

export function buildCloseVoterWeightRecordInstruction(
  registrarPda: PublicKey,
  vwrPda: PublicKey,
  voterAuthority: PublicKey,
  solDestination: PublicKey
): TransactionInstruction {
  const disc = anchorDiscriminator("close_voter_weight_record");

  return new TransactionInstruction({
    programId: PLUGIN_PROGRAM_ID,
    keys: [
      { pubkey: registrarPda, isSigner: false, isWritable: false },
      { pubkey: vwrPda, isSigner: false, isWritable: true },
      { pubkey: voterAuthority, isSigner: true, isWritable: false },
      { pubkey: solDestination, isSigner: false, isWritable: true },
    ],
    data: disc,
  });
}

export function buildCloseRegistrarInstruction(
  registrarPda: PublicKey,
  realmPda: PublicKey,
  realmAuthority: PublicKey,
  solDestination: PublicKey
): TransactionInstruction {
  const disc = anchorDiscriminator("close_registrar");

  return new TransactionInstruction({
    programId: PLUGIN_PROGRAM_ID,
    keys: [
      { pubkey: registrarPda, isSigner: false, isWritable: true },
      { pubkey: realmPda, isSigner: false, isWritable: false },
      { pubkey: realmAuthority, isSigner: true, isWritable: false },
      { pubkey: solDestination, isSigner: false, isWritable: true },
    ],
    data: disc,
  });
}

export function buildCreateMaxVoterWeightRecordInstruction(
  registrarPda: PublicKey,
  realmPda: PublicKey,
  communityMint: PublicKey,
  realmAuthority: PublicKey,
  payerKey: PublicKey
): { instruction: TransactionInstruction; maxVwrPda: PublicKey } {
  const [maxVwrPda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("max-voter-weight-record"),
      realmPda.toBuffer(),
      communityMint.toBuffer(),
    ],
    PLUGIN_PROGRAM_ID
  );

  const disc = anchorDiscriminator("create_max_voter_weight_record");

  return {
    instruction: new TransactionInstruction({
      programId: PLUGIN_PROGRAM_ID,
      keys: [
        { pubkey: registrarPda, isSigner: false, isWritable: false },
        { pubkey: maxVwrPda, isSigner: false, isWritable: true },
        { pubkey: realmPda, isSigner: false, isWritable: false },
        { pubkey: realmAuthority, isSigner: true, isWritable: false },
        { pubkey: payerKey, isSigner: true, isWritable: true },
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
      ],
      data: disc,
    }),
    maxVwrPda,
  };
}

export function buildUpdateMaxVoterWeightRecordInstruction(
  registrarPda: PublicKey,
  maxVwrPda: PublicKey,
  realmPda: PublicKey,
  realmAuthority: PublicKey,
  maxVoterWeight: bigint
): TransactionInstruction {
  const disc = anchorDiscriminator("update_max_voter_weight_record");
  const data = Buffer.alloc(8 + 8);
  disc.copy(data, 0);
  data.writeBigUInt64LE(maxVoterWeight, 8);

  return new TransactionInstruction({
    programId: PLUGIN_PROGRAM_ID,
    keys: [
      { pubkey: registrarPda, isSigner: false, isWritable: false },
      { pubkey: maxVwrPda, isSigner: false, isWritable: true },
      { pubkey: realmPda, isSigner: false, isWritable: false },
      { pubkey: realmAuthority, isSigner: true, isWritable: false },
    ],
    data,
  });
}
