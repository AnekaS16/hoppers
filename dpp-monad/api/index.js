require("dotenv").config();

const express = require("express");
const { ethers } = require("ethers");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const app = express();

app.use(express.json());


// ======================================================
// CONFIGURATION
// ======================================================

const RPC_URL = process.env.RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

const ML_LOG_FILE =
  "D:\\DaanDristi-Monad_folder\\Monad_hackathon\\logs\\inference.jsonl";


// ======================================================
// ORIGINAL RECORD REGISTRY
// ======================================================
//
// This file is automatically maintained by the API.
//
// It stores the ORIGINAL accepted record at the moment
// it is successfully registered on Monad.
//
// We NEVER manually edit this file.
//

const DATA_DIR = path.join(__dirname, "data");

const ORIGINAL_RECORDS_FILE =
  path.join(DATA_DIR, "original_records.json");


// Create data directory if it does not exist
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}


// Create registry file if it does not exist
if (!fs.existsSync(ORIGINAL_RECORDS_FILE)) {
  fs.writeFileSync(
    ORIGINAL_RECORDS_FILE,
    JSON.stringify([], null, 2),
    "utf8"
  );
}


// ======================================================
// SMART CONTRACT ABI
// ======================================================

const CONTRACT_ABI = [

  "function registerProof(bytes32 _proofHash, string calldata _sourceId) external",

  "function verifyProof(bytes32 _proofHash) external view returns (bool exists, string memory sourceId, uint256 timestamp, address registeredBy)"

];


// ======================================================
// BLOCKCHAIN CONNECTION
// ======================================================

const provider =
  new ethers.JsonRpcProvider(RPC_URL);

const wallet =
  new ethers.Wallet(
    PRIVATE_KEY,
    provider
  );

const contract =
  new ethers.Contract(
    CONTRACT_ADDRESS,
    CONTRACT_ABI,
    wallet
  );


// ======================================================
// CORS
// ======================================================

app.use((req, res, next) => {

  res.header(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,OPTIONS"
  );

  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  next();

});


// ======================================================
// CREATE EXACT SAME HASH AS ML
// ======================================================

function createProofHash(record) {

  const canonicalData =
    JSON.stringify(
      Object.keys(record)
        .sort()
        .reduce((obj, key) => {

          obj[key] = record[key];

          return obj;

        }, {})
    );

  return (
    "0x" +
    crypto
      .createHash("sha256")
      .update(
        canonicalData,
        "utf8"
      )
      .digest("hex")
  );

}


// ======================================================
// READ ALL ML RECORDS
// ======================================================

function getAllMLRecords() {

  if (!fs.existsSync(ML_LOG_FILE)) {

    throw new Error(
      `ML log file not found: ${ML_LOG_FILE}`
    );

  }

  const content =
    fs.readFileSync(
      ML_LOG_FILE,
      "utf8"
    );

  const lines =
    content
      .split(/\r?\n/)
      .filter(
        line => line.trim() !== ""
      );

  const records = [];

  for (let i = 0; i < lines.length; i++) {

    try {

      const record =
        JSON.parse(lines[i]);

      records.push({

        lineNumber: i + 1,

        record

      });

    } catch (error) {

      console.warn(
        `Skipping invalid JSON at line ${i + 1}`
      );

    }

  }

  return records;

}


// ======================================================
// READ LATEST ML RECORD
// ======================================================

function getLatestMLRecord() {

  const records =
    getAllMLRecords();

  if (records.length === 0) {

    throw new Error(
      "ML log file is empty"
    );

  }

  return records[
    records.length - 1
  ].record;

}


// ======================================================
// ORIGINAL RECORD REGISTRY FUNCTIONS
// ======================================================

function readOriginalRecords() {

  try {

    if (!fs.existsSync(ORIGINAL_RECORDS_FILE)) {
      return [];
    }

    const content =
      fs.readFileSync(
        ORIGINAL_RECORDS_FILE,
        "utf8"
      );

    if (!content.trim()) {
      return [];
    }

    const records =
      JSON.parse(content);

    if (!Array.isArray(records)) {
      return [];
    }

    return records;

  } catch (error) {

    console.error(
      "Error reading original records:",
      error.message
    );

    return [];

  }

}


function writeOriginalRecords(records) {

  fs.writeFileSync(
    ORIGINAL_RECORDS_FILE,
    JSON.stringify(
      records,
      null,
      2
    ),
    "utf8"
  );

}


// ======================================================
// CREATE STABLE RECORD ID
// ======================================================
//
// The hash changes if the record is tampered with.
//
// Therefore we CANNOT use the hash as the identity
// when detecting tampering.
//
// Instead we use:
// sourceId + original timestamp
//
// Example:
// webcam-0|2026-10-07T04:05:25.210977+00:00
//

function createRecordId(record) {

  return `${record.pocket_id || "unknown"}|${record.timestamp || "unknown"}`;

}


// ======================================================
// FIND RECORD BY PROOF HASH
// ======================================================

function findMLRecordByHash(proofHash) {

  const allRecords =
    getAllMLRecords();

  for (const item of allRecords) {

    if (
      item.record.decision !== "ACCEPT"
    ) {
      continue;
    }

    const calculatedHash =
      createProofHash(
        item.record
      );

    if (
      calculatedHash.toLowerCase() ===
      proofHash.toLowerCase()
    ) {

      return item.record;

    }

  }

  return null;

}


// ======================================================
// SAVE ORIGINAL RECORD
// ======================================================

function saveOriginalRecord(record, proofHash, blockchainInfo) {

  const records =
    readOriginalRecords();

  const recordId =
    createRecordId(record);

  // Prevent duplicate snapshots
  const existingIndex =
    records.findIndex(
      item =>
        item.recordId === recordId
    );

  const snapshot = {

    recordId,

    proofHash,

    sourceId:
      record.pocket_id || "unknown",

    originalDenomination:
      record.predicted_denomination || null,

    originalBin:
      record.target_bin || null,

    originalRecord:
      record,

    registeredAt:
      new Date().toISOString(),

    transactionHash:
      blockchainInfo?.transactionHash || null,

    blockNumber:
      blockchainInfo?.blockNumber || null

  };


  if (existingIndex >= 0) {

    // Never replace an existing original
    console.log(
      "Original snapshot already exists:",
      recordId
    );

    return records[existingIndex];

  }


  records.push(snapshot);

  writeOriginalRecords(records);

  console.log();
  console.log(
    "=== ORIGINAL RECORD SAVED ==="
  );

  console.log(
    "Record ID:",
    recordId
  );

  console.log(
    "Original denomination:",
    snapshot.originalDenomination
  );

  console.log(
    "Original bin:",
    snapshot.originalBin
  );

  console.log(
    "Original proof hash:",
    proofHash
  );

  return snapshot;

}


// ======================================================
// FIND ORIGINAL SNAPSHOT
// ======================================================

function findOriginalSnapshot(record) {

  const records =
    readOriginalRecords();

  const recordId =
    createRecordId(record);

  return (
    records.find(
      item =>
        item.recordId === recordId
    ) || null
  );

}


// ======================================================
// FIND TRANSACTION FOR PROOF
// ======================================================

async function findProofTransaction(
  proofHash
) {

  try {

    const latestBlock =
      await provider.getBlockNumber();

    const fromBlock =
      Math.max(
        0,
        latestBlock - 200000
      );

    const eventTopic =
      ethers.id(
        "ProofRegistered(bytes32,string,uint256,address)"
      );

    const logs =
      await provider.getLogs({

        address:
          CONTRACT_ADDRESS,

        topics: [
          eventTopic,
          proofHash
        ],

        fromBlock,

        toBlock:
          latestBlock

      });

    if (logs.length === 0) {

      return null;

    }

    const latestMatchingLog =
      logs[logs.length - 1];

    return {

      transactionHash:
        latestMatchingLog.transactionHash,

      blockNumber:
        latestMatchingLog.blockNumber,

      explorerUrl:
        `https://testnet.monadexplorer.com/tx/${latestMatchingLog.transactionHash}`

    };

  } catch (error) {

    console.error(
      "Transaction lookup error:",
      error.message
    );

    return null;

  }

}


// ======================================================
// HOME
// ======================================================

app.get("/", (req, res) => {

  res.json({

    service:
      "DaanDristi Blockchain API",

    status:
      "running",

    originalRegistry:
      ORIGINAL_RECORDS_FILE

  });

});


// ======================================================
// REGISTER BLOCKCHAIN PROOF
// ======================================================

app.post(
  "/register-proof",
  async (req, res) => {

    try {

      const {
        proofHash,
        sourceId
      } = req.body;


      if (
        !proofHash ||
        !sourceId
      ) {

        return res.status(400).json({

          success:
            false,

          error:
            "proofHash and sourceId are required"

        });

      }


      console.log();

      console.log(
        "=========================================="
      );

      console.log(
        "REGISTERING BLOCKCHAIN PROOF"
      );

      console.log(
        "=========================================="
      );

      console.log(
        "Proof Hash:",
        proofHash
      );

      console.log(
        "Source ID:",
        sourceId
      );


      // ------------------------------------------------
      // Find the exact ML record corresponding to hash
      // ------------------------------------------------

      const originalRecord =
        findMLRecordByHash(
          proofHash
        );


      if (!originalRecord) {

        console.warn(
          "WARNING: Could not find matching ML record."
        );

        console.warn(
          "Blockchain registration will continue."
        );

      }


      // ------------------------------------------------
      // Send transaction to Monad
      // ------------------------------------------------

      const tx =
        await contract.registerProof(
          proofHash,
          sourceId
        );

      console.log(
        "Transaction sent:",
        tx.hash
      );


      // ------------------------------------------------
      // Wait for confirmation
      // ------------------------------------------------

      const receipt =
        await tx.wait();

      console.log(
        "Transaction confirmed!"
      );

      console.log(
        "Block:",
        receipt.blockNumber
      );


      const explorerUrl =
        `https://testnet.monadexplorer.com/tx/${tx.hash}`;


      // ------------------------------------------------
      // AUTOMATICALLY SAVE ORIGINAL SNAPSHOT
      // ------------------------------------------------

      if (originalRecord) {

        saveOriginalRecord(
          originalRecord,
          proofHash,
          {
            transactionHash:
              tx.hash,

            blockNumber:
              receipt.blockNumber
          }
        );

      }


      res.json({

        success:
          true,

        transactionHash:
          tx.hash,

        blockNumber:
          receipt.blockNumber,

        explorerUrl,

        proofHash,

        sourceId

      });


    } catch (error) {

      console.error(
        "Blockchain registration error:",
        error
      );

      res.status(500).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);


// ======================================================
// VERIFY BLOCKCHAIN PROOF
// ======================================================

app.get(
  "/verify-proof/:hash",
  async (req, res) => {

    try {

      const proofHash =
        req.params.hash;


      if (!proofHash) {

        return res.status(400).json({

          success:
            false,

          error:
            "Proof hash is required"

        });

      }


      console.log();

      console.log(
        "=== VERIFYING BLOCKCHAIN PROOF ==="
      );

      console.log(
        "Proof Hash:",
        proofHash
      );


      const result =
        await contract.verifyProof(
          proofHash
        );


      let transactionInfo =
        null;


      if (result[0]) {

        transactionInfo =
          await findProofTransaction(
            proofHash
          );

      }


      res.json({

        success:
          true,

        exists:
          result[0],

        sourceId:
          result[1],

        timestamp:
          result[2].toString(),

        registeredBy:
          result[3],

        transactionHash:
          transactionInfo?.transactionHash ||
          null,

        blockNumber:
          transactionInfo?.blockNumber ||
          null,

        explorerUrl:
          transactionInfo?.explorerUrl ||
          null

      });


    } catch (error) {

      console.error(
        "Blockchain verification error:",
        error
      );

      res.status(500).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);


// ======================================================
// GET LATEST ML RECORD
// ======================================================

app.get(
  "/latest-record",
  async (req, res) => {

    try {

      const record =
        getLatestMLRecord();


      if (
        record.decision !==
        "ACCEPT"
      ) {

        return res.json({

          success:
            true,

          record,

          blockchain: {

            exists:
              false,

            message:
              "Blockchain proof skipped because decision is not ACCEPT."

          }

        });

      }


      const proofHash =
        createProofHash(
          record
        );


      const blockchainResult =
        await contract.verifyProof(
          proofHash
        );


      let transactionInfo =
        null;


      if (
        blockchainResult[0]
      ) {

        transactionInfo =
          await findProofTransaction(
            proofHash
          );

      }


      const originalSnapshot =
        findOriginalSnapshot(
          record
        );


      let status;

      if (blockchainResult[0]) {

        status =
          "VERIFIED";

      } else if (originalSnapshot) {

        status =
          "TAMPERED";

      } else {

        status =
          "NOT_REGISTERED";

      }


      res.json({

        success:
          true,

        record,

        blockchain: {

          proofHash,

          exists:
            blockchainResult[0],

          status,

          sourceId:
            blockchainResult[1],

          timestamp:
            blockchainResult[2].toString(),

          registeredBy:
            blockchainResult[3],

          transactionHash:
            transactionInfo?.transactionHash ||
            null,

          blockNumber:
            transactionInfo?.blockNumber ||
            null,

          explorerUrl:
            transactionInfo?.explorerUrl ||
            null

        },

        original: originalSnapshot
          ? {

              denomination:
                originalSnapshot.originalDenomination,

              bin:
                originalSnapshot.originalBin,

              proofHash:
                originalSnapshot.proofHash

            }
          : null

      });


    } catch (error) {

      console.error(
        "Latest record error:",
        error
      );

      res.status(500).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);


// ======================================================
// ⭐ VERIFY ALL ACCEPTED RECORDS
// ======================================================

app.get(
  "/all-records",
  async (req, res) => {

    try {

      console.log();

      console.log(
        "=========================================="
      );

      console.log(
        "VERIFYING ALL DONATION RECORDS"
      );

      console.log(
        "=========================================="
      );


      const allRecords =
        getAllMLRecords();


      const results = [];


      for (
        const item of allRecords
      ) {

        const record =
          item.record;


        // Only ACCEPT records
        if (
          record.decision !==
          "ACCEPT"
        ) {

          continue;

        }


        // ----------------------------------------------
        // Calculate current hash
        // ----------------------------------------------

        const currentHash =
          createProofHash(
            record
          );


        // ----------------------------------------------
        // Ask Monad whether CURRENT hash exists
        // ----------------------------------------------

        const blockchainResult =
          await contract.verifyProof(
            currentHash
          );


        const exists =
          blockchainResult[0];


        // ----------------------------------------------
        // Find original snapshot
        // ----------------------------------------------

        const originalSnapshot =
          findOriginalSnapshot(
            record
          );


        // ----------------------------------------------
        // Determine status
        // ----------------------------------------------

        let status;

        if (exists) {

          status =
            "VERIFIED";

        } else if (originalSnapshot) {

          status =
            "TAMPERED";

        } else {

          status =
            "NOT_REGISTERED";

        }


        // ----------------------------------------------
        // Compare original/current values
        // ----------------------------------------------

        const currentDenomination =
          record.predicted_denomination ||
          null;

        const currentBin =
          record.target_bin ||
          null;


        const originalDenomination =
          originalSnapshot
            ?.originalDenomination ||
          null;

        const originalBin =
          originalSnapshot
            ?.originalBin ||
          null;


        let tamperDetails =
          null;


        if (
          status ===
          "TAMPERED"
        ) {

          const changes = [];


          if (
            originalDenomination !==
            currentDenomination
          ) {

            changes.push(
              `Denomination changed from ₹${originalDenomination} to ₹${currentDenomination}`
            );

          }


          if (
            originalBin !==
            currentBin
          ) {

            changes.push(
              `Bin changed from ${originalBin} to ${currentBin}`
            );

          }


          if (
            changes.length === 0
          ) {

            changes.push(
              "Record contents changed and the current hash no longer matches the blockchain proof."
            );

          }


          tamperDetails =
            changes.join(
              " | "
            );

        }


        // ----------------------------------------------
        // Build result
        // ----------------------------------------------

        results.push({

          recordNumber:
            item.lineNumber,

          record,

          status,

          exists,

          proofHash:
            currentHash,


          // Original information
          originalDenomination,

          originalBin,

          originalProofHash:
            originalSnapshot?.proofHash ||
            null,


          // Current information
          currentDenomination,

          currentBin,


          // Human-readable explanation
          tamperDetails,


          // Blockchain information
          sourceId:
            blockchainResult[1],

          timestamp:
            blockchainResult[2].toString(),

          registeredBy:
            blockchainResult[3],

          transactionHash:
            originalSnapshot?.transactionHash ||
            null,

          blockNumber:
            originalSnapshot?.blockNumber ||
            null,

          explorerUrl:
            originalSnapshot?.transactionHash
              ? `https://testnet.monadexplorer.com/tx/${originalSnapshot.transactionHash}`
              : null

        });

      }


      // =================================================
      // COUNTS
      // =================================================

      const verifiedRecords =
        results.filter(
          item =>
            item.status ===
            "VERIFIED"
        ).length;


      const tamperedRecords =
        results.filter(
          item =>
            item.status ===
            "TAMPERED"
        ).length;


      const notRegisteredRecords =
        results.filter(
          item =>
            item.status ===
            "NOT_REGISTERED"
        ).length;


      console.log(
        "Total:",
        results.length
      );

      console.log(
        "Verified:",
        verifiedRecords
      );

      console.log(
        "Tampered:",
        tamperedRecords
      );

      console.log(
        "Not registered:",
        notRegisteredRecords
      );


      res.json({

        success:
          true,

        totalRecords:
          results.length,

        verifiedRecords,

        tamperedRecords,

        notRegisteredRecords,

        records:
          results

      });


    } catch (error) {

      console.error(
        "All records verification error:",
        error
      );

      res.status(500).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);


// ======================================================
// ORIGINAL REGISTRY VIEW
// ======================================================
//
// Useful for debugging/demo.
// Shows what the API automatically preserved.
//

app.get(
  "/original-records",
  (req, res) => {

    try {

      const records =
        readOriginalRecords();

      res.json({

        success:
          true,

        count:
          records.length,

        records

      });

    } catch (error) {

      res.status(500).json({

        success:
          false,

        error:
          error.message

      });

    }

  }
);


// ======================================================
// START SERVER
// ======================================================

const PORT = 3000;

app.listen(
  PORT,
  () => {

    console.log();

    console.log(
      "=========================================="
    );

    console.log(
      "DaanDristi Blockchain API"
    );

    console.log(
      "=========================================="
    );

    console.log(
      `API running on http://localhost:${PORT}`
    );

    console.log(
      "Wallet:",
      wallet.address
    );

    console.log(
      "Contract:",
      CONTRACT_ADDRESS
    );

    console.log(
      "ML Log:",
      ML_LOG_FILE
    );

    console.log(
      "Original Registry:",
      ORIGINAL_RECORDS_FILE
    );

    console.log(
      "=========================================="
    );

    console.log();

  }
);