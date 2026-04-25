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
  createInitializeMintInstruction,
  TOKEN_PROGRAM_ID,
  MINT_SIZE,
  getMinimumBalanceForRentExemptMint,
} from "@solana/spl-token";
import { expect } from "chai";
import {
  PLUGIN_PROGRAM_ID,
  IAM_ANCHOR_PROGRAM_ID,
  anchorDiscriminator,
  buildCreateRealmInstruction,
  buildCreateRegistrarInstruction,
  buildUpdateRegistrarInstruction,
  buildCreateVoterWeightRecordInstruction,
  buildUpdateVoterWeightRecordInstruction,
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

const connection = new Connection("http://localhost:8899", "confirmed");
let payer: Keypair;

// Shared state across happy path tests
let communityMint: PublicKey;
let realmPda: PublicKey;
let registrarPda: PublicKey;
let vwrPda: PublicKey;

const [VOTER_A_IDENTITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("identity"), VOTER_A.publicKey.toBuffer()],
  IAM_ANCHOR_PROGRAM_ID
);
const [VOTER_B_IDENTITY_PDA] = PublicKey.findProgramAddressSync(
  [Buffer.from("identity"), VOTER_B.publicKey.toBuffer()],
  IAM_ANCHOR_PROGRAM_ID
);

function expectError(err: any, errorCode: number): void {
  const hexCode = "0x" + errorCode.toString(16);
  const msg = err.message || "";
  const logs = err.logs || err.transactionLogs || [];
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

describe("entros-voter-weight integration", () => {
  before(async () => {
    payer = Keypair.generate();

    // Airdrop to payer and voters
    const sig1 = await connection.requestAirdrop(
      payer.publicKey,
      10 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig1);

    const sig2 = await connection.requestAirdrop(
      VOTER_A.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig2);

    const sig3 = await connection.requestAirdrop(
      VOTER_B.publicKey,
      2 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(sig3);

    // Verify fixture accounts are loaded
    const identityA = await connection.getAccountInfo(VOTER_A_IDENTITY_PDA);
    expect(identityA, "VOTER_A IdentityState fixture not loaded").to.not.be
      .null;
    expect(identityA!.owner.toBase58()).to.equal(
      IAM_ANCHOR_PROGRAM_ID.toBase58()
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

    it("updates voter weight record -> voter_weight=1", async () => {
      const ix = buildUpdateVoterWeightRecordInstruction(
        registrarPda,
        vwrPda,
        VOTER_A.publicKey,
        VOTER_A_IDENTITY_PDA
      );

      const tx = new Transaction().add(ix);
      await sendAndConfirmTransaction(connection, tx, [VOTER_A]);

      const account = await connection.getAccountInfo(vwrPda);
      const voterWeight = account!.data.readBigUInt64LE(104);
      expect(voterWeight).to.equal(1n);

      const expiryTag = account!.data.readUInt8(112);
      expect(expiryTag).to.equal(1);
      const expiryValue = account!.data.readBigUInt64LE(113);
      expect(expiryValue > 0n).to.be.true;
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
      const sig = await connection.requestAirdrop(
        wrongAuthority.publicKey,
        LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig);

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
      } catch (err: any) {
        expectError(err, 6000); // InvalidRealmAuthority
      }
    });
  });

  describe("update_voter_weight_record failures", () => {
    let failRealmPda: PublicKey;
    let failRegistrarPda: PublicKey;
    let failVwrA: PublicKey;
    let failVwrB: PublicKey;
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
      await sendAndConfirmTransaction(connection, vwrBTx, [payer]);
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
      } catch (err: any) {
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
      } catch (err: any) {
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
      } catch (err: any) {
        expectError(err, 6003); // InvalidIdentityOwner
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
      } catch (err: any) {
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
      } catch (err: any) {
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
      } catch (err: any) {
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
      const sig = await connection.requestAirdrop(
        wrongAuth.publicKey,
        LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig);

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
      } catch (err: any) {
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
      const sig = await connection.requestAirdrop(
        wrongAuth.publicKey,
        LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig);

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
      } catch (err: any) {
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
      const sig = await connection.requestAirdrop(
        wrongAuth.publicKey,
        LAMPORTS_PER_SOL
      );
      await connection.confirmTransaction(sig);

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
      } catch (err: any) {
        expectError(err, 6000); // InvalidRealmAuthority
      }
    });
  });
});
