import express from "express";

const app = express();
const PORT = Number(process.env.PORT || 3002);
const TRANSFER_DELAY_MS = Number(process.env.TRANSFER_DELAY_MS || 5000);

app.use(express.json());
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const users = [
  {
    id: "seller-ivan",
    email: "seller@example.com",
    passport: "MP1234567",
    fullName: "Ivan Petrov",
    role: "seller",
    walletAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
  },
  {
    id: "buyer-kristina",
    email: "buyer@example.com",
    passport: "HB1234567",
    fullName: "Kristina Maykushina",
    role: "buyer",
    walletAddress: "0x70997970c51812dc3a010c7d01b50e0d17dc79c8",
  },
];

let nextRegistrySeq = 100;
let nextTransferSeq = 1;

const properties = {
  "77:01:0004012:1056": {
    cadastralNumber: "77:01:0004012:1056",
    propertyAddress: "Minsk, Demo street, 10-56",
    ownerName: "Ivan Petrov",
    ownerAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    registryId: "REG-2026-000001",
    status: "ACTIVE",
  },
  "77:02:0001234:5678": {
    cadastralNumber: "77:02:0001234:5678",
    propertyAddress: "Minsk, Demo avenue, 12-34",
    ownerName: "Anna Sidorova",
    ownerAddress: "0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266",
    registryId: "REG-2026-000002",
    status: "ACTIVE",
  },
};

const transferRequests = [];

function normalizeAddress(value = "") {
  return String(value).toLowerCase();
}

function normalizeText(value = "") {
  return String(value).trim().toLowerCase();
}

function withoutPassport(user) {
  if (!user) return null;
  const { passport, ...safe } = user;
  return safe;
}

function findUser(email, passport) {
  return users.find(
    (u) => normalizeText(u.email) === normalizeText(email) && String(u.passport) === String(passport)
  );
}

function publicRequest(req) {
  return {
    id: req.id,
    oracleRequestId: req.oracleRequestId,
    dealId: req.dealId,
    status: req.status,
    cadastralNumber: req.cadastralNumber,
    propertyAddress: req.propertyAddress,
    sellerFullName: req.sellerFullName,
    buyerFullName: req.buyerFullName,
    sellerAddress: req.sellerAddress,
    buyerAddress: req.buyerAddress,
    priceWei: req.priceWei,
    priceEth: req.priceEth,
    escrowContract: req.escrowContract,
    blockchainDealContract: req.blockchainDealContract,
    oldRegistryId: req.oldRegistryId,
    newRegistryId: req.newRegistryId,
    proofHash: req.proofHash,
    createdAt: req.createdAt,
    buyerApprovedAt: req.buyerApprovedAt,
    transferredAt: req.transferredAt,
    rejectedAt: req.rejectedAt,
    rejectReason: req.rejectReason,
  };
}

function finishTransfer(req) {
  if (req.status !== "BUYER_APPROVED") return;

  const property = properties[req.cadastralNumber];
  if (!property) {
    req.status = "REJECTED";
    req.rejectedAt = new Date().toISOString();
    req.rejectReason = "Property not found during transfer";
    return;
  }

  const newRegistryId = `REG-${new Date().getFullYear()}-${String(nextRegistrySeq++).padStart(6, "0")}`;
  property.ownerName = req.buyerFullName;
  property.ownerAddress = req.buyerAddress;
  property.registryId = newRegistryId;
  property.status = "ACTIVE";

  req.status = "OWNERSHIP_TRANSFERRED";
  req.newRegistryId = newRegistryId;
  req.proofHash = `mock-proof-${req.dealId}-${req.cadastralNumber}-${newRegistryId}`;
  req.transferredAt = new Date().toISOString();
}

app.get("/status", (req, res) => {
  res.json({
    status: "ok",
    service: "mock-registry",
    properties: Object.keys(properties).length,
    transferRequests: transferRequests.length,
  });
});

app.post("/auth/login", (req, res) => {
  const { email, passport } = req.body || {};
  const user = findUser(email, passport);
  if (!user) return res.status(401).json({ ok: false, error: "Неверный email или паспорт" });
  res.json({ ok: true, user: withoutPassport(user) });
});

app.get("/users/demo", (req, res) => {
  res.json({ users: users.map(withoutPassport) });
});

app.get("/properties", (req, res) => {
  const { email, passport } = req.query;
  const user = email && passport ? findUser(email, passport) : null;
  let items = Object.values(properties);

  if (user) {
    const userName = normalizeText(user.fullName);
    const userAddress = normalizeAddress(user.walletAddress);
    items = items.filter(
      (p) => normalizeText(p.ownerName) === userName || normalizeAddress(p.ownerAddress) === userAddress
    );
  }

  res.json({ properties: items });
});

app.get("/properties/:cadastral", (req, res) => {
  const cadastral = decodeURIComponent(req.params.cadastral);
  const property = properties[cadastral];
  if (!property) return res.status(404).json({ ok: false, error: "Property not found" });
  res.json({ ok: true, property });
});

app.post("/transfer-requests", (req, res) => {
  const body = req.body || {};
  const property = properties[body.cadastralNumber];

  if (!property) {
    return res.status(404).json({ ok: false, error: `Property ${body.cadastralNumber} not found` });
  }

  const existing = transferRequests.find(
    (item) => String(item.oracleRequestId) === String(body.oracleRequestId)
  );
  if (existing) return res.json({ ok: true, request: publicRequest(existing) });

  const id = `REG-REQ-${String(nextTransferSeq++).padStart(6, "0")}`;
  const item = {
    id,
    oracleRequestId: String(body.oracleRequestId),
    dealId: String(body.dealId),
    status: "WAITING_BUYER_APPROVAL",
    cadastralNumber: body.cadastralNumber,
    propertyAddress: body.propertyAddress || property.propertyAddress,
    sellerFullName: body.sellerFullName,
    buyerFullName: body.buyerFullName,
    sellerAddress: normalizeAddress(body.sellerAddress),
    buyerAddress: normalizeAddress(body.buyerAddress),
    priceWei: String(body.priceWei || "0"),
    priceEth: body.priceEth || null,
    escrowContract: body.escrowContract,
    blockchainDealContract: body.blockchainDealContract,
    oldRegistryId: property.registryId,
    newRegistryId: null,
    proofHash: null,
    createdAt: new Date().toISOString(),
    buyerApprovedAt: null,
    transferredAt: null,
    rejectedAt: null,
    rejectReason: null,
  };

  transferRequests.push(item);
  console.log(`📥 Registry request created: ${id} for deal ${item.dealId}`);
  res.status(201).json({ ok: true, request: publicRequest(item) });
});

app.get("/transfer-requests", (req, res) => {
  const { email, passport } = req.query;
  const user = email && passport ? findUser(email, passport) : null;

  let items = transferRequests;
  if (user) {
    const userName = normalizeText(user.fullName);
    const userAddress = normalizeAddress(user.walletAddress);
    items = items.filter(
      (r) => normalizeText(r.buyerFullName) === userName || normalizeAddress(r.buyerAddress) === userAddress || normalizeText(r.sellerFullName) === userName || normalizeAddress(r.sellerAddress) === userAddress
    );
  }

  res.json({ requests: items.map(publicRequest) });
});

app.get("/transfer-requests/:id", (req, res) => {
  const item = transferRequests.find((r) => r.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "Request not found" });
  res.json({ ok: true, request: publicRequest(item) });
});

app.post("/transfer-requests/:id/approve", (req, res) => {
  const item = transferRequests.find((r) => r.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "Request not found" });
  if (item.status !== "WAITING_BUYER_APPROVAL") {
    return res.status(409).json({ ok: false, error: `Wrong status: ${item.status}` });
  }

  const { email, passport } = req.body || {};
  const user = findUser(email, passport);
  if (!user) return res.status(401).json({ ok: false, error: "Неверный email или паспорт" });

  const isBuyer = normalizeText(user.fullName) === normalizeText(item.buyerFullName) ||
    normalizeAddress(user.walletAddress) === normalizeAddress(item.buyerAddress);
  if (!isBuyer) return res.status(403).json({ ok: false, error: "Эта заявка предназначена другому покупателю" });

  item.status = "BUYER_APPROVED";
  item.buyerApprovedAt = new Date().toISOString();
  console.log(`✅ Buyer approved registry request ${item.id}`);

  setTimeout(() => finishTransfer(item), TRANSFER_DELAY_MS);
  res.json({ ok: true, request: publicRequest(item) });
});

app.post("/transfer-requests/:id/reject", (req, res) => {
  const item = transferRequests.find((r) => r.id === req.params.id);
  if (!item) return res.status(404).json({ ok: false, error: "Request not found" });
  if (item.status !== "WAITING_BUYER_APPROVAL") {
    return res.status(409).json({ ok: false, error: `Wrong status: ${item.status}` });
  }

  const { email, passport, reason = "Rejected by buyer" } = req.body || {};
  const user = findUser(email, passport);
  if (!user) return res.status(401).json({ ok: false, error: "Неверный email или паспорт" });

  const isBuyer = normalizeText(user.fullName) === normalizeText(item.buyerFullName) ||
    normalizeAddress(user.walletAddress) === normalizeAddress(item.buyerAddress);
  if (!isBuyer) return res.status(403).json({ ok: false, error: "Эта заявка предназначена другому покупателю" });

  item.status = "REJECTED";
  item.rejectedAt = new Date().toISOString();
  item.rejectReason = reason;
  console.log(`❌ Buyer rejected registry request ${item.id}: ${reason}`);
  res.json({ ok: true, request: publicRequest(item) });
});

app.get("/oracle/transfer-requests/:oracleRequestId/status", (req, res) => {
  const item = transferRequests.find((r) => String(r.oracleRequestId) === String(req.params.oracleRequestId));
  if (!item) return res.status(404).json({ ok: false, error: "Request not found" });
  res.json({ ok: true, request: publicRequest(item) });
});

app.listen(PORT, () => {
  console.log(`🏛️  Mock Registry API started: http://localhost:${PORT}`);
  console.log(`   Demo buyer login: buyer@example.com / HB1234567`);
  console.log(`   Demo seller login: seller@example.com / MP1234567`);
});
