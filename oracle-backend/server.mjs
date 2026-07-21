/**
 * oracle-backend/server.mjs
 *
 * Oracle backend for demo real-estate escrow.
 * It listens to PropertyOracle events, checks the mock registry service,
 * creates transfer requests in the registry, and returns the final registry
 * result to the smart contract only after the buyer approves the request in
 * the separate registry frontend.
 */

import { ethers } from "ethers";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, ".env") });

const {
  RPC_URL = "http://127.0.0.1:8545",
  ORACLE_ADDRESS,
  MARKET_ADDRESS,
  FULFILLER_PRIVATE_KEY,
  REGISTRY_API_URL = "http://localhost:3002",
  PORT = "3001",
} = process.env;

if (!ORACLE_ADDRESS || !MARKET_ADDRESS || !FULFILLER_PRIVATE_KEY) {
  console.error("❌ Missing env: ORACLE_ADDRESS, MARKET_ADDRESS, FULFILLER_PRIVATE_KEY");
  process.exit(1);
}

const ORACLE_ABI = [
  "event VerificationRequest(uint256 indexed requestId, uint256 indexed dealId, address indexed dealContract, uint8 reqType, string cadastralNumber, string subjectAddress, string fullName)",
  "event RegistryTransferRequest(uint256 indexed requestId, uint256 indexed dealId, address indexed dealContract, string cadastralNumber, string sellerFullName, string buyerFullName, uint256 priceWei)",
  "function fulfilSellerVerification(uint256 requestId, bool success, string reason)",
  "function fulfilBuyerVerification(uint256 requestId, bool success, string reason)",
  "function fulfilRegistryTransfer(uint256 requestId, bool success, string newRegistryId)",
];

const MARKET_ABI = [
  "function getDealMain(uint256 dealId) view returns (uint256 id, address seller, address buyer, uint8 stage, uint256 price, uint256 escrowAmount, uint256 paymentDeadline, uint256 createdAt, uint256 completedAt)",
  "function getDealProperty(uint256 dealId) view returns (string cadastralNumber, string apartmentAddress, string registryRecordId, string newRegistryRecordId, string lastOracleError)",
  "function getDealParties(uint256 dealId) view returns (string sellerFullName, string buyerFullName)",
  "function getDealEscrow(uint256 dealId) view returns (uint256 escrowAmount, uint256 sellerEscrowConfirmedAt, uint256 registryRequestedAt, bytes32 registryProofHash)",
];

let config = {
  sellerVerificationDelay: 2000,
  buyerVerificationDelay: 2000,
  registryCreateDelay: 1000,
  sellerVerificationShouldFail: false,
  buyerVerificationShouldFail: false,
  registryShouldFail: false,
};

const provider = new ethers.JsonRpcProvider(RPC_URL);
const fulfiller = new ethers.Wallet(FULFILLER_PRIVATE_KEY, provider);
const oracleContract = new ethers.Contract(ORACLE_ADDRESS, ORACLE_ABI, fulfiller);
const marketContract = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, provider);

console.log(`🔮 Oracle backend starting...`);
console.log(`   Oracle contract:  ${ORACLE_ADDRESS}`);
console.log(`   Market contract:  ${MARKET_ADDRESS}`);
console.log(`   Registry API:      ${REGISTRY_API_URL}`);
console.log(`   Fulfiller:        ${fulfiller.address}`);
console.log(`   RPC:              ${RPC_URL}`);

const processedEvents = new Set();
const pendingRegistry = new Map();
const finishedRegistry = new Set();

const currentBlock = await provider.getBlockNumber();
let lastProcessedBlock = process.env.START_BLOCK ? Number(process.env.START_BLOCK) : currentBlock;
console.log("Start polling from block:", lastProcessedBlock);

async function registryFetch(pathname, options = {}) {
  const res = await fetch(`${REGISTRY_API_URL}${pathname}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Registry API error ${res.status}`);
  return data;
}

async function readDeal(dealId) {
  const [main, property, parties, escrow] = await Promise.all([
    marketContract.getDealMain(dealId),
    marketContract.getDealProperty(dealId),
    marketContract.getDealParties(dealId),
    marketContract.getDealEscrow(dealId),
  ]);

  return {
    id: main.id.toString(),
    seller: main.seller,
    buyer: main.buyer,
    stage: Number(main.stage),
    price: main.price,
    escrowAmount: escrow.escrowAmount,
    cadastralNumber: property.cadastralNumber,
    apartmentAddress: property.apartmentAddress,
    registryRecordId: property.registryRecordId,
    newRegistryRecordId: property.newRegistryRecordId,
    sellerFullName: parties.sellerFullName,
    buyerFullName: parties.buyerFullName,
  };
}

async function processOracleLogs() {
  try {
    const latestBlock = await provider.getBlockNumber();
    if (latestBlock <= lastProcessedBlock) return;

    const logs = await provider.getLogs({
      address: ORACLE_ADDRESS,
      fromBlock: lastProcessedBlock + 1,
      toBlock: latestBlock,
    });

    lastProcessedBlock = latestBlock;

    for (const log of logs) {
      let parsed;
      try {
        parsed = oracleContract.interface.parseLog(log);
      } catch {
        continue;
      }
      if (!parsed) continue;

      const uniqueEventKey = `${log.transactionHash}:${log.index}`;
      if (processedEvents.has(uniqueEventKey)) continue;
      processedEvents.add(uniqueEventKey);

      if (parsed.name === "VerificationRequest") {
        const [requestId, dealId, dealContract, reqType, cadastralNumber, subjectAddress, fullName] = parsed.args;
        const rid = requestId.toString();
        const reqTypeNum = Number(reqType);

        console.log(`\n📨 VerificationRequest #${rid} (deal ${dealId}, type=${reqTypeNum})`);
        console.log(`   Subject: ${subjectAddress} | ${fullName}`);
        if (cadastralNumber) console.log(`   Cadastral: ${cadastralNumber}`);

        if (reqTypeNum === 0) {
          await handleSellerVerification(rid, dealId, cadastralNumber, subjectAddress, fullName);
        } else if (reqTypeNum === 1) {
          await handleBuyerVerification(rid, dealId, subjectAddress, fullName);
        }
      }

      if (parsed.name === "RegistryTransferRequest") {
        const [requestId, dealId, dealContract, cadastralNumber, sellerFullName, buyerFullName, priceWei] = parsed.args;
        const rid = requestId.toString();

        console.log(`\n📨 RegistryTransferRequest #${rid} (deal ${dealId})`);
        console.log(`   Cadastral: ${cadastralNumber}`);
        console.log(`   ${sellerFullName} → ${buyerFullName}`);
        console.log(`   Price: ${ethers.formatEther(priceWei)} ETH`);

        await handleRegistryTransfer(rid, dealId, dealContract, cadastralNumber, sellerFullName, buyerFullName, priceWei);
      }
    }
  } catch (err) {
    console.error("❌ Oracle polling error:", err.message);
  }
}

async function handleSellerVerification(requestId, dealId, cadastralNumber, sellerAddress, sellerFullName) {
  await sleep(config.sellerVerificationDelay);

  if (config.sellerVerificationShouldFail) {
    console.log(`   ✗ [MOCK FAIL] Seller verification failed`);
    await sendTx(() => oracleContract.fulfilSellerVerification(requestId, false, "MOCK: Registry verification forced to fail"));
    return;
  }

  try {
    const data = await registryFetch(`/properties/${encodeURIComponent(cadastralNumber)}`);
    const record = data.property;
    const normalizedInput = String(sellerAddress).toLowerCase();
    const normalizedOwner = String(record.ownerAddress || "").toLowerCase();

    if (normalizedInput !== normalizedOwner) {
      console.log(`   ✗ Address mismatch. Registry owner: ${record.ownerAddress}`);
      await sendTx(() => oracleContract.fulfilSellerVerification(requestId, false, `Registry shows different owner: ${record.ownerName}`));
      return;
    }

    const firstName = String(sellerFullName || "").split(" ")[0]?.toLowerCase();
    const nameMatch = firstName && String(record.ownerName || "").toLowerCase().includes(firstName);
    if (!nameMatch && String(sellerFullName || "").length > 0) {
      console.log(`   ⚠ Name mismatch (non-fatal in demo): ${sellerFullName} vs ${record.ownerName}`);
    }

    console.log(`   ✓ Seller verified via registry service: ${sellerFullName} owns ${cadastralNumber}`);
    await sendTx(() => oracleContract.fulfilSellerVerification(requestId, true, "Owner verified in mock state registry"));
  } catch (err) {
    console.log(`   ✗ Registry verification error: ${err.message}`);
    await sendTx(() => oracleContract.fulfilSellerVerification(requestId, false, err.message));
  }
}

async function handleBuyerVerification(requestId, dealId, buyerAddress, buyerFullName) {
  await sleep(config.buyerVerificationDelay);

  if (config.buyerVerificationShouldFail) {
    console.log(`   ✗ [MOCK FAIL] Buyer verification failed`);
    await sendTx(() => oracleContract.fulfilBuyerVerification(requestId, false, "MOCK: Buyer verification forced to fail"));
    return;
  }

  if (!buyerFullName || buyerFullName.trim().length < 3) {
    console.log(`   ✗ Buyer name too short`);
    await sendTx(() => oracleContract.fulfilBuyerVerification(requestId, false, "Buyer full name is invalid"));
    return;
  }

  console.log(`   ✓ Buyer verified: ${buyerFullName}`);
  await sendTx(() => oracleContract.fulfilBuyerVerification(requestId, true, "Buyer identity confirmed"));
}

async function handleRegistryTransfer(requestId, dealId, dealContract, cadastralNumber, sellerFullName, buyerFullName, priceWei) {
  await sleep(config.registryCreateDelay);

  if (config.registryShouldFail) {
    console.log(`   ✗ [MOCK FAIL] Registry transfer failed before request creation`);
    await sendTx(() => oracleContract.fulfilRegistryTransfer(requestId, false, "MOCK: Registry transfer forced to fail"));
    return;
  }

  try {
    const deal = await readDeal(dealId);
    const payload = {
      oracleRequestId: requestId,
      dealId: dealId.toString(),
      cadastralNumber: String(cadastralNumber),
      propertyAddress: deal.apartmentAddress,
      sellerFullName: String(sellerFullName),
      buyerFullName: String(buyerFullName),
      sellerAddress: deal.seller,
      buyerAddress: deal.buyer,
      priceWei: priceWei.toString(),
      priceEth: ethers.formatEther(priceWei),
      escrowContract: MARKET_ADDRESS,
      blockchainDealContract: String(dealContract),
    };

    const data = await registryFetch("/transfer-requests", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const request = data.request;
    pendingRegistry.set(requestId, {
      requestId,
      registryRequestId: request.id,
      dealId: dealId.toString(),
      createdAt: Date.now(),
    });

    console.log(`   🏛️ Registry request created: ${request.id}`);
    console.log(`   Waiting for buyer approval in registry frontend...`);
  } catch (err) {
    console.log(`   ✗ Cannot create registry request: ${err.message}`);
    await sendTx(() => oracleContract.fulfilRegistryTransfer(requestId, false, `Registry request creation failed: ${err.message}`));
  }
}

async function pollRegistryStatuses() {
  for (const [requestId, item] of pendingRegistry.entries()) {
    if (finishedRegistry.has(requestId)) continue;

    try {
      const data = await registryFetch(`/oracle/transfer-requests/${encodeURIComponent(requestId)}/status`);
      const request = data.request;

      if (request.status === "WAITING_BUYER_APPROVAL") continue;

      if (request.status === "BUYER_APPROVED") {
        console.log(`   ⏳ Registry request ${request.id}: buyer approved, transfer in progress`);
        continue;
      }

      if (request.status === "OWNERSHIP_TRANSFERRED") {
        finishedRegistry.add(requestId);
        pendingRegistry.delete(requestId);
        console.log(`   ✓ Registry completed request ${request.id}. New record: ${request.newRegistryId}`);
        await sendTx(() => oracleContract.fulfilRegistryTransfer(requestId, true, request.newRegistryId));
        continue;
      }

      if (request.status === "REJECTED") {
        finishedRegistry.add(requestId);
        pendingRegistry.delete(requestId);
        console.log(`   ✗ Registry request ${request.id} rejected: ${request.rejectReason}`);
        await sendTx(() => oracleContract.fulfilRegistryTransfer(requestId, false, request.rejectReason || "Registry request rejected"));
      }
    } catch (err) {
      console.error(`❌ Registry status polling error for request ${requestId}:`, err.message);
    }
  }
}

async function sendTx(fn) {
  try {
    const tx = await fn();
    const receipt = await tx.wait();
    console.log(`   📤 TX confirmed: ${receipt.hash.slice(0, 14)}...`);
  } catch (err) {
    console.error(`   ❌ TX error: ${err.message}`);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

setInterval(() => {
  processOracleLogs().catch((err) => console.error("❌ Oracle polling error:", err.message));
}, 2000);

setInterval(() => {
  pollRegistryStatuses().catch((err) => console.error("❌ Registry status polling error:", err.message));
}, 2500);

const app = express();
app.use(express.json());

app.get("/status", (req, res) => {
  res.json({
    status: "ok",
    config,
    processedEvents: processedEvents.size,
    pendingRegistry: Array.from(pendingRegistry.values()),
    registryApiUrl: REGISTRY_API_URL,
  });
});

app.patch("/config", (req, res) => {
  config = { ...config, ...req.body };
  console.log(`\n⚙️  Config updated:`, config);
  res.json({ ok: true, config });
});

app.listen(Number(PORT), () => {
  console.log(`\n🚀 Oracle backend HTTP API: http://localhost:${PORT}`);
  console.log(`   GET  /status          — статус`);
  console.log(`   PATCH /config         — изменить поведение (shouldFail, delay...)`);
  console.log(`\n👂 Listening for oracle events...`);
  processOracleLogs().catch((err) => console.error("❌ Initial oracle polling error:", err.message));
});
