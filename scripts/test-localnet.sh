#!/usr/bin/env bash

set -euo pipefail

readonly PLUGIN_PROGRAM_ID="99nwXzcugse3x8kxE9v6mxZiq8T9gHDoznaaG6qcw534"
readonly ENTROS_ANCHOR_PROGRAM_ID="GZYwTp2ozeuRA5Gof9vs4ya961aANcJBdUzB7LN6q4b2"
readonly GOVERNANCE_PROGRAM_ID="GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw"
readonly IDENTITY_A="63cKuvoe9WuNH9Ds6aXF7iSc4jHmJc4ZkxdHTaitJ5tr"
readonly IDENTITY_B="73gAPp8WuNzdHh4E5ySQNFR3jpw8qs5YFaYPp8iyt6FZ"
readonly IDENTITY_C="6VdajMuuCa29fiXNysyyjkFCbuhFJHHhpWXSvyZW9JnP"
readonly LOCAL_PAYER="4LUBgwDTumszi3yRFhiXoaXswUzPB3FdbEmZNpanVidL"
readonly VOTER_B="7MQwaHdSqa2gBJuvH6VrsFMPtogDMkvnbovTbWd7u375"
readonly VOTER_C="GHscGvrXbPnNuh71gbqsDQvJ5QUbdDYKim3DfAKPcWUH"
readonly RPC_URL="http://127.0.0.1:8899"

SCRIPT_DIRECTORY="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
readonly SCRIPT_DIRECTORY
REPOSITORY_ROOT="$(cd -- "$SCRIPT_DIRECTORY/.." && pwd)"
readonly REPOSITORY_ROOT
readonly TEMPORARY_BASE="${RUNNER_TEMP:-${TMPDIR:-/tmp}}"

case "$TEMPORARY_BASE" in
  /*) ;;
  *)
    echo "Temporary directory base must be an absolute path." >&2
    exit 1
    ;;
esac

for command_name in node npm solana solana-test-validator; do
  if ! command -v "$command_name" >/dev/null 2>&1; then
    echo "Required command is unavailable: $command_name" >&2
    exit 1
  fi
done

readonly PLUGIN_BINARY="$REPOSITORY_ROOT/target/deploy/entros_voter_weight.so"
readonly ENTROS_ANCHOR_BINARY="$REPOSITORY_ROOT/tests/fixtures/entros_anchor.so"
readonly GOVERNANCE_BINARY="$REPOSITORY_ROOT/tests/fixtures/spl_governance.so"
readonly IDENTITY_A_FIXTURE="$REPOSITORY_ROOT/tests/fixtures/identity-state-a.json"
readonly IDENTITY_B_FIXTURE="$REPOSITORY_ROOT/tests/fixtures/identity-state-b.json"
readonly IDENTITY_C_FIXTURE="$REPOSITORY_ROOT/tests/fixtures/identity-state-c.json"

for required_file in \
  "$PLUGIN_BINARY" \
  "$ENTROS_ANCHOR_BINARY" \
  "$GOVERNANCE_BINARY" \
  "$IDENTITY_A_FIXTURE" \
  "$IDENTITY_B_FIXTURE" \
  "$IDENTITY_C_FIXTURE"; do
  if [[ ! -f "$required_file" ]]; then
    echo "Required test input is unavailable: $required_file" >&2
    exit 1
  fi
done

port_is_open() {
  node -e '
    const net = require("node:net");
    const socket = net.createConnection({ host: "127.0.0.1", port: Number(process.argv[1]) });
    const timer = setTimeout(() => { socket.destroy(); process.exit(1); }, 500);
    socket.once("connect", () => { clearTimeout(timer); socket.destroy(); process.exit(0); });
    socket.once("error", () => { clearTimeout(timer); process.exit(1); });
  ' "$1"
}

for port in 8899 8900 9900; do
  if port_is_open "$port"; then
    echo "Local test port $port is already in use. No process was changed." >&2
    exit 1
  fi
done

RUN_DIRECTORY="$(mktemp -d "$TEMPORARY_BASE/entros-governance.XXXXXX")"
readonly RUN_DIRECTORY
readonly LEDGER_DIRECTORY="$RUN_DIRECTORY/ledger"
readonly VALIDATOR_LOG="$RUN_DIRECTORY/validator.log"
readonly GENERATED_FIXTURE_DIRECTORY="$RUN_DIRECTORY/fixtures"
readonly LOCAL_PAYER_FIXTURE="$GENERATED_FIXTURE_DIRECTORY/voter-a-wallet.json"
readonly VOTER_B_WALLET_FIXTURE="$GENERATED_FIXTURE_DIRECTORY/voter-b-wallet.json"
readonly VOTER_C_WALLET_FIXTURE="$GENERATED_FIXTURE_DIRECTORY/voter-c-wallet.json"
VALIDATOR_PID=""

cleanup() {
  local status=$?
  local listener_open=false
  trap - EXIT

  if [[ "$VALIDATOR_PID" =~ ^[0-9]+$ ]] && kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    kill "$VALIDATOR_PID" 2>/dev/null || true
    wait "$VALIDATOR_PID" 2>/dev/null || true
  fi

  for _ in $(seq 1 50); do
    listener_open=false
    for port in 8899 8900 9900; do
      if port_is_open "$port"; then
        listener_open=true
        break
      fi
    done

    if [[ "$listener_open" == false ]]; then
      break
    fi
    sleep 0.1
  done

  if [[ "$listener_open" == true ]]; then
    echo "Local validator ports did not close." >&2
    status=1
  fi

  case "$RUN_DIRECTORY" in
    "$TEMPORARY_BASE"/entros-governance.*)
      rm -r -- "$RUN_DIRECTORY"
      ;;
    *)
      echo "Refusing to remove an unexpected test directory." >&2
      status=1
      ;;
  esac

  exit "$status"
}

trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

cd "$REPOSITORY_ROOT"
npm run fixtures:generate -- --output-dir "$GENERATED_FIXTURE_DIRECTORY" >/dev/null
for generated_file in \
  "$LOCAL_PAYER_FIXTURE" \
  "$VOTER_B_WALLET_FIXTURE" \
  "$VOTER_C_WALLET_FIXTURE"; do
  if [[ ! -f "$generated_file" ]]; then
    echo "Local wallet fixture was not generated: $generated_file" >&2
    exit 1
  fi
done

solana-test-validator \
  --bind-address 127.0.0.1 \
  --rpc-port 8899 \
  --faucet-port 9900 \
  --ledger "$LEDGER_DIRECTORY" \
  --bpf-program "$PLUGIN_PROGRAM_ID" "$PLUGIN_BINARY" \
  --bpf-program "$ENTROS_ANCHOR_PROGRAM_ID" "$ENTROS_ANCHOR_BINARY" \
  --bpf-program "$GOVERNANCE_PROGRAM_ID" "$GOVERNANCE_BINARY" \
  --account "$IDENTITY_A" "$IDENTITY_A_FIXTURE" \
  --account "$IDENTITY_B" "$IDENTITY_B_FIXTURE" \
  --account "$IDENTITY_C" "$IDENTITY_C_FIXTURE" \
  --account "$LOCAL_PAYER" "$LOCAL_PAYER_FIXTURE" \
  --account "$VOTER_B" "$VOTER_B_WALLET_FIXTURE" \
  --account "$VOTER_C" "$VOTER_C_WALLET_FIXTURE" \
  >"$VALIDATOR_LOG" 2>&1 &
VALIDATOR_PID=$!

validator_ready=false
for _ in $(seq 1 60); do
  if node -e '
    const { Connection, PublicKey } = require("@solana/web3.js");
    const connection = new Connection(process.argv[1], "confirmed");
    connection.getBalance(new PublicKey(process.argv[2]))
      .then((balance) => process.exit(balance === 1_000_000_000_000 ? 0 : 1))
      .catch(() => process.exit(1));
  ' "$RPC_URL" "$LOCAL_PAYER"; then
    validator_ready=true
    break
  fi

  if ! kill -0 "$VALIDATOR_PID" 2>/dev/null; then
    break
  fi

  sleep 1
done

if [[ "$validator_ready" != true ]]; then
  echo "Local validator did not become ready." >&2
  tail -n 80 "$VALIDATOR_LOG" >&2
  exit 1
fi

if ! npm test; then
  echo "Local validator log tail:" >&2
  tail -n 120 "$VALIDATOR_LOG" >&2
  exit 1
fi

echo "Localnet test suite passed."
