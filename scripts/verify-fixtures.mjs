import { createHash } from "node:crypto";
import {
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "..");
const lockPath = join(repositoryRoot, "fixture-lock.json");
const lock = JSON.parse(readFileSync(lockPath, "utf8"));

if (lock.schemaVersion !== 1 || typeof lock.files !== "object" || lock.files === null) {
  throw new Error("fixture-lock.json has an unsupported format");
}

function sha256(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

for (const [relativePath, expectedHash] of Object.entries(lock.files)) {
  const actualHash = sha256(join(repositoryRoot, relativePath));
  if (actualHash !== expectedHash) {
    throw new Error(`${relativePath} does not match fixture-lock.json`);
  }
}

const temporaryPrefix = "entros-governance-fixtures-";
const temporaryDirectory = mkdtempSync(join(tmpdir(), temporaryPrefix));

try {
  execFileSync(
    process.execPath,
    [
      "--import",
      "tsx",
      join(scriptDirectory, "generate-test-fixtures.ts"),
      "--output-dir",
      temporaryDirectory,
    ],
    {
      cwd: repositoryRoot,
      stdio: "pipe",
    },
  );

  for (const filename of [
    "identity-state-a.json",
    "identity-state-b.json",
    "identity-state-c.json",
  ]) {
    const committed = readFileSync(join(repositoryRoot, "tests/fixtures", filename));
    const generated = readFileSync(join(temporaryDirectory, filename));
    if (!committed.equals(generated)) {
      throw new Error(`${filename} is not reproducible`);
    }
  }

  const fundedWallets = [
    ["voter-a-wallet.json", "4LUBgwDTumszi3yRFhiXoaXswUzPB3FdbEmZNpanVidL", 1_000_000_000_000],
    ["voter-b-wallet.json", "7MQwaHdSqa2gBJuvH6VrsFMPtogDMkvnbovTbWd7u375", 10_000_000_000],
    ["voter-c-wallet.json", "GHscGvrXbPnNuh71gbqsDQvJ5QUbdDYKim3DfAKPcWUH", 10_000_000_000],
  ];

  for (const [filename, pubkey, lamports] of fundedWallets) {
    const fundedWallet = JSON.parse(
      readFileSync(join(temporaryDirectory, filename), "utf8"),
    );
    if (
      fundedWallet.pubkey !== pubkey
      || fundedWallet.account.lamports !== lamports
      || fundedWallet.account.owner !== "11111111111111111111111111111111"
      || fundedWallet.account.data[0] !== ""
      || fundedWallet.account.data[1] !== "base64"
      || fundedWallet.account.executable !== false
      || fundedWallet.account.space !== 0
    ) {
      throw new Error(`${filename} is invalid`);
    }
  }
} finally {
  if (
    dirname(temporaryDirectory) !== tmpdir()
    || !basename(temporaryDirectory).startsWith(temporaryPrefix)
  ) {
    throw new Error("Refusing to remove an unexpected fixture directory");
  }
  rmSync(temporaryDirectory, { recursive: true });
}

console.log("Fixture hashes and generated account bytes match.");
