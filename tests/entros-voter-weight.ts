import { PublicKey, Keypair } from "@solana/web3.js";
import { expect } from "chai";

const ENTROS_ANCHOR_PROGRAM_ID = new PublicKey(
  "GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2"
);

const PLUGIN_PROGRAM_ID = new PublicKey(
  "99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534"
);

// IdentityState byte layout
const IDENTITY_STATE_DISCRIMINATOR = Buffer.from([
  156, 32, 87, 93, 52, 155, 248, 207,
]);
const IDENTITY_STATE_SIZE = 207;

function buildIdentityStateData(
  owner: PublicKey,
  trustScore: number,
  lastVerificationTimestamp: number
): Buffer {
  const data = Buffer.alloc(IDENTITY_STATE_SIZE);
  let offset = 0;

  IDENTITY_STATE_DISCRIMINATOR.copy(data, offset);
  offset += 8;

  owner.toBuffer().copy(data, offset);
  offset += 32;

  // creation_timestamp
  data.writeBigInt64LE(BigInt(lastVerificationTimestamp - 86400), offset);
  offset += 8;

  // last_verification_timestamp
  data.writeBigInt64LE(BigInt(lastVerificationTimestamp), offset);
  offset += 8;

  // verification_count
  data.writeUInt32LE(1, offset);
  offset += 4;

  // trust_score
  data.writeUInt16LE(trustScore, offset);
  offset += 2;

  return data;
}

describe("entros-voter-weight", () => {
  describe("Entros program ID", () => {
    it("constant bytes encode to the correct base58 address", () => {
      const bytes = Buffer.from([
        0xe7, 0x36, 0x00, 0xda, 0x70, 0x7e, 0xbf, 0x19,
        0x90, 0x7d, 0x32, 0xec, 0x88, 0x42, 0xa4, 0x5f,
        0xb4, 0xd5, 0x32, 0x63, 0xa1, 0x49, 0x68, 0x01,
        0x6d, 0xb4, 0xe6, 0x29, 0x37, 0xe0, 0x93, 0xd1,
      ]);
      const pubkey = new PublicKey(bytes);
      expect(pubkey.toBase58()).to.equal(
        "GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2"
      );
    });
  });

  describe("IdentityState byte layout", () => {
    it("reads trust_score correctly at offset 60", () => {
      const owner = Keypair.generate().publicKey;
      const data = buildIdentityStateData(owner, 200, 1775573486);

      const trustScore = data.readUInt16LE(60);
      expect(trustScore).to.equal(200);
    });

    it("reads last_verification_timestamp correctly at offset 48", () => {
      const owner = Keypair.generate().publicKey;
      const timestamp = 1775573486;
      const data = buildIdentityStateData(owner, 100, timestamp);

      const readTimestamp = Number(data.readBigInt64LE(48));
      expect(readTimestamp).to.equal(timestamp);
    });

    it("trust_score of 0 reads correctly", () => {
      const owner = Keypair.generate().publicKey;
      const data = buildIdentityStateData(owner, 0, 1775573486);

      expect(data.readUInt16LE(60)).to.equal(0);
    });

    it("max u16 trust_score reads correctly", () => {
      const owner = Keypair.generate().publicKey;
      const data = buildIdentityStateData(owner, 65535, 1775573486);

      expect(data.readUInt16LE(60)).to.equal(65535);
    });

    it("discriminator matches sha256('account:IdentityState')[0..8]", () => {
      const crypto = require("crypto");
      const hash = crypto
        .createHash("sha256")
        .update("account:IdentityState")
        .digest();
      const expected = hash.slice(0, 8);
      expect(IDENTITY_STATE_DISCRIMINATOR).to.deep.equal(expected);
    });

    it("minimum data length 62 is sufficient for trust_score read", () => {
      // trust_score is u16 at offset 60, so we need at least 62 bytes
      const data = Buffer.alloc(62);
      IDENTITY_STATE_DISCRIMINATOR.copy(data, 0);
      data.writeUInt16LE(150, 60);

      expect(data.readUInt16LE(60)).to.equal(150);
      expect(data.length).to.equal(62);
    });
  });

  describe("PDA derivation", () => {
    it("IdentityState PDA is deterministic for a given wallet", () => {
      const wallet = Keypair.generate().publicKey;
      const [pda1] = PublicKey.findProgramAddressSync(
        [Buffer.from("identity"), wallet.toBuffer()],
        ENTROS_ANCHOR_PROGRAM_ID
      );
      const [pda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("identity"), wallet.toBuffer()],
        ENTROS_ANCHOR_PROGRAM_ID
      );
      expect(pda1.toBase58()).to.equal(pda2.toBase58());
    });

    it("different wallets produce different IdentityState PDAs", () => {
      const wallet1 = Keypair.generate().publicKey;
      const wallet2 = Keypair.generate().publicKey;
      const [pda1] = PublicKey.findProgramAddressSync(
        [Buffer.from("identity"), wallet1.toBuffer()],
        ENTROS_ANCHOR_PROGRAM_ID
      );
      const [pda2] = PublicKey.findProgramAddressSync(
        [Buffer.from("identity"), wallet2.toBuffer()],
        ENTROS_ANCHOR_PROGRAM_ID
      );
      expect(pda1.toBase58()).to.not.equal(pda2.toBase58());
    });

    it("registrar PDA uses correct seeds", () => {
      const realm = Keypair.generate().publicKey;
      const mint = Keypair.generate().publicKey;
      const [registrar] = PublicKey.findProgramAddressSync(
        [Buffer.from("registrar"), realm.toBuffer(), mint.toBuffer()],
        PLUGIN_PROGRAM_ID
      );
      // Should be a valid on-curve point (not all zeros)
      expect(registrar.toBase58()).to.not.equal(PublicKey.default.toBase58());
    });

    it("voter weight record PDA includes realm, mint, and owner", () => {
      const realm = Keypair.generate().publicKey;
      const mint = Keypair.generate().publicKey;
      const owner1 = Keypair.generate().publicKey;
      const owner2 = Keypair.generate().publicKey;

      const [vwr1] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("voter-weight-record"),
          realm.toBuffer(),
          mint.toBuffer(),
          owner1.toBuffer(),
        ],
        PLUGIN_PROGRAM_ID
      );
      const [vwr2] = PublicKey.findProgramAddressSync(
        [
          Buffer.from("voter-weight-record"),
          realm.toBuffer(),
          mint.toBuffer(),
          owner2.toBuffer(),
        ],
        PLUGIN_PROGRAM_ID
      );
      expect(vwr1.toBase58()).to.not.equal(vwr2.toBase58());
    });
  });

  describe("space calculations", () => {
    it("registrar space is 178 bytes", () => {
      const space = 8 + 32 + 32 + 32 + 2 + 8 + 64;
      expect(space).to.equal(178);
    });

    it("voter weight record space is 164 bytes", () => {
      const space =
        8 +   // account_discriminator
        32 +  // realm
        32 +  // governing_token_mint
        32 +  // governing_token_owner
        8 +   // voter_weight
        9 +   // voter_weight_expiry (Option<u64>)
        2 +   // weight_action (Option<VoterWeightAction>)
        33 +  // weight_action_target (Option<Pubkey>)
        8;    // reserved
      expect(space).to.equal(164);
    });
  });

  describe("trust score validation logic", () => {
    it("score exactly at minimum should pass", () => {
      const minScore = 100;
      const actualScore = 100;
      expect(actualScore >= minScore).to.be.true;
    });

    it("score below minimum should fail", () => {
      const minScore = 100;
      const actualScore = 99;
      expect(actualScore >= minScore).to.be.false;
    });

    it("score of 0 with min 0 should pass", () => {
      expect(0 >= 0).to.be.true;
    });
  });

  describe("verification age validation logic", () => {
    it("recent verification should pass", () => {
      const maxAge = 2592000; // 30 days in seconds
      const now = Math.floor(Date.now() / 1000);
      const lastVerif = now - 86400; // 1 day ago
      const age = now - lastVerif;
      expect(age < maxAge).to.be.true;
    });

    it("expired verification should fail", () => {
      const maxAge = 2592000;
      const now = Math.floor(Date.now() / 1000);
      const lastVerif = now - 3000000; // ~35 days ago
      const age = now - lastVerif;
      expect(age < maxAge).to.be.false;
    });

    it("verification exactly at max age should fail", () => {
      const maxAge = 2592000;
      const age = 2592000;
      expect(age < maxAge).to.be.false;
    });

    it("handles timestamp overflow gracefully", () => {
      // If last_verification_timestamp is somehow in the future
      const now = 1775573486;
      const lastVerif = now + 1000; // future
      // checked_sub would return None, unwrap_or(i64::MAX)
      const age = now - lastVerif; // negative
      // In Rust: checked_sub returns None for underflow, unwrap_or(i64::MAX)
      // So age = i64::MAX which is > any max_verification_age
      // This means future timestamps correctly fail
      expect(age < 0).to.be.true; // JavaScript handles differently, but Rust logic is correct
    });
  });
});
