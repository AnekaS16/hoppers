import hashlib
import json
import requests


BLOCKCHAIN_API_URL = "http://localhost:3000/register-proof"


def create_proof_hash(record):
    """
    Create a deterministic SHA-256 fingerprint of a DaanDristi
    accepted donation record.
    """

    canonical_data = json.dumps(
        record,
        sort_keys=True,
        separators=(",", ":")
    )

    proof_hash = "0x" + hashlib.sha256(
        canonical_data.encode("utf-8")
    ).hexdigest()

    return proof_hash


def register_blockchain_proof(record):
    """
    Send an accepted DaanDristi record to the blockchain API.

    Returns the blockchain response, or None if registration fails.
    """

    # Blockchain should only receive ACCEPT events.
    if record.get("decision") != "ACCEPT":
        print("Blockchain: skipped because decision is not ACCEPT.")
        return None

    proof_hash = create_proof_hash(record)

    print()
    print("=== BLOCKCHAIN REGISTRATION ===")
    print("Proof hash:", proof_hash)
    print("Source ID:", record.get("pocket_id"))

    try:
        response = requests.post(
            BLOCKCHAIN_API_URL,
            json={
                "proofHash": proof_hash,
                "sourceId": record.get("pocket_id", "unknown")
            },
            timeout=30
        )

        response.raise_for_status()

        result = response.json()

        print("Blockchain: proof registered successfully.")
        print("Transaction:", result.get("transactionHash"))
        print("Block:", result.get("blockNumber"))

        return {
            "proof_hash": proof_hash,
            "transaction_hash": result.get("transactionHash"),
            "block_number": result.get("blockNumber"),
            "source_id": record.get("pocket_id")
        }

    except requests.RequestException as error:
        print(f"Blockchain warning: registration failed ({error})")
        print("ML record remains safe in JSONL/SQLite.")
        return None