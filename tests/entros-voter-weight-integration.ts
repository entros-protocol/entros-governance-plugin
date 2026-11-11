import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  createAssociatedTokenAccountInstruction,
  createInitializeMintInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  PLUGIN_PROGRAM_ID,
  ENTROS_ANCHOR_PROGRAM_ID,
  anchorDiscriminator,
  buildCreateRealmInstruction,
  buildCreateRegistrarInstruction,
  buildUpdateRegistrarInstruction,
  buildCreateVoterWeightRecordInstruction,
  buildUpdateVoterWeightRecordInstruction,
  buildUpdateVoterWeightRecordForActionInstruction,
  buildCreateTokenOwnerRecordInstruction,
  buildCreateGovernanceInstruction,
  buildCreateProposalInstruction,
  buildSignOffProposalInstruction,
  buildCastVoteInstruction,
  deriveMigrationRecordPda,
  VoterWeightActionTag,
  buildCloseVoterWeightRecordInstruction,
  buildCloseRegistrarInstruction,
  buildCreateMaxVoterWeightRecordInstruction,
  buildUpdateMaxVoterWeightRecordInstruction,
} from "./helpers";

// Deterministic test keypairs (must match scripts/generate-test-fixtures.ts)
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

// VOTER_C: trust score 200 + recent verification, but its IdentityState fixture
// carries a WRONG account discriminator (must match scripts/generate-test-fixtures.ts).
// Owner + PDA pass; only the discriminator guard in update_voter_weight_record rejects.
const VOTER_C = Keypair.fromSecretKey(
  new Uint8Array([
    94, 31, 55, 141, 69, 236, 105, 147, 234, 20, 85, 165, 247, 47, 215, 59,
    77, 222, 67, 95, 93, 144, 57, 151, 115, 136, 105, 29, 15, 181, 192, 140,
    227, 49, 209, 215, 148, 113, 232, 115, 251, 223, 165, 251, 109, 253, 0, 60,
    81, 61, 52, 187, 251, 15, 177, 100, 255, 43, 41, 25, 156, 243, 154, 154,
  ])
);

// VOTER_D: trust score 200. Its migration record names slot 0, so its identity
// arrived before any proposal in these tests entered voting.
const VOTER_D = Keypair.fromSecretKey(
  new Uint8Array([
    114, 88, 10, 140, 125, 118, 118, 100, 17, 35, 223, 92, 178, 17, 194, 239,
    234, 174, 31, 197, 141, 240, 115, 15, 224, 193, 209, 131, 58, 175, 182,
    193, 19, 117, 210, 98, 48, 66, 152, 207, 182, 64, 16, 121, 6, 208, 133, 17,
    253, 254, 92, 163, 255, 221, 114, 36, 236, 145, 113, 29, 166, 27, 226, 193,
  ])
);

// VOTER_E: trust score 200. Its migration record names a slot no test reaches,
// so its identity arrived after every proposal in these tests entered voting.
const VOTER_E = Keypair.fromSecretKey(
  new Uint8Array([
    143, 238, 18, 196, 164, 64, 212, 237, 116, 171, 122, 248, 99, 232, 114,
    213, 231, 56, 196, 92, 11, 187, 3, 206, 153, 23, 89, 34, 156, 109, 205, 32,
    204, 40, 39, 192, 160, 52, 196, 208, 203, 146, 165, 76, 86, 191, 234, 145,
    67, 16, 250, 37, 198, 238, 160, 86, 111, 39, 188, 88, 15, 112, 211, 75,
  ])
);

const connection = new Connection("http://localhost:8899", "confirmed");
const payer = VOTER_A;

// Shared state across happy path tests
let communityMint: PublicKey;
let realmPda: PublicKey;
let registrarPda: PublicKey;
let vwrPda: PublicKey;

const [VOTER_A_IDENTITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("identity"), VOTER_A.publicKey.toBuffer()],
  ENTROS_ANCHOR_PROGRAM_ID
);
const [VOTER_B_IDENTITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("identity"), VOTER_B.publicKey.toBuffer()],
  ENTROS_ANCHOR_PROGRAM_ID
);
const [VOTER_C_IDENTITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("identity"), VOTER_C.publicKey.toBuffer()],
  ENTROS_ANCHOR_PROGRAM_ID
);
const [VOTER_D_IDENTITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("identity"), VOTER_D.publicKey.toBuffer()],
  ENTROS_ANCHOR_PROGRAM_ID
);
const [VOTER_E_IDENTITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("identity"), VOTER_E.publicKey.toBuffer()],
  ENTROS_ANCHOR_PROGRAM_ID
);

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
    combined.includes(hexCode) || combined.includes(`custom program error: ${hexCode}`),
    `Expected error code ${hexCode} but got: ${msg}`
  ).to.be.true;
}

async function createMint(payerKp: Keypair): Promise<PublicKey> {
  const mintKeypair = Keypair.generate();
  const mintRent = await getMinimumBalanceForRentExemptMint(connection);

  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: payerKp.publicKey,
      newAccountPubkey: mintKeypair.publicKey,
      lamports: mintRent,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    createInitializeMintInstruction(
      mintKeypair.publicKey,
      0,
      payerKp.publicKey,
      null
    )
  );

  await sendAndConfirmTransaction(connection, tx, [payerKp, mintKeypair]);
  return mintKeypair.publicKey;
}

async function fundSigner(recipient: PublicKey): Promise<void> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: payer.publicKey,
      toPubkey: recipient,
      lamports: LAMPORTS_PER_SOL,
    })
  );
  await sendAndConfirmTransaction(connection, tx, [payer]);
}

describe("entros-voter-weight integration", () => {
  before(async () => {
    // Verify fixture accounts are loaded
    const identityA = await connection.getAccountInfo(VOTER_A_IDENTITY_PDA);
    expect(identityA, "VOTER_A IdentityState fixture not loaded").to.not.be
      .null;
    expect(identityA!.owner.toBase58()).to.equal(
      ENTROS_ANCHOR_PROGRAM_ID.toBase58()
    );

    const identityB = await connection.getAccountInfo(VOTER_B_IDENTITY_PDA);
    expect(identityB, "VOTER_B IdentityState fixture not loaded").to.not.be
      .null;
  });

  describe("happy path", () => {
    before(async () => {
      communityMint = await createMint(payer);

      const realmName = `Entros-Test-${Date.now().toString(36)}`;
      const realm = buildCreateRealmInstruction(
        realmName,
        payer.publicKey,
        communityMint,
        payer.publicKey,
        PLUGIN_PROGRAM_ID
      );
      realmPda = realm.realmPda;

      const tx = new Transaction().add(realm.instruction);
      await sendAndConfirmTransaction(connection, tx, [payer]);
    });

    it("creates a registrar", async () => {
      const result = buildCreateRegistrarInstruction(
        realmPda,
        communityMint,
        payer.publicKey,
        payer.publicKey,
        100,
        2000000000n
      );
      registrarPda = result.registrarPda;

      const tx = new Transaction().add(result.instruction);
      await sendAndConfirmTransaction(connection, tx, [payer]);

      const account = await connection.getAccountInfo(registrarPda);
      expect(account).to.not.be.null;
      expect(account!.owner.toBase58()).to.equal(PLUGIN_PROGRAM_ID.toBase58());

      // Verify min_trust_score at offset 8+32+32+32=104, u16 LE
      const trustScore = account!.data.readUInt16LE(104);
      expect(trustScore).to.equal(100);
    });

    it("updates registrar config", async () => {
      const ix = buildUpdateRegistrarInstruction(
        registrarPda,
        realmPda,
        payer.publicKey,
        50,
        1000000000n
      );

      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [payer]);

      const account = await connection.getAccountInfo(registrarPda);
      const trustScore = account!.data.readUInt16LE(104);
      expect(trustScore).to.equal(50);

      // Restore to 100 for subsequent tests
      const restoreIx = buildUpdateRegistrarInstruction(
        registrarPda,
        realmPda,
        payer.publicKey,
        100,
        2000000000n
      );
      const restoreTx = new Transaction().add(restoreIx);
      await sendAndConfirmTransaction(connection, restoreTx, [payer]);
    });

    it("creates voter weight record (born expired)", async () => {
      const result = buildCreateVoterWeightRecordInstruction(
        registrarPda,
        realmPda,
        communityMint,
        VOTER_A.publicKey,
        payer.publicKey
      );
      vwrPda = result.vwrPda;

      const tx = new Transaction().add(result.instruction);
      // VOTER_A must sign because the new `governing_token_owner_signer`
      // constraint binds the VWR creation to the wallet it represents.
      await sendAndConfirmTransaction(connection, tx, [payer]);

      const account = await connection.getAccountInfo(vwrPda);
      expect(account).to.not.be.null;

      // voter_weight at offset 104 (8 disc + 32 realm + 32 mint + 32 owner = 104)
      const voterWeight = account!.data.readBigUInt64LE(104);
      expect(voterWeight).to.equal(0n);

      // voter_weight_expiry: Option tag at 112, value at 113
      const expiryTag = account!.data.readUInt8(112);
      expect(expiryTag).to.equal(1); // Some
      const expiryValue = account!.data.readBigUInt64LE(113);
      expect(expiryValue).to.equal(0n); // expired
    });

    it("updates voter weight record -> voter_weight=1 with current-slot expiry", async () => {
      const preSlot = BigInt(await connection.getSlot("confirmed"));
      const ix = buildUpdateVoterWeightRecordInstruction(
        registrarPda,
        vwrPda,
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA
      );

      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [VOTER_A]);
      const postSlot = BigInt(await connection.getSlot("confirmed"));

      const account = await connection.getAccountInfo(vwrPda);
      const voterWeight = account!.data.readBigUInt64LE(104);
      expect(voterWeight).to.equal(1n);

      const expiryTag = account!.data.readUInt8(112);
      expect(expiryTag).to.equal(1);
      const expiryValue = account!.data.readBigUInt64LE(113);
      // Expiry is the slot of the update
      expect(expiryValue >= preSlot).to.be.true;
      expect(expiryValue <= postSlot).to.be.true;

      // weight_action (offset 121) and weight_action_target (offset 122) are None (0)
      expect(account!.data.readUInt8(121)).to.equal(0);
      expect(account!.data.readUInt8(122)).to.equal(0);
    });

    it("closes voter weight record", async () => {
      const ix = buildCloseVoterWeightRecordInstruction(
        registrarPda,
        vwrPda,
        VOTER_A.publicKey,
        VOTER_A.publicKey
      );

      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [VOTER_A]);

      const account = await connection.getAccountInfo(vwrPda);
      expect(account).to.be.null;
    });

    it("closes registrar", async () => {
      const ix = buildCloseRegistrarInstruction(
        registrarPda,
        realmPda,
        payer.publicKey,
        payer.publicKey
      );

      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [payer]);

      const account = await connection.getAccountInfo(registrarPda);
      expect(account).to.be.null;
    });
  });

  describe("create_registrar failures", () => {
    let failRealmPda: PublicKey;
    let failMint: PublicKey;

    before(async () => {
      failMint = await createMint(payer);
      const realmName = `Fail-Realm-${Date.now().toString(36)}`;
      const realm = buildCreateRealmInstruction(
        realmName,
        payer.publicKey,
        failMint,
        payer.publicKey,
        PLUGIN_PROGRAM_ID
      );
      failRealmPda = realm.realmPda;
      const tx = new Transaction().add(realm.instruction);
      await sendAndConfirmTransaction(connection, tx, [payer]);
    });

    it("rejects wrong realm authority", async () => {
      const wrongAuthority = Keypair.generate();
      await fundSigner(wrongAuthority.publicKey);

      const result = buildCreateRegistrarInstruction(
        failRealmPda,
        failMint,
        wrongAuthority.publicKey,
        wrongAuthority.publicKey,
        100,
        2000000000n
      );

      const tx = new Transaction().add(result.instruction);
      try {
        await sendAndConfirmTransaction(connection, tx, [wrongAuthority]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6000); // InvalidRealmAuthority
      }
    });
  });

  describe("update_voter_weight_record failures", () => {
    let failRealmPda: PublicKey;
    let failRegistrarPda: PublicKey;
    let failVwrA: PublicKey;
    let failVwrB: PublicKey;
    let failVwrC: PublicKey;
    let failMint: PublicKey;

    before(async () => {
      failMint = await createMint(payer);
      const realmName = `Fail-VWR-${Date.now().toString(36)}`;
      const realm = buildCreateRealmInstruction(
        realmName,
        payer.publicKey,
        failMint,
        payer.publicKey,
        PLUGIN_PROGRAM_ID
      );
      failRealmPda = realm.realmPda;
      const realmTx = new Transaction().add(realm.instruction);
      await sendAndConfirmTransaction(connection, realmTx, [payer]);

      const registrar = buildCreateRegistrarInstruction(
        failRealmPda,
        failMint,
        payer.publicKey,
        payer.publicKey,
        100,
        2000000000n
      );
      failRegistrarPda = registrar.registrarPda;
      const regTx = new Transaction().add(registrar.instruction);
      await sendAndConfirmTransaction(connection, regTx, [payer]);

      const vwrA = buildCreateVoterWeightRecordInstruction(
        failRegistrarPda,
        failRealmPda,
        failMint,
        VOTER_A.publicKey,
        payer.publicKey
      );
      failVwrA = vwrA.vwrPda;
      const vwrATx = new Transaction().add(vwrA.instruction);
      await sendAndConfirmTransaction(connection, vwrATx, [payer]);

      const vwrB = buildCreateVoterWeightRecordInstruction(
        failRegistrarPda,
        failRealmPda,
        failMint,
        VOTER_B.publicKey,
        payer.publicKey
      );
      failVwrB = vwrB.vwrPda;
      const vwrBTx = new Transaction().add(vwrB.instruction);
      await sendAndConfirmTransaction(connection, vwrBTx, [payer, VOTER_B]);

      const vwrC = buildCreateVoterWeightRecordInstruction(
        failRegistrarPda,
        failRealmPda,
        failMint,
        VOTER_C.publicKey,
        payer.publicKey
      );
      failVwrC = vwrC.vwrPda;
      const vwrCTx = new Transaction().add(vwrC.instruction);
      await sendAndConfirmTransaction(connection, vwrCTx, [payer, VOTER_C]);
    });

    it("rejects update with no remaining_accounts", async () => {
      // Build update instruction manually without identity PDA
      const disc = anchorDiscriminator("update_voter_weight_record");

      const ix = {
        programId: PLUGIN_PROGRAM_ID,
        keys: [
          { pubkey: failRegistrarPda, isSigner: false, isWritable: false },
          { pubkey: failVwrA, isSigner: false, isWritable: true },
          { pubkey: VOTER_A.publicKey, isSigner: true, isWritable: false },
          // NO remaining_accounts
        ],
        data: disc,
      };

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [VOTER_A]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6001); // MissingIdentityAccount
      }
    });

    it("rejects update with wrong identity PDA", async () => {
      // Pass VOTER_B's identity for VOTER_A's VWR
      const ix = buildUpdateVoterWeightRecordInstruction(
        failRegistrarPda,
        failVwrA,
        VOTER_A.publicKey,
        VOTER_B_IDENTITY_PDA
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [VOTER_A]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6002); // InvalidIdentityPda
      }
    });

    it("rejects update with wrong identity owner", async () => {
      // Pass the registrar account as identity -- it's owned by the plugin, not Entros
      const ix = buildUpdateVoterWeightRecordInstruction(
        failRegistrarPda,
        failVwrA,
        VOTER_A.publicKey,
        failRegistrarPda // wrong owner (plugin program, not Entros)
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [VOTER_A]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6003); // InvalidIdentityOwner
      }
    });

    it("rejects update with wrong identity discriminator", async () => {
      // VOTER_C's IdentityState fixture is owned by Entros at the correct PDA with a
      // passing trust score + recent verification, but carries a wrong account
      // discriminator -- only the discriminator type-confusion guard can reject it.
      const ix = buildUpdateVoterWeightRecordInstruction(
        failRegistrarPda,
        failVwrC,
        VOTER_C.publicKey,
        VOTER_C_IDENTITY_PDA
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [VOTER_C]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6004); // InvalidIdentityData (discriminator mismatch)
      }
    });

    it("rejects update with trust score below minimum", async () => {
      // VOTER_B has trust_score=50, registrar min=100
      const ix = buildUpdateVoterWeightRecordInstruction(
        failRegistrarPda,
        failVwrB,
        VOTER_B.publicKey,
        VOTER_B_IDENTITY_PDA
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [VOTER_B]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6005); // InsufficientTrustScore
      }
    });

    it("rejects update with expired verification", async () => {
      // Create a new registrar with max_verification_age=1 (1 second)
      const expMint = await createMint(payer);
      const expRealmName = `Exp-Realm-${Date.now().toString(36)}`;
      const expRealm = buildCreateRealmInstruction(
        expRealmName,
        payer.publicKey,
        expMint,
        payer.publicKey,
        PLUGIN_PROGRAM_ID
      );
      const expRealmTx = new Transaction().add(expRealm.instruction);
      await sendAndConfirmTransaction(connection, expRealmTx, [payer]);

      const expRegistrar = buildCreateRegistrarInstruction(
        expRealm.realmPda,
        expMint,
        payer.publicKey,
        payer.publicKey,
        0, // min_trust_score=0 (don't fail on trust)
        1n // max_verification_age=1 second (identity timestamp is from 2023, definitely expired)
      );
      const expRegTx = new Transaction().add(expRegistrar.instruction);
      await sendAndConfirmTransaction(connection, expRegTx, [payer]);

      const expVwr = buildCreateVoterWeightRecordInstruction(
        expRegistrar.registrarPda,
        expRealm.realmPda,
        expMint,
        VOTER_A.publicKey,
        payer.publicKey
      );
      const expVwrTx = new Transaction().add(expVwr.instruction);
      await sendAndConfirmTransaction(connection, expVwrTx, [payer]);

      const ix = buildUpdateVoterWeightRecordInstruction(
        expRegistrar.registrarPda,
        expVwr.vwrPda,
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [VOTER_A]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6006); // VerificationExpired
      }
    });
  });

  describe("close_voter_weight_record failures", () => {
    let closeRealmPda: PublicKey;
    let closeRegistrarPda: PublicKey;
    let closeVwrPda: PublicKey;

    before(async () => {
      const closeMint = await createMint(payer);
      const realmName = `Close-VWR-${Date.now().toString(36)}`;
      const realm = buildCreateRealmInstruction(
        realmName,
        payer.publicKey,
        closeMint,
        payer.publicKey,
        PLUGIN_PROGRAM_ID
      );
      closeRealmPda = realm.realmPda;
      const realmTx = new Transaction().add(realm.instruction);
      await sendAndConfirmTransaction(connection, realmTx, [payer]);

      const registrar = buildCreateRegistrarInstruction(
        closeRealmPda,
        closeMint,
        payer.publicKey,
        payer.publicKey,
        100,
        2000000000n
      );
      closeRegistrarPda = registrar.registrarPda;
      const regTx = new Transaction().add(registrar.instruction);
      await sendAndConfirmTransaction(connection, regTx, [payer]);

      const vwr = buildCreateVoterWeightRecordInstruction(
        closeRegistrarPda,
        closeRealmPda,
        closeMint,
        VOTER_A.publicKey,
        payer.publicKey
      );
      closeVwrPda = vwr.vwrPda;
      const vwrTx = new Transaction().add(vwr.instruction);
      await sendAndConfirmTransaction(connection, vwrTx, [payer]);
    });

    it("rejects close with wrong voter authority", async () => {
      const ix = buildCloseVoterWeightRecordInstruction(
        closeRegistrarPda,
        closeVwrPda,
        VOTER_B.publicKey, // wrong voter
        VOTER_B.publicKey
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [VOTER_B]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6009); // VoterWeightRecordOwnerMismatch
      }
    });
  });

  describe("update_registrar failures", () => {
    let updRealmPda: PublicKey;
    let updRegistrarPda: PublicKey;

    before(async () => {
      const updMint = await createMint(payer);
      const realmName = `Upd-Reg-${Date.now().toString(36)}`;
      const realm = buildCreateRealmInstruction(
        realmName,
        payer.publicKey,
        updMint,
        payer.publicKey,
        PLUGIN_PROGRAM_ID
      );
      updRealmPda = realm.realmPda;
      const realmTx = new Transaction().add(realm.instruction);
      await sendAndConfirmTransaction(connection, realmTx, [payer]);

      const registrar = buildCreateRegistrarInstruction(
        updRealmPda,
        updMint,
        payer.publicKey,
        payer.publicKey,
        100,
        2000000000n
      );
      updRegistrarPda = registrar.registrarPda;
      const regTx = new Transaction().add(registrar.instruction);
      await sendAndConfirmTransaction(connection, regTx, [payer]);
    });

    it("rejects update with wrong authority", async () => {
      const wrongAuth = Keypair.generate();
      await fundSigner(wrongAuth.publicKey);

      const ix = buildUpdateRegistrarInstruction(
        updRegistrarPda,
        updRealmPda,
        wrongAuth.publicKey,
        50,
        1000000000n
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [wrongAuth]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6000); // InvalidRealmAuthority
      }
    });
  });

  describe("close_registrar failures", () => {
    let closeRegRealmPda: PublicKey;
    let closeRegRegistrarPda: PublicKey;

    before(async () => {
      const closeRegMint = await createMint(payer);
      const realmName = `Close-Reg-${Date.now().toString(36)}`;
      const realm = buildCreateRealmInstruction(
        realmName,
        payer.publicKey,
        closeRegMint,
        payer.publicKey,
        PLUGIN_PROGRAM_ID
      );
      closeRegRealmPda = realm.realmPda;
      const realmTx = new Transaction().add(realm.instruction);
      await sendAndConfirmTransaction(connection, realmTx, [payer]);

      const registrar = buildCreateRegistrarInstruction(
        closeRegRealmPda,
        closeRegMint,
        payer.publicKey,
        payer.publicKey,
        100,
        2000000000n
      );
      closeRegRegistrarPda = registrar.registrarPda;
      const regTx = new Transaction().add(registrar.instruction);
      await sendAndConfirmTransaction(connection, regTx, [payer]);
    });

    it("rejects close with wrong authority", async () => {
      const wrongAuth = Keypair.generate();
      await fundSigner(wrongAuth.publicKey);

      const ix = buildCloseRegistrarInstruction(
        closeRegRegistrarPda,
        closeRegRealmPda,
        wrongAuth.publicKey,
        wrongAuth.publicKey
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [wrongAuth]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6000); // InvalidRealmAuthority
      }
    });
  });

  describe("max voter weight record", () => {
    let mvwrRealmPda: PublicKey;
    let mvwrRegistrarPda: PublicKey;
    let mvwrMint: PublicKey;
    let maxVwrPda: PublicKey;

    before(async () => {
      mvwrMint = await createMint(payer);
      const realmName = `MVWR-Realm-${Date.now().toString(36)}`;
      const realm = buildCreateRealmInstruction(
        realmName,
        payer.publicKey,
        mvwrMint,
        payer.publicKey,
        PLUGIN_PROGRAM_ID
      );
      mvwrRealmPda = realm.realmPda;
      const realmTx = new Transaction().add(realm.instruction);
      await sendAndConfirmTransaction(connection, realmTx, [payer]);

      const registrar = buildCreateRegistrarInstruction(
        mvwrRealmPda,
        mvwrMint,
        payer.publicKey,
        payer.publicKey,
        100,
        2000000000n
      );
      mvwrRegistrarPda = registrar.registrarPda;
      const regTx = new Transaction().add(registrar.instruction);
      await sendAndConfirmTransaction(connection, regTx, [payer]);
    });

    it("creates max voter weight record (born expired)", async () => {
      const result = buildCreateMaxVoterWeightRecordInstruction(
        mvwrRegistrarPda,
        mvwrRealmPda,
        mvwrMint,
        payer.publicKey,
        payer.publicKey
      );
      maxVwrPda = result.maxVwrPda;

      const tx = new Transaction().add(result.instruction);
      await sendAndConfirmTransaction(connection, tx, [payer]);

      const account = await connection.getAccountInfo(maxVwrPda);
      expect(account).to.not.be.null;
      expect(account!.owner.toBase58()).to.equal(PLUGIN_PROGRAM_ID.toBase58());

      // max_voter_weight at offset 8+32+32=72, u64 LE
      const maxWeight = account!.data.readBigUInt64LE(72);
      expect(maxWeight).to.equal(0n);

      // max_voter_weight_expiry: Option tag at 80, value at 81
      const expiryTag = account!.data.readUInt8(80);
      expect(expiryTag).to.equal(1); // Some
      const expiryValue = account!.data.readBigUInt64LE(81);
      expect(expiryValue).to.equal(0n); // expired
    });

    it("updates max voter weight record", async () => {
      const ix = buildUpdateMaxVoterWeightRecordInstruction(
        mvwrRegistrarPda,
        maxVwrPda,
        mvwrRealmPda,
        payer.publicKey,
        100n // max 100 verified humans in this DAO
      );

      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [payer]);

      const account = await connection.getAccountInfo(maxVwrPda);
      const maxWeight = account!.data.readBigUInt64LE(72);
      expect(maxWeight).to.equal(100n);

      // Expiry should be None (admin-managed, never expires)
      const expiryTag = account!.data.readUInt8(80);
      expect(expiryTag).to.equal(0); // None
    });

    it("rejects update with wrong authority", async () => {
      const wrongAuth = Keypair.generate();
      await fundSigner(wrongAuth.publicKey);

      const ix = buildUpdateMaxVoterWeightRecordInstruction(
        mvwrRegistrarPda,
        maxVwrPda,
        mvwrRealmPda,
        wrongAuth.publicKey,
        999n
      );

      const tx = new Transaction().add(ix);
      try {
        await sendAndConfirmTransaction(connection, tx, [wrongAuth]);
        expect.fail("Should have failed");
      } catch (err) {
        expectError(err, 6000); // InvalidRealmAuthority
      }
    });
  });

  describe("action-bound voter weight and spl-governance consumer checks", () => {
    let govRealmAuthority: Keypair;
    let govMint: PublicKey;
    let govRealmPda: PublicKey;
    let govRegistrarPda: PublicKey;
    let govVwrA: PublicKey;
    let govTokenOwnerRecordA: PublicKey;

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
      // Use a distinct realm authority so VOTER_A must authenticate through
      // TokenOwnerRecord + VoterWeightRecord when calling CreateGovernance.
      govRealmAuthority = Keypair.generate();
      await fundSigner(govRealmAuthority.publicKey);

      govMint = await createMint(payer);
      const realmName = `Gov-Consumer-${Date.now().toString(36)}`;
      const realm = buildCreateRealmInstruction(
        realmName,
        govRealmAuthority.publicKey,
        govMint,
        payer.publicKey,
        PLUGIN_PROGRAM_ID
      );
      govRealmPda = realm.realmPda;
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(realm.instruction),
        [payer]
      );

      const registrar = buildCreateRegistrarInstruction(
        govRealmPda,
        govMint,
        govRealmAuthority.publicKey,
        payer.publicKey,
        100,
        2000000000n
      );
      govRegistrarPda = registrar.registrarPda;
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(registrar.instruction),
        [payer, govRealmAuthority]
      );

      const vwr = buildCreateVoterWeightRecordInstruction(
        govRegistrarPda,
        govRealmPda,
        govMint,
        VOTER_A.publicKey,
        payer.publicKey
      );
      govVwrA = vwr.vwrPda;
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(vwr.instruction),
        [payer]
      );

      const tor = buildCreateTokenOwnerRecordInstruction(
        govRealmPda,
        VOTER_A.publicKey,
        govMint,
        payer.publicKey
      );
      govTokenOwnerRecordA = tor.tokenOwnerRecordPda;
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(tor.instruction),
        [payer]
      );
    });

    it("rejects CreateGovernance when VWR is born expired (stale record)", async () => {
      const governed = Keypair.generate().publicKey;
      const createGov = buildCreateGovernanceInstruction(
        govRealmPda,
        governed,
        govTokenOwnerRecordA,
        VOTER_A.publicKey,
        VOTER_A.publicKey,
        govVwrA
      );

      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(createGov.instruction),
          [VOTER_A]
        );
        expect.fail("Should have failed with VoterWeightRecordExpired");
      } catch (err) {
        expectError(err, 577); // GovernanceError::VoterWeightRecordExpired (0x241)
      }
    });

    it("rejects action-bound update with default/zero target pubkey", async () => {
      const ix = buildUpdateVoterWeightRecordForActionInstruction(
        govRegistrarPda,
        govVwrA,
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA,
        VoterWeightActionTag.CreateGovernance,
        PublicKey.default
      );

      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(ix),
          [VOTER_A]
        );
        expect.fail("Should have failed with InvalidWeightActionTarget");
      } catch (err) {
        expectError(err, 6014); // EntrosVoterError::InvalidWeightActionTarget
      }
    });

    it("rejects CreateGovernance when VWR is bound to the wrong action", async () => {
      const governed = Keypair.generate().publicKey;
      const updateIx = buildUpdateVoterWeightRecordForActionInstruction(
        govRegistrarPda,
        govVwrA,
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA,
        VoterWeightActionTag.CastVote, // wrong action for CreateGovernance
        govRealmPda
      );
      const createGov = buildCreateGovernanceInstruction(
        govRealmPda,
        governed,
        govTokenOwnerRecordA,
        VOTER_A.publicKey,
        VOTER_A.publicKey,
        govVwrA
      );

      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(updateIx, createGov.instruction),
          [VOTER_A]
        );
        expect.fail("Should have failed with VoterWeightRecordInvalidAction");
      } catch (err) {
        expectError(err, 587); // GovernanceError::VoterWeightRecordInvalidAction (0x24b)
      }
    });

    it("rejects CreateGovernance when VWR is bound to the wrong action target", async () => {
      const governed = Keypair.generate().publicKey;
      const wrongTarget = Keypair.generate().publicKey;
      const updateIx = buildUpdateVoterWeightRecordForActionInstruction(
        govRegistrarPda,
        govVwrA,
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA,
        VoterWeightActionTag.CreateGovernance,
        wrongTarget // CreateGovernance expects realmPda as target
      );
      const createGov = buildCreateGovernanceInstruction(
        govRealmPda,
        governed,
        govTokenOwnerRecordA,
        VOTER_A.publicKey,
        VOTER_A.publicKey,
        govVwrA
      );

      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(updateIx, createGov.instruction),
          [VOTER_A]
        );
        expect.fail(
          "Should have failed with VoterWeightRecordInvalidActionTarget"
        );
      } catch (err) {
        expectError(err, 588); // GovernanceError::VoterWeightRecordInvalidActionTarget (0x24c)
      }
    });

    it("rejects delayed settlement across slots when using action-bound current-slot expiry", async () => {
      const updateIx = buildUpdateVoterWeightRecordForActionInstruction(
        govRegistrarPda,
        govVwrA,
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA,
        VoterWeightActionTag.CreateGovernance,
        govRealmPda
      );
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(updateIx),
        [VOTER_A]
      );

      const vwrAccount = await connection.getAccountInfo(govVwrA);
      const expirySlot = vwrAccount!.data.readBigUInt64LE(113);
      // Action-bound expiry is exact clock.slot; wait for the next slot
      await waitForSlotAfter(expirySlot);

      const governed = Keypair.generate().publicKey;
      const createGov = buildCreateGovernanceInstruction(
        govRealmPda,
        governed,
        govTokenOwnerRecordA,
        VOTER_A.publicKey,
        VOTER_A.publicKey,
        govVwrA
      );

      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(createGov.instruction),
          [VOTER_A]
        );
        expect.fail("Should have failed with VoterWeightRecordExpired");
      } catch (err) {
        expectError(err, 577); // GovernanceError::VoterWeightRecordExpired (0x241)
      }
    });

    it("succeeds on atomic retry with matching action and target in the same transaction", async () => {
      const governed = Keypair.generate().publicKey;
      const updateIx = buildUpdateVoterWeightRecordForActionInstruction(
        govRegistrarPda,
        govVwrA,
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA,
        VoterWeightActionTag.CreateGovernance,
        govRealmPda
      );
      const createGov = buildCreateGovernanceInstruction(
        govRealmPda,
        governed,
        govTokenOwnerRecordA,
        VOTER_A.publicKey,
        VOTER_A.publicKey,
        govVwrA
      );

      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(updateIx, createGov.instruction),
        [VOTER_A]
      );

      const govAccount = await connection.getAccountInfo(
        createGov.governancePda
      );
      expect(govAccount).to.not.be.null;

      const vwrAccount = await connection.getAccountInfo(govVwrA);
      // Some(VoterWeightAction::CreateGovernance == 2) at offsets 121..123
      expect(vwrAccount!.data.readUInt8(121)).to.equal(1);
      expect(vwrAccount!.data.readUInt8(122)).to.equal(
        VoterWeightActionTag.CreateGovernance
      );
      // Some(govRealmPda) at offsets 123..156
      expect(vwrAccount!.data.readUInt8(123)).to.equal(1);
      expect(
        new PublicKey(vwrAccount!.data.slice(124, 156)).toBase58()
      ).to.equal(govRealmPda.toBase58());
    });

    it("expires a standalone update after its slot", async () => {
      const updateIx = buildUpdateVoterWeightRecordInstruction(
        govRegistrarPda,
        govVwrA,
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA
      );
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(updateIx),
        [VOTER_A]
      );

      const vwrAccount = await connection.getAccountInfo(govVwrA);
      const expirySlot = vwrAccount!.data.readBigUInt64LE(113);
      await waitForSlotAfter(expirySlot);

      const governed = Keypair.generate().publicKey;
      const createGov = buildCreateGovernanceInstruction(
        govRealmPda,
        governed,
        govTokenOwnerRecordA,
        VOTER_A.publicKey,
        VOTER_A.publicKey,
        govVwrA
      );

      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(createGov.instruction),
          [VOTER_A]
        );
        expect.fail("Should have failed with VoterWeightRecordExpired");
      } catch (err) {
        expectError(err, 577); // GovernanceError::VoterWeightRecordExpired (0x241)
      }
    });

    it("rejects action-bound update when IdentityState verification evidence is stale", async () => {
      // Tighten max_verification_age to 1 second so the 2023 fixture is stale
      const tightenIx = buildUpdateRegistrarInstruction(
        govRegistrarPda,
        govRealmPda,
        govRealmAuthority.publicKey,
        100,
        1n
      );
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(tightenIx),
        [govRealmAuthority]
      );

      const updateIx = buildUpdateVoterWeightRecordForActionInstruction(
        govRegistrarPda,
        govVwrA,
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA,
        VoterWeightActionTag.CreateGovernance,
        govRealmPda
      );

      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(updateIx),
          [VOTER_A]
        );
        expect.fail("Should have failed with VerificationExpired");
      } catch (err) {
        expectError(err, 6006); // EntrosVoterError::VerificationExpired
      } finally {
        const restoreIx = buildUpdateRegistrarInstruction(
          govRegistrarPda,
          govRealmPda,
          govRealmAuthority.publicKey,
          100,
          2000000000n
        );
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(restoreIx),
          [govRealmAuthority]
        );
      }
    });
  });

  describe("vote weight after an identity migration", () => {
    // One identity keeps its trust score and verification time when it moves to a
    // new wallet, and spl-governance counts one vote per wallet. These cases cover
    // the rule that stops the identity from voting on one proposal from two wallets.
    const voters = [
      { keypair: VOTER_A, identity: VOTER_A_IDENTITY_PDA },
      { keypair: VOTER_D, identity: VOTER_D_IDENTITY_PDA },
      { keypair: VOTER_E, identity: VOTER_E_IDENTITY_PDA },
    ];
    const weightRecords = new Map<string, PublicKey>();
    const ownerRecords = new Map<string, PublicKey>();

    let voteRealmAuthority: Keypair;
    let voteMint: PublicKey;
    let voteRealmPda: PublicKey;
    let voteRegistrarPda: PublicKey;
    let voteGovernancePda: PublicKey;
    let proposalPda: PublicKey;

    const weightRecordOf = (voter: Keypair) =>
      weightRecords.get(voter.publicKey.toBase58())!;
    const ownerRecordOf = (voter: Keypair) =>
      ownerRecords.get(voter.publicKey.toBase58())!;

    function voteUpdate(
      voter: Keypair,
      identity: PublicKey,
      target: PublicKey,
      overrides = {}
    ) {
      return buildUpdateVoterWeightRecordForActionInstruction(
        voteRegistrarPda,
        weightRecordOf(voter),
        voter.publicKey,
        identity,
        VoterWeightActionTag.CastVote,
        target,
        overrides
      );
    }

    function castVote(voter: Keypair, proposal: PublicKey) {
      return buildCastVoteInstruction(
        voteRealmPda,
        voteGovernancePda,
        proposal,
        ownerRecordOf(VOTER_A),
        ownerRecordOf(voter),
        voter.publicKey,
        voteMint,
        voter.publicKey,
        weightRecordOf(voter)
      );
    }

    async function createProposal(
      name: string,
      creator: Keypair = VOTER_A,
      identity: PublicKey = VOTER_A_IDENTITY_PDA
    ): Promise<PublicKey> {
      const updateIx = buildUpdateVoterWeightRecordForActionInstruction(
        voteRegistrarPda,
        weightRecordOf(creator),
        creator.publicKey,
        identity,
        VoterWeightActionTag.CreateProposal,
        voteGovernancePda
      );
      const proposal = buildCreateProposalInstruction(
        voteRealmPda,
        voteGovernancePda,
        ownerRecordOf(creator),
        voteMint,
        creator.publicKey,
        creator.publicKey,
        Keypair.generate().publicKey,
        weightRecordOf(creator),
        name
      );
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(updateIx, proposal.instruction),
        [creator]
      );
      return proposal.proposalPda;
    }

    before(async () => {
      voteRealmAuthority = Keypair.generate();
      await fundSigner(voteRealmAuthority.publicKey);

      voteMint = await createMint(payer);
      // The mint supply is the largest possible vote weight. With a supply of 100,
      // a single vote does not decide the proposal, so it stays in voting.
      const supplyAccount = getAssociatedTokenAddressSync(
        voteMint,
        payer.publicKey
      );
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          createAssociatedTokenAccountInstruction(
            payer.publicKey,
            supplyAccount,
            payer.publicKey,
            voteMint
          ),
          createMintToInstruction(voteMint, supplyAccount, payer.publicKey, 100)
        ),
        [payer]
      );
      const realm = buildCreateRealmInstruction(
        `Vote-Migration-${Date.now().toString(36)}`,
        voteRealmAuthority.publicKey,
        voteMint,
        payer.publicKey,
        PLUGIN_PROGRAM_ID
      );
      voteRealmPda = realm.realmPda;
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(realm.instruction),
        [payer]
      );

      const registrar = buildCreateRegistrarInstruction(
        voteRealmPda,
        voteMint,
        voteRealmAuthority.publicKey,
        payer.publicKey,
        100,
        2000000000n
      );
      voteRegistrarPda = registrar.registrarPda;
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(registrar.instruction),
        [payer, voteRealmAuthority]
      );

      for (const { keypair } of voters) {
        const vwr = buildCreateVoterWeightRecordInstruction(
          voteRegistrarPda,
          voteRealmPda,
          voteMint,
          keypair.publicKey,
          payer.publicKey
        );
        const tor = buildCreateTokenOwnerRecordInstruction(
          voteRealmPda,
          keypair.publicKey,
          voteMint,
          payer.publicKey
        );
        // The voter signs for its own voter weight record.
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(vwr.instruction, tor.instruction),
          keypair === payer ? [payer] : [payer, keypair]
        );
        weightRecords.set(keypair.publicKey.toBase58(), vwr.vwrPda);
        ownerRecords.set(keypair.publicKey.toBase58(), tor.tokenOwnerRecordPda);
      }

      const governanceUpdate = buildUpdateVoterWeightRecordForActionInstruction(
        voteRegistrarPda,
        weightRecordOf(VOTER_A),
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA,
        VoterWeightActionTag.CreateGovernance,
        voteRealmPda
      );
      const governance = buildCreateGovernanceInstruction(
        voteRealmPda,
        Keypair.generate().publicKey,
        ownerRecordOf(VOTER_A),
        VOTER_A.publicKey,
        VOTER_A.publicKey,
        weightRecordOf(VOTER_A)
      );
      voteGovernancePda = governance.governancePda;
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(governanceUpdate, governance.instruction),
        [VOTER_A]
      );

      proposalPda = await createProposal("Vote after migration");
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          buildSignOffProposalInstruction(
            voteRealmPda,
            voteGovernancePda,
            proposalPda,
            VOTER_A.publicKey,
            ownerRecordOf(VOTER_A)
          )
        ),
        [VOTER_A]
      );
    });

    it("counts the vote of a wallet that never received a migration", async () => {
      const vote = castVote(VOTER_A, proposalPda);
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          voteUpdate(VOTER_A, VOTER_A_IDENTITY_PDA, proposalPda),
          vote.instruction
        ),
        [VOTER_A]
      );
      expect(await connection.getAccountInfo(vote.voteRecordPda)).to.not.be.null;
    });

    it("counts the vote of a wallet whose identity arrived before voting started", async () => {
      const vote = castVote(VOTER_D, proposalPda);
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          voteUpdate(VOTER_D, VOTER_D_IDENTITY_PDA, proposalPda),
          vote.instruction
        ),
        [VOTER_D]
      );
      expect(await connection.getAccountInfo(vote.voteRecordPda)).to.not.be.null;
    });

    it("refuses the vote of a wallet whose identity arrived after voting started", async () => {
      const vote = castVote(VOTER_E, proposalPda);
      try {
        await sendAndConfirmTransaction(
          connection,
          new Transaction().add(
            voteUpdate(VOTER_E, VOTER_E_IDENTITY_PDA, proposalPda),
            vote.instruction
          ),
          [VOTER_E]
        );
        expect.fail("Should have failed with IdentityMigratedAfterVotingStart");
      } catch (err) {
        expectError(err, 6022); // EntrosVoterError::IdentityMigratedAfterVotingStart
      }
      expect(await connection.getAccountInfo(vote.voteRecordPda)).to.be.null;
    });

    it("refuses the general update for a wallet that received a migration", async () => {
      const ix = buildUpdateVoterWeightRecordInstruction(
        voteRegistrarPda,
        weightRecordOf(VOTER_D),
        VOTER_D.publicKey,
        VOTER_D_IDENTITY_PDA
      );
      try {
        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
          VOTER_D,
        ]);
        expect.fail("Should have failed with MigratedIdentityNeedsActionTarget");
      } catch (err) {
        expectError(err, 6018); // EntrosVoterError::MigratedIdentityNeedsActionTarget
      }
    });

    it("refuses the general update without the migration record account", async () => {
      const ix = buildUpdateVoterWeightRecordInstruction(
        voteRegistrarPda,
        weightRecordOf(VOTER_A),
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA,
        { migrationRecord: null }
      );
      try {
        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
          VOTER_A,
        ]);
        expect.fail("Should have failed with MissingMigrationRecord");
      } catch (err) {
        expectError(err, 6015); // EntrosVoterError::MissingMigrationRecord
      }
    });

    it("refuses a vote update that names another wallet's migration record", async () => {
      // A migrated wallet must not present the empty record address of a wallet
      // that never migrated.
      const ix = voteUpdate(VOTER_E, VOTER_E_IDENTITY_PDA, proposalPda, {
        migrationRecord: deriveMigrationRecordPda(VOTER_A.publicKey),
      });
      try {
        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
          VOTER_E,
        ]);
        expect.fail("Should have failed with InvalidMigrationRecordPda");
      } catch (err) {
        expectError(err, 6016); // EntrosVoterError::InvalidMigrationRecordPda
      }
    });

    it("refuses a vote update without the proposal account", async () => {
      const ix = voteUpdate(VOTER_A, VOTER_A_IDENTITY_PDA, proposalPda, {
        proposal: null,
      });
      try {
        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
          VOTER_A,
        ]);
        expect.fail("Should have failed with MissingProposalAccount");
      } catch (err) {
        expectError(err, 6019); // EntrosVoterError::MissingProposalAccount
      }
    });

    it("refuses a vote update whose proposal account is not the target", async () => {
      const ix = voteUpdate(VOTER_A, VOTER_A_IDENTITY_PDA, proposalPda, {
        proposal: voteGovernancePda,
      });
      try {
        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
          VOTER_A,
        ]);
        expect.fail("Should have failed with InvalidProposalAccount");
      } catch (err) {
        expectError(err, 6020); // EntrosVoterError::InvalidProposalAccount
      }
    });

    it("refuses a migrated wallet's vote update for a target that is no proposal", async () => {
      const ix = voteUpdate(VOTER_D, VOTER_D_IDENTITY_PDA, voteGovernancePda);
      try {
        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
          VOTER_D,
        ]);
        expect.fail("Should have failed with InvalidProposalAccount");
      } catch (err) {
        expectError(err, 6020); // EntrosVoterError::InvalidProposalAccount
      }
    });

    it("refuses a migrated wallet's vote update for a proposal that is not in voting", async () => {
      const draftPda = await createProposal("Draft proposal");
      const ix = voteUpdate(VOTER_D, VOTER_D_IDENTITY_PDA, draftPda);
      try {
        await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
          VOTER_D,
        ]);
        expect.fail("Should have failed with ProposalNotInVoting");
      } catch (err) {
        expectError(err, 6021); // EntrosVoterError::ProposalNotInVoting
      }
    });

    it("lets a wallet that received a migration create a proposal", async () => {
      // The vote rule covers votes alone. Every other action takes the identity
      // account and nothing else, for a migrated wallet too.
      const created = await createProposal(
        "Proposal by a migrated wallet",
        VOTER_E,
        VOTER_E_IDENTITY_PDA
      );
      expect(await connection.getAccountInfo(created)).to.not.equal(null);
    });

    it("reads lamports at a migration record address as no record", async () => {
      // Anyone can send lamports to a wallet's record address. That must not make
      // the wallet look migrated.
      const recordAddress = deriveMigrationRecordPda(VOTER_A.publicKey);
      await sendAndConfirmTransaction(
        connection,
        new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: payer.publicKey,
            toPubkey: recordAddress,
            lamports: LAMPORTS_PER_SOL / 100,
          })
        ),
        [payer]
      );
      const funded = await connection.getAccountInfo(recordAddress);
      expect(funded!.owner.toBase58()).to.equal(
        SystemProgram.programId.toBase58()
      );

      const ix = buildUpdateVoterWeightRecordInstruction(
        voteRegistrarPda,
        weightRecordOf(VOTER_A),
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA
      );
      await sendAndConfirmTransaction(connection, new Transaction().add(ix), [
        VOTER_A,
      ]);
      const account = await connection.getAccountInfo(weightRecordOf(VOTER_A));
      expect(account!.data.readBigUInt64LE(104)).to.equal(1n);
    });
  });
});
