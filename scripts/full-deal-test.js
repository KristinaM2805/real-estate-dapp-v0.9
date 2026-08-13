import "dotenv/config";
import { ethers } from "ethers";

/**
 * Полностью автоматический E2E-сценарий сделки.
 *
 * Сценарий:
 *
 * 1. Продавец создаёт сделку.
 * 2. Скрипт ждёт проверки продавца Oracle.
 * 3. Покупатель подключается к сделке.
 * 4. Скрипт ждёт проверки покупателя Oracle.
 * 5. Покупатель отправляет ETH в escrow.
 * 6. Продавец подтверждает escrow.
 * 7. Oracle создаёт заявку в Mock Registry.
 * 8. Скрипт находит заявку.
 * 9. Скрипт автоматически подтверждает заявку как покупатель.
 * 10. Реестр переоформляет объект.
 * 11. Oracle отправляет callback в blockchain.
 * 12. Скрипт ждёт DealStage.Completed.
 * 13. В консоль выводится итоговая таблица времени.
 *
 * ВАЖНО:
 * Использовать только тестовые кошельки.
 * Никогда не коммитить private key в Git.
 */

// ============================================================
// ENV
// ============================================================

const {
  // Blockchain
  SEPOLIA_RPC_URL,
  MARKET_ADDRESS,

  SELLER_PRIVATE_KEY,
  BUYER_PRIVATE_KEY,

  // Backend
  ORACLE_API_URL = "http://localhost:3001",
  REGISTRY_API_URL = "http://localhost:3002",

  // Недвижимость
  CADASTRAL_NUMBER = "77:01:0004012:1056",

  APARTMENT_ADDRESS =
    "Minsk, Demo street, 10-56",

  PROPERTY_DOCUMENT_HASH =
    "demo-property-document-hash",

  REGISTRY_RECORD_ID =
    "REG-2026-000001",

  // Цена
  PRICE_ETH = "0.01",

  PAYMENT_TIMEOUT_SECONDS = "3600",

  // Продавец
  SELLER_FULL_NAME =
    "Ivan Petrov",

  SELLER_PASSPORT_HASH =
    "demo-seller-passport-hash",

  // Покупатель
  BUYER_FULL_NAME =
    "Kristina Maykushina",

  BUYER_PASSPORT_HASH =
    "demo-buyer-passport-hash",

  // Данные Mock Registry
  REGISTRY_BUYER_EMAIL =
    "buyer@example.com",

  REGISTRY_BUYER_PASSPORT =
    "HB1234567",

  // Polling
  POLL_MS = "1000",

  STAGE_TIMEOUT_MS =
    "180000",

  REGISTRY_TIMEOUT_MS =
    "180000",

  // Для демонстрации можно поставить 2000-3000
  // Для замеров оставить 0
  DEMO_PAUSE_MS = "0",
} = process.env;


// ============================================================
// ПРОВЕРКА ENV
// ============================================================

const requiredEnv = {
  SEPOLIA_RPC_URL,
  MARKET_ADDRESS,
  SELLER_PRIVATE_KEY,
  BUYER_PRIVATE_KEY,
};

for (
  const [key, value]
  of Object.entries(requiredEnv)
) {
  if (!value) {

    console.error(
      `❌ Не указана переменная ${key}`
    );

    process.exit(1);
  }
}


// ============================================================
// ABI
// ============================================================

const MARKET_ABI = [
"function createDeal(string cadastralNumber, string apartmentAddress, string propertyDocumentHash, string registryRecordId, uint256 price, uint256 paymentTimeoutSeconds) returns (uint256)",

"function submitSellerData(uint256 dealId, string sellerFullName, string sellerPassportHash)",
  "function createDealWithSellerData(" +
  "string cadastralNumber," +
  "string apartmentAddress," +
  "string propertyDocumentHash," +
  "string registryRecordId," +
  "uint256 price," +
  "uint256 paymentTimeoutSeconds," +
  "string sellerFullName," +
  "string sellerPassportHash" +
  ") returns (uint256)",

  "function submitBuyerData(" +
  "uint256 dealId," +
  "string buyerFullName," +
  "string buyerPassportHash" +
  ")",

  "function reservePayment(" +
  "uint256 dealId" +
  ") payable",

  "function sellerConfirmEscrowAndRequestRegistry(" +
  "uint256 dealId" +
  ")",

  "function getDealMain(" +
  "uint256 dealId" +
  ") view returns (" +
  "uint256 id," +
  "address seller," +
  "address buyer," +
  "uint8 stage," +
  "uint256 price," +
  "uint256 escrowAmount," +
  "uint256 paymentDeadline," +
  "uint256 createdAt," +
  "uint256 completedAt" +
  ")",

  "function getDealProperty(" +
  "uint256 dealId" +
  ") view returns (" +
  "string cadastralNumber," +
  "string apartmentAddress," +
  "string registryRecordId," +
  "string newRegistryRecordId," +
  "string lastOracleError" +
  ")",

  "function getDealEscrow(" +
  "uint256 dealId" +
  ") view returns (" +
  "uint256 escrowAmount," +
  "uint256 sellerEscrowConfirmedAt," +
  "uint256 registryRequestedAt," +
  "bytes32 registryProofHash" +
  ")",

  "event DealCreated(" +
  "uint256 indexed dealId," +
  "address indexed seller," +
  "uint256 price," +
  "string cadastralNumber" +
  ")",

  "event StageChanged(" +
  "uint256 indexed dealId," +
  "uint8 stage," +
  "string visualText" +
  ")",

  "event DealCompleted(" +
  "uint256 indexed dealId," +
  "address indexed buyer," +
  "string newRegistryId" +
  ")",

  "event DealCancelled(" +
  "uint256 indexed dealId," +
  "string reason" +
  ")",
];


// ============================================================
// СТАДИИ СДЕЛКИ
// ============================================================

const STAGE_NAMES = {

  0: "Created",

  1: "SellerSubmitted",

  2: "SellerVerified",

  3: "BuyerSubmitted",

  4: "BuyerVerified",

  5: "PaymentReceived",

  6: "SellerEscrowConfirmed",

  7: "RegistryPending",

  8: "Completed",

  9: "Cancelled",
};


// ============================================================
// BLOCKCHAIN
// ============================================================

const provider =
  new ethers.JsonRpcProvider(
    SEPOLIA_RPC_URL
  );


const seller =
  new ethers.Wallet(
    SELLER_PRIVATE_KEY,
    provider
  );


const buyer =
  new ethers.Wallet(
    BUYER_PRIVATE_KEY,
    provider
  );


const marketRead =
  new ethers.Contract(
    MARKET_ADDRESS,
    MARKET_ABI,
    provider
  );


const marketSeller =
  marketRead.connect(
    seller
  );


const marketBuyer =
  marketRead.connect(
    buyer
  );


// ============================================================
// РЕЗУЛЬТАТЫ
// ============================================================

const results = [];

const globalStart =
  performance.now();


// ============================================================
// UTIL
// ============================================================

function now() {

  return performance.now();
}


function sec(ms) {

  return Number(
    (ms / 1000).toFixed(3)
  );
}


function sleep(ms) {

  return new Promise(
    resolve =>
      setTimeout(resolve, ms)
  );
}


async function demoPause() {

  const ms =
    Number(DEMO_PAUSE_MS);

  if (ms > 0) {

    await sleep(ms);
  }
}


function printHeader(title) {

  console.log(
    "\n" +
    "=".repeat(90)
  );

  console.log(title);

  console.log(
    "=".repeat(90)
  );
}


function shortHash(hash) {

  if (!hash) {

    return "—";
  }

  return (
    hash.slice(0, 12) +
    "..." +
    hash.slice(-8)
  );
}


// ============================================================
// HTTP
// ============================================================

async function jsonFetch(
  url,
  options = {}
) {

  const started =
    now();

  const response =
    await fetch(
      url,
      {
        ...options,

        headers: {

          "Content-Type":
            "application/json",

          ...(options.headers || {}),
        },
      }
    );

  const data =
    await response
      .json()
      .catch(
        () => ({})
      );

  const elapsed =
    now() - started;

  if (!response.ok) {

    throw new Error(

      `${
        options.method || "GET"
      } ${url} -> HTTP ${
        response.status
      }: ${
        data.error ||
        JSON.stringify(data)
      }`
    );
  }

  return {
    data,
    elapsed,
  };
}


// ============================================================
// PRECHECK
// ============================================================

async function checkServices() {

  printHeader(
    "PRECHECK"
  );


  const network =
    await provider.getNetwork();


  console.log(
    `Chain ID: ${
      network.chainId
    }`
  );


  console.log(
    `Market: ${MARKET_ADDRESS}`
  );


  console.log(
    `Seller: ${seller.address}`
  );


  console.log(
    `Buyer: ${buyer.address}`
  );


  console.log(
    `Oracle API: ${ORACLE_API_URL}`
  );


  console.log(
    `Registry API: ${REGISTRY_API_URL}`
  );


  // ----------------------------------------------------------
  // Балансы
  // ----------------------------------------------------------

  const sellerBalance =
    await provider.getBalance(
      seller.address
    );


  const buyerBalance =
    await provider.getBalance(
      buyer.address
    );


  console.log(
    `Seller balance: ${
      ethers.formatEther(
        sellerBalance
      )
    } ETH`
  );


  console.log(
    `Buyer balance: ${
      ethers.formatEther(
        buyerBalance
      )
    } ETH`
  );


  const price =
    ethers.parseEther(
      PRICE_ETH
    );


  if (
    buyerBalance <= price
  ) {

    throw new Error(
      `У покупателя недостаточно ETH. ` +
      `Нужно минимум ${PRICE_ETH} ETH + gas`
    );
  }


  // ----------------------------------------------------------
  // Oracle
  // ----------------------------------------------------------

  const oracleStatus =
    await jsonFetch(
      `${ORACLE_API_URL}/status`
    );


  console.log(
    `Oracle backend: ${
      oracleStatus.data.status ||
      "ok"
    }`
  );


  // ----------------------------------------------------------
  // Registry
  // ----------------------------------------------------------

  const registryStatus =
    await jsonFetch(
      `${REGISTRY_API_URL}/status`
    );


  console.log(
    `Registry backend: ${
      registryStatus.data.status ||
      "ok"
    }`
  );


  // ----------------------------------------------------------
  // Убираем принудительные mock-errors
  // ----------------------------------------------------------

  await jsonFetch(
    `${ORACLE_API_URL}/config`,
    {
      method: "PATCH",

      body: JSON.stringify({

        sellerVerificationShouldFail:
          false,

        buyerVerificationShouldFail:
          false,

        registryShouldFail:
          false,
      }),
    }
  );


  // ----------------------------------------------------------
  // Проверяем объект
  // ----------------------------------------------------------

  const propertyResult =
    await jsonFetch(

      `${REGISTRY_API_URL}/properties/${
        encodeURIComponent(
          CADASTRAL_NUMBER
        )
      }`
    );


  const property =
    propertyResult.data.property;


  console.log(
    `Cadastral: ${
      property.cadastralNumber
    }`
  );


  console.log(
    `Registry owner: ${
      property.ownerAddress
    }`
  );


  console.log(
    `Registry owner name: ${
      property.ownerName
    }`
  );


  // ----------------------------------------------------------
  // Продавец должен совпадать с владельцем
  // ----------------------------------------------------------

  if (
    String(
      property.ownerAddress
    ).toLowerCase()
    !==
    seller.address.toLowerCase()
  ) {

    throw new Error(

      [
        "",
        "SELLER_PRIVATE_KEY не соответствует владельцу объекта в Mock Registry.",
        "",
        `Seller script: ${seller.address}`,
        `Registry owner: ${property.ownerAddress}`,
        "",
        "Нужно использовать private key демо-продавца.",
      ].join("\n")
    );
  }


  console.log(
    "\n✅ PRECHECK PASSED"
  );
}


// ============================================================
// DEAL READ
// ============================================================

async function getDeal(
  dealId
) {

  const main =
    await marketRead
      .getDealMain(
        dealId
      );


  return {

    id:
      Number(
        main.id
      ),

    seller:
      main.seller,

    buyer:
      main.buyer,

    stage:
      Number(
        main.stage
      ),

    price:
      main.price,

    escrowAmount:
      main.escrowAmount,

    paymentDeadline:
      main.paymentDeadline,

    createdAt:
      main.createdAt,

    completedAt:
      main.completedAt,
  };
}


// ============================================================
// WAIT DEAL STAGE
// ============================================================

async function waitForStage(
  dealId,
  expectedStage,
  timeout =
    Number(
      STAGE_TIMEOUT_MS
    )
) {

  const started =
    now();

  let lastStage =
    null;


  while (
    now() - started
    < timeout
  ) {

    const deal =
      await getDeal(
        dealId
      );


    if (
      deal.stage
      !==
      lastStage
    ) {

      console.log(

        `   🔄 Deal #${dealId}: ` +
        `S${deal.stage} ` +
        `${
          STAGE_NAMES[
            deal.stage
          ] || "Unknown"
        }`
      );

      lastStage =
        deal.stage;
    }


    // --------------------------------------------------------
    // Отмена
    // --------------------------------------------------------

    if (
      deal.stage === 9
    ) {

      const property =
        await marketRead
          .getDealProperty(
            dealId
          );


      throw new Error(

        `Deal #${dealId} cancelled. ` +
        `Причина: ${
          property.lastOracleError ||
          "unknown"
        }`
      );
    }


    // --------------------------------------------------------
    // Нужная стадия
    // --------------------------------------------------------

    if (
      deal.stage
      ===
      expectedStage
    ) {

      return deal;
    }


    await sleep(
      Number(
        POLL_MS
      )
    );
  }


  throw new Error(

    `Timeout waiting S${expectedStage} ` +
    `${
      STAGE_NAMES[
        expectedStage
      ]
    } for deal #${dealId}`
  );
}


// ============================================================
// DEAL ID ИЗ EVENT
// ============================================================

function extractDealId(
  receipt
) {

  for (
    const log
    of receipt.logs
  ) {

    try {

      const parsed =
        marketRead
          .interface
          .parseLog(
            log
          );


      if (
        parsed?.name
        ===
        "DealCreated"
      ) {

        return Number(
          parsed.args.dealId
        );
      }

    } catch {

      // чужое событие
    }
  }


  throw new Error(
    "DealCreated event не найден"
  );
}


// ============================================================
// TABLE RESULT
// ============================================================

function addResult({

  no,

  actor,

  action,

  sendMs = null,

  blockchainMs = null,

  oracleMs = null,

  registryMs = null,

  totalMs,

  txHash = null,

}) {

  results.push({

    "№":
      no,

    "Пользователь/система":
      actor,

    "Действие":
      action,

    "Node.js отправка, с":
      sendMs == null
        ? "—"
        : sec(sendMs),

    "Blockchain, с":
      blockchainMs == null
        ? "—"
        : sec(blockchainMs),

    "Oracle/backend, с":
      oracleMs == null
        ? "—"
        : sec(oracleMs),

    "Registry API, с":
      registryMs == null
        ? "—"
        : sec(registryMs),

    "Всего, с":
      sec(totalMs),

    "Tx":
      txHash
        ? shortHash(txHash)
        : "—",
  });
}


// ============================================================
// STEP 1
// CREATE DEAL
// ============================================================
async function createDeal() {
  console.log("\n▶ 1. ПРОДАВЕЦ");
  console.log("Создание сделки + отправка данных продавца + проверка Oracle");

  const stepStart = now();

  // ==========================================================
  // 1A. CREATE DEAL
  // ==========================================================

  console.log("\n   [1A] Создание сделки");

  const createSendStart = now();

  const createTx =
    await marketSeller.createDeal(
      CADASTRAL_NUMBER,
      APARTMENT_ADDRESS,
      PROPERTY_DOCUMENT_HASH,
      REGISTRY_RECORD_ID,
      ethers.parseEther(PRICE_ETH),
      BigInt(PAYMENT_TIMEOUT_SECONDS)
    );

  const createSentAt = now();

  console.log(
    `   📤 createDeal TX: ${shortHash(createTx.hash)}`
  );

  console.log(
    `   Node.js send: ${sec(
      createSentAt - createSendStart
    )} s`
  );

  const createBlockchainStart = now();

  const createReceipt =
    await createTx.wait();

  const createMinedAt = now();

  console.log(
    `   ⛓ createDeal confirmed in block ${createReceipt.blockNumber}`
  );

  console.log(
    `   Blockchain: ${sec(
      createMinedAt - createBlockchainStart
    )} s`
  );

  // ==========================================================
  // DEAL ID
  // ==========================================================

  const dealId =
    extractDealId(
      createReceipt
    );

  console.log(
    `   🏠 Deal ID: ${dealId}`
  );

  const afterCreate =
    await getDeal(
      dealId
    );

  console.log(
    `   Stage after createDeal: S${afterCreate.stage} ${
      STAGE_NAMES[afterCreate.stage]
    }`
  );

  // ==========================================================
  // 1B. SUBMIT SELLER DATA
  // ==========================================================

  console.log(
    "\n   [1B] Отправка данных продавца в Oracle"
  );

  const sellerSendStart =
    now();

  const sellerTx =
    await marketSeller.submitSellerData(
      dealId,
      SELLER_FULL_NAME,
      SELLER_PASSPORT_HASH
    );

  const sellerSentAt =
    now();

  console.log(
    `   📤 submitSellerData TX: ${shortHash(sellerTx.hash)}`
  );

  console.log(
    `   Node.js send: ${sec(
      sellerSentAt - sellerSendStart
    )} s`
  );

  const sellerBlockchainStart =
    now();

  const sellerReceipt =
    await sellerTx.wait();

  const sellerMinedAt =
    now();

  console.log(
    `   ⛓ submitSellerData confirmed in block ${sellerReceipt.blockNumber}`
  );

  console.log(
    `   Blockchain: ${sec(
      sellerMinedAt - sellerBlockchainStart
    )} s`
  );

  // ==========================================================
  // ORACLE
  // ==========================================================

  console.log(
    "\n   [1C] Ожидание проверки продавца Oracle"
  );

  const oracleStart =
    now();

  await waitForStage(
    dealId,
    2
  );

  const oracleEnd =
    now();

  console.log(
    `   ☁ Oracle/backend: ${sec(
      oracleEnd - oracleStart
    )} s`
  );

  console.log(
    "   ✅ Продавец подтверждён"
  );

  // ==========================================================
  // RESULT
  // ==========================================================

  addResult({
    no: 1,
    actor: "Продавец",
    action:
      "Создание сделки + данные продавца + проверка Oracle",

    sendMs:
      (createSentAt - createSendStart) +
      (sellerSentAt - sellerSendStart),

    blockchainMs:
      (createMinedAt - createBlockchainStart) +
      (sellerMinedAt - sellerBlockchainStart),

    oracleMs:
      oracleEnd - oracleStart,

    totalMs:
      now() - stepStart,

    txHash:
      `${shortHash(createTx.hash)} / ${shortHash(sellerTx.hash)}`,
  });

  await demoPause();

  return dealId;
}

// ============================================================
// STEP 2
// BUYER
// ============================================================

async function submitBuyer(
  dealId
) {

  console.log(
    "\n▶ 2. ПОКУПАТЕЛЬ"
  );

  console.log(
    "Подключение к сделке + проверка покупателя"
  );


  const stepStart =
    now();


  const sendStart =
    now();


  const tx =
    await marketBuyer
      .submitBuyerData(

        dealId,

        BUYER_FULL_NAME,

        BUYER_PASSPORT_HASH
      );


  const sentAt =
    now();


  console.log(
    `   📤 TX: ${
      shortHash(tx.hash)
    }`
  );


  console.log(
    `   Node.js send: ${
      sec(
        sentAt -
        sendStart
      )
    } s`
  );


  const blockchainStart =
    now();


  const receipt =
    await tx.wait();


  const minedAt =
    now();


  console.log(
    `   ⛓ Block: ${
      receipt.blockNumber
    }`
  );


  console.log(
    `   Blockchain: ${
      sec(
        minedAt -
        blockchainStart
      )
    } s`
  );


  // ----------------------------------------------------------
  // Oracle buyer
  // ----------------------------------------------------------

  const oracleStart =
    now();


  await waitForStage(
    dealId,
    4
  );


  const oracleEnd =
    now();


  console.log(
    `   ☁ Oracle/backend: ${
      sec(
        oracleEnd -
        oracleStart
      )
    } s`
  );


  console.log(
    "   ✅ Покупатель подтверждён"
  );


  addResult({

    no: 2,

    actor:
      "Покупатель",

    action:
      "Подключение + проверка покупателя",

    sendMs:
      sentAt -
      sendStart,

    blockchainMs:
      minedAt -
      blockchainStart,

    oracleMs:
      oracleEnd -
      oracleStart,

    totalMs:
      now() -
      stepStart,

    txHash:
      tx.hash,
  });


  await demoPause();
}


// ============================================================
// STEP 3
// PAYMENT
// ============================================================

async function payEscrow(
  dealId
) {

  console.log(
    "\n▶ 3. ПОКУПАТЕЛЬ"
  );

  console.log(
    "Внесение оплаты в escrow"
  );


  const deal =
    await getDeal(
      dealId
    );


  console.log(
    `   Цена: ${
      ethers.formatEther(
        deal.price
      )
    } ETH`
  );


  const stepStart =
    now();


  const sendStart =
    now();


  const tx =
    await marketBuyer
      .reservePayment(

        dealId,

        {
          value:
            deal.price,
        }
      );


  const sentAt =
    now();


  console.log(
    `   📤 TX: ${
      shortHash(tx.hash)
    }`
  );


  const blockchainStart =
    now();


  const receipt =
    await tx.wait();


  const minedAt =
    now();


  await waitForStage(
    dealId,
    5
  );


  console.log(
    `   ⛓ Block: ${
      receipt.blockNumber
    }`
  );


  console.log(
    `   Blockchain: ${
      sec(
        minedAt -
        blockchainStart
      )
    } s`
  );


  console.log(
    `   ✅ В escrow: ${
      ethers.formatEther(
        deal.price
      )
    } ETH`
  );


  addResult({

    no: 3,

    actor:
      "Покупатель",

    action:
      "Внесение оплаты в escrow",

    sendMs:
      sentAt -
      sendStart,

    blockchainMs:
      minedAt -
      blockchainStart,

    totalMs:
      now() -
      stepStart,

    txHash:
      tx.hash,
  });


  await demoPause();
}


// ============================================================
// STEP 4
// SELLER CONFIRMS ESCROW
// ============================================================

async function requestRegistry(
  dealId
) {

  console.log(
    "\n▶ 4. ПРОДАВЕЦ"
  );

  console.log(
    "Подтверждение escrow + создание запроса в реестр"
  );


  const stepStart =
    now();


  const sendStart =
    now();


  const tx =
    await marketSeller
      .sellerConfirmEscrowAndRequestRegistry(
        dealId
      );


  const sentAt =
    now();


  console.log(
    `   📤 TX: ${
      shortHash(tx.hash)
    }`
  );


  const blockchainStart =
    now();


  const receipt =
    await tx.wait();


  const minedAt =
    now();


  await waitForStage(
    dealId,
    7
  );


  console.log(
    `   ⛓ Block: ${
      receipt.blockNumber
    }`
  );


  console.log(
    `   Blockchain: ${
      sec(
        minedAt -
        blockchainStart
      )
    } s`
  );


  console.log(
    "   ✅ RegistryPending"
  );


  addResult({

    no: 4,

    actor:
      "Продавец",

    action:
      "Подтверждение escrow + запрос в реестр",

    sendMs:
      sentAt -
      sendStart,

    blockchainMs:
      minedAt -
      blockchainStart,

    totalMs:
      now() -
      stepStart,

    txHash:
      tx.hash,
  });


  await demoPause();
}


// ============================================================
// STEP 5
// WAIT REGISTRY REQUEST
// ============================================================

async function waitForRegistryRequest(
  dealId
) {

  console.log(
    "\n▶ 5. ORACLE / REGISTRY"
  );

  console.log(
    "Ожидание создания заявки в Mock Registry"
  );


  const started =
    now();


  while (
    now() - started
    <
    Number(
      REGISTRY_TIMEOUT_MS
    )
  ) {

    const qs =
      new URLSearchParams({

        email:
          REGISTRY_BUYER_EMAIL,

        passport:
          REGISTRY_BUYER_PASSPORT,
      });


    const {
      data
    } =
      await jsonFetch(

        `${REGISTRY_API_URL}/transfer-requests?${
          qs.toString()
        }`
      );


    const requests =
      data.requests || [];


    const request =
      requests

        .filter(
          item =>
            String(
              item.dealId
            )
            ===
            String(
              dealId
            )
        )

        .sort(
          (a, b) =>
            String(
              b.createdAt || ""
            )
            .localeCompare(
              String(
                a.createdAt || ""
              )
            )
        )[0];


    if (request) {

      const elapsed =
        now() -
        started;


      console.log(
        `   🏛 Request: ${
          request.id
        }`
      );


      console.log(
        `   Status: ${
          request.status
        }`
      );


      console.log(
        `   Создание заявки: ${
          sec(
            elapsed
          )
        } s`
      );


      addResult({

        no: 5,

        actor:
          "Oracle/backend",

        action:
          "Создание заявки в Mock Registry",

        registryMs:
          elapsed,

        totalMs:
          elapsed,
      });


      await demoPause();


      return request;
    }


    await sleep(
      Number(
        POLL_MS
      )
    );
  }


  throw new Error(

    `Timeout ожидания Registry request ` +
    `для deal #${dealId}`
  );
}


// ============================================================
// STEP 6
// AUTO APPROVE REGISTRY
// ============================================================

async function approveRegistry(
  request
) {

  console.log(
    "\n▶ 6. ПОКУПАТЕЛЬ"
  );

  console.log(
    "Автоматическое подтверждение заявки в реестре"
  );


  const started =
    now();


  const {
    data,
    elapsed
  } =
    await jsonFetch(

      `${REGISTRY_API_URL}/transfer-requests/${
        encodeURIComponent(
          request.id
        )
      }/approve`,

      {
        method:
          "POST",

        body:
          JSON.stringify({

            email:
              REGISTRY_BUYER_EMAIL,

            passport:
              REGISTRY_BUYER_PASSPORT,
          }),
      }
    );


  console.log(
    "   ✅ Заявка подтверждена"
  );


  console.log(
    `   HTTP: ${
      sec(
        elapsed
      )
    } s`
  );


  console.log(
    `   Status: ${
      data.request.status
    }`
  );


  addResult({

    no: 6,

    actor:
      "Покупатель (авто)",

    action:
      "Подтверждение заявки в Mock Registry",

    registryMs:
      elapsed,

    totalMs:
      now() -
      started,
  });


  await demoPause();
}


// ============================================================
// STEP 7
// WAIT OWNERSHIP TRANSFER
// ============================================================

async function waitRegistryTransferred(
  requestId
) {

  console.log(
    "\n▶ 7. MOCK REGISTRY"
  );

  console.log(
    "Переоформление права собственности"
  );


  const started =
    now();


  while (
    now() - started
    <
    Number(
      REGISTRY_TIMEOUT_MS
    )
  ) {

    const {
      data
    } =
      await jsonFetch(

        `${REGISTRY_API_URL}/transfer-requests/${
          encodeURIComponent(
            requestId
          )
        }`
      );


    const request =
      data.request;


    console.log(
      `   Registry status: ${
        request.status
      }`
    );


    if (
      request.status
      ===
      "REJECTED"
    ) {

      throw new Error(

        `Registry rejected: ${
          request.rejectReason
        }`
      );
    }


    if (
      request.status
      ===
      "OWNERSHIP_TRANSFERRED"
    ) {

      const elapsed =
        now() -
        started;


      console.log(
        "   ✅ Право собственности переоформлено"
      );


      console.log(
        `   New Registry ID: ${
          request.newRegistryId
        }`
      );


      console.log(
        `   Registry time: ${
          sec(
            elapsed
          )
        } s`
      );


      addResult({

        no: 7,

        actor:
          "Реестр",

        action:
          "Переоформление права собственности",

        registryMs:
          elapsed,

        totalMs:
          elapsed,
      });


      await demoPause();


      return request;
    }


    await sleep(
      Number(
        POLL_MS
      )
    );
  }


  throw new Error(
    "Timeout OWNERSHIP_TRANSFERRED"
  );
}


// ============================================================
// STEP 8
// WAIT COMPLETED
// ============================================================

async function waitCompleted(
  dealId
) {

  console.log(
    "\n▶ 8. ORACLE / BLOCKCHAIN"
  );

  console.log(
    "Ожидание финального callback и Completed"
  );


  const started =
    now();


  await waitForStage(
    dealId,
    8
  );


  const finished =
    now();


  const property =
    await marketRead
      .getDealProperty(
        dealId
      );


  const escrow =
    await marketRead
      .getDealEscrow(
        dealId
      );


  console.log(
    `   ✅ Deal #${dealId}: COMPLETED`
  );


  console.log(
    `   New Registry ID: ${
      property.newRegistryRecordId
    }`
  );


  console.log(
    `   Escrow remaining: ${
      ethers.formatEther(
        escrow.escrowAmount
      )
    } ETH`
  );


  addResult({

    no: 8,

    actor:
      "Oracle / Blockchain",

    action:
      "Callback реестра + Completed + выплата продавцу",

    oracleMs:
      finished -
      started,

    totalMs:
      finished -
      started,
  });
}


// ============================================================
// FINAL TABLE
// ============================================================

function printFinalTable(
  dealId
) {

  printHeader(
    `FINAL RESULT — DEAL #${dealId}`
  );


  console.table(
    results
  );


  const total =
    now() -
    globalStart;


  console.log(
    `\n🏁 Полное время E2E: ${
      sec(
        total
      )
    } s`
  );


  console.log(
    `🏠 Deal ID: ${dealId}`
  );


  console.log(
    `👤 Seller: ${seller.address}`
  );


  console.log(
    `👤 Buyer: ${buyer.address}`
  );


  console.log(
    `💰 Price: ${PRICE_ETH} ETH`
  );


  console.log(
    "✅ FINAL STATUS: COMPLETED"
  );
}


// ============================================================
// MAIN
// ============================================================

async function main() {

  printHeader(
    "FULL AUTOMATED REAL ESTATE E2E"
  );


  // ----------------------------------------------------------
  // Проверка системы
  // ----------------------------------------------------------

  await checkServices();


  // ----------------------------------------------------------
  // 1. Продавец создаёт сделку
  // ----------------------------------------------------------

  const dealId =
    await createDeal();


  // ----------------------------------------------------------
  // 2. Покупатель подключается
  // ----------------------------------------------------------

  await submitBuyer(
    dealId
  );


  // ----------------------------------------------------------
  // 3. Оплата escrow
  // ----------------------------------------------------------

  await payEscrow(
    dealId
  );


  // ----------------------------------------------------------
  // 4. Продавец создаёт запрос в реестр
  // ----------------------------------------------------------

  await requestRegistry(
    dealId
  );


  // ----------------------------------------------------------
  // 5. Ждём заявку
  // ----------------------------------------------------------

  const registryRequest =
    await waitForRegistryRequest(
      dealId
    );


  // ----------------------------------------------------------
  // 6. Покупатель автоматически подтверждает
  // ----------------------------------------------------------

  await approveRegistry(
    registryRequest
  );


  // ----------------------------------------------------------
  // 7. Ждём реестр
  // ----------------------------------------------------------

  await waitRegistryTransferred(
    registryRequest.id
  );


  // ----------------------------------------------------------
  // 8. Ждём Completed
  // ----------------------------------------------------------

  await waitCompleted(
    dealId
  );


  // ----------------------------------------------------------
  // Итог
  // ----------------------------------------------------------

  printFinalTable(
    dealId
  );
}


// ============================================================
// START
// ============================================================

main()

  .then(() => {

    process.exitCode = 0;
  })

  .catch(error => {

    console.error(
      "\n❌ E2E FAILED"
    );


    console.error(

      error?.stack ||
      error?.message ||
      error
    );


    if (
      results.length
    ) {

      console.log(
        "\nЧастичные результаты:"
      );


      console.table(
        results
      );
    }


    process.exitCode = 1;
  });