import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { ethers } from "ethers";
import { spawn } from "child_process";
import { randomUUID } from "crypto";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PROJECT_ROOT = path.resolve(__dirname, "..");

dotenv.config({
  path: path.join(PROJECT_ROOT, ".env"),
});

const PORT = Number(
  process.env.AUTOMATION_PORT ||
  process.env.PORT ||
  3003
);

const {
  SEPOLIA_RPC_URL,
  MARKET_ADDRESS,
  SELLER_PRIVATE_KEY,
  BUYER_PRIVATE_KEY,

  ORACLE_API_URL =
    "https://real-estate-dapp-v0-9-oracle1.onrender.com",

  REGISTRY_API_URL =
    "https://real-estate-dapp-v0-9.onrender.com",
} = process.env;

const E2E_SCRIPT = path.join(
  PROJECT_ROOT,
  "scripts",
  "full-deal-test.js"
);

const app = express();

app.use(cors());
app.use(express.json());


// ============================================================
// AUTOMATION RUNS
// ============================================================

const runs = new Map();

let activeRunId = null;


// ============================================================
// DEAL STAGES
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
// CONTRACT ABI
// ============================================================

const MARKET_ABI = [

  "function nextDealId() view returns (uint256)",

  "function createDeal(" +
  "string cadastralNumber," +
  "string apartmentAddress," +
  "string propertyDocumentHash," +
  "string registryRecordId," +
  "uint256 price," +
  "uint256 paymentTimeoutSeconds" +
  ") returns (uint256)",

  "function submitSellerData(" +
  "uint256 dealId," +
  "string sellerFullName," +
  "string sellerPassportHash" +
  ")",

  "function submitBuyerData(" +
  "uint256 dealId," +
  "string buyerFullName," +
  "string buyerPassportHash" +
  ")",

  "function reservePayment(uint256 dealId) payable",

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
];


// ============================================================
// BLOCKCHAIN INITIALIZATION
// ============================================================

let provider = null;

let sellerWallet = null;
let buyerWallet = null;

let marketRead = null;
let marketSeller = null;
let marketBuyer = null;

let blockchainInitError = null;


function initBlockchain() {

  if (
    !SEPOLIA_RPC_URL ||
    !MARKET_ADDRESS ||
    !SELLER_PRIVATE_KEY ||
    !BUYER_PRIVATE_KEY
  ) {

    blockchainInitError =
      "Missing required env: " +
      "SEPOLIA_RPC_URL, MARKET_ADDRESS, " +
      "SELLER_PRIVATE_KEY, BUYER_PRIVATE_KEY";

    console.warn(
      `⚠️ ${blockchainInitError}`
    );

    return;
  }


  try {

    provider =
      new ethers.JsonRpcProvider(
        SEPOLIA_RPC_URL
      );


    sellerWallet =
      new ethers.Wallet(
        SELLER_PRIVATE_KEY,
        provider
      );


    buyerWallet =
      new ethers.Wallet(
        BUYER_PRIVATE_KEY,
        provider
      );


    marketRead =
      new ethers.Contract(
        MARKET_ADDRESS,
        MARKET_ABI,
        provider
      );


    marketSeller =
      marketRead.connect(
        sellerWallet
      );


    marketBuyer =
      marketRead.connect(
        buyerWallet
      );


    blockchainInitError = null;


    console.log(
      "✅ Blockchain initialized"
    );

    console.log(
      `Seller: ${sellerWallet.address}`
    );

    console.log(
      `Buyer: ${buyerWallet.address}`
    );

  } catch (error) {

    blockchainInitError =
      error.message;

    console.error(
      "❌ Blockchain init error:",
      error.message
    );
  }
}


initBlockchain();


// ============================================================
// MIDDLEWARE
// ============================================================

function requireBlockchain(
  req,
  res,
  next
) {

  if (
    !provider ||
    !marketRead ||
    !marketSeller ||
    !marketBuyer
  ) {

    return res
      .status(503)
      .json({

        success: false,

        error:
          "blockchain_not_configured",

        message:
          blockchainInitError ||
          "Blockchain connection is not configured",
      });
  }


  next();
}


// ============================================================
// HELPERS
// ============================================================

function errorMessage(error) {

  return (

    error?.shortMessage ||

    error?.reason ||

    error?.info?.error?.message ||

    error?.message ||

    String(error)
  );
}


function asNumber(value) {

  return Number(
    value?.toString?.() ?? value
  );
}


async function readManualDeal(
  dealId
) {

  const [
    main,
    property,
    escrow,
  ] = await Promise.all([

    marketRead.getDealMain(
      dealId
    ),

    marketRead.getDealProperty(
      dealId
    ),

    marketRead.getDealEscrow(
      dealId
    ),
  ]);


  const stage =
    asNumber(
      main.stage
    );


  return {

    dealId:
      asNumber(
        main.id
      ),

    seller:
      main.seller,

    buyer:
      main.buyer,

    stage,

    stageName:
      STAGE_NAMES[stage] ??
      "Unknown",

    priceWei:
      main.price.toString(),

    priceEth:
      ethers.formatEther(
        main.price
      ),

    escrowWei:
      escrow.escrowAmount
        .toString(),

    escrowEth:
      ethers.formatEther(
        escrow.escrowAmount
      ),

    paymentDeadline:
      main.paymentDeadline
        .toString(),

    createdAt:
      main.createdAt
        .toString(),

    completedAt:
      main.completedAt
        .toString(),

    cadastralNumber:
      property.cadastralNumber,

    apartmentAddress:
      property.apartmentAddress,

    registryRecordId:
      property.registryRecordId,

    newRegistryRecordId:
      property.newRegistryRecordId,

    lastOracleError:
      property.lastOracleError,

    sellerEscrowConfirmedAt:
      escrow.sellerEscrowConfirmedAt
        .toString(),

    registryRequestedAt:
      escrow.registryRequestedAt
        .toString(),

    registryProofHash:
      escrow.registryProofHash,
  };
}


function transactionResponse(
  receipt,
  extra = {}
) {

  return {

    success: true,

    txHash:
      receipt.hash,

    blockNumber:
      receipt.blockNumber,

    gasUsed:
      receipt.gasUsed.toString(),

    ...extra,
  };
}


// ============================================================
// PARSE AUTOMATION RESULT
// ============================================================

function parseAutomationResult(
  run
) {

  const output =
    run.logs
      .map(
        item => item.text
      )
      .join("");


  const getMatch = regex => {

    const match =
      output.match(regex);

    return match
      ? match[1]
      : null;
  };


  const dealId =
    getMatch(
      /🏠 Deal ID:\s*(\d+)/
    );


  const totalSeconds =
    getMatch(
      /🏁 Полное время E2E:\s*([\d.]+)\s*s/
    );


  const seller =
    getMatch(
      /👤 Seller:\s*(0x[a-fA-F0-9]+)/
    );


  const buyer =
    getMatch(
      /👤 Buyer:\s*(0x[a-fA-F0-9]+)/
    );


  const priceEth =
    getMatch(
      /💰 Price:\s*([\d.]+)\s*ETH/
    );


  const finalStatus =
    getMatch(
      /✅ FINAL STATUS:\s*([A-Z_]+)/
    );


  return {

    runId:
      run.runId,

    status:
      run.status,

    dealId:
      dealId
        ? Number(dealId)
        : null,

    finalStage:
      finalStatus ===
      "COMPLETED"
        ? 8
        : null,

    finalStageName:
      finalStatus ===
      "COMPLETED"
        ? "Completed"
        : finalStatus,

    totalSeconds:
      totalSeconds !== null
        ? Number(
            totalSeconds
          )
        : null,

    seller,

    buyer,

    priceEth,

    startedAt:
      run.startedAt,

    finishedAt:
      run.finishedAt,

    exitCode:
      run.exitCode,

    success:
      run.status ===
        "completed" &&
      finalStatus ===
        "COMPLETED",
  };
}


// ============================================================
// 01 — SERVICE HEALTH
// ============================================================

app.get(
  "/api/automation/health",
  async (req, res) => {

    let blockchain = {

      configured:
        Boolean(provider),

      ok: false,

      chainId: null,

      blockNumber: null,
    };


    if (provider) {

      try {

        const [
          network,
          blockNumber,
        ] =
          await Promise.all([

            provider
              .getNetwork(),

            provider
              .getBlockNumber(),
          ]);


        blockchain = {

          configured: true,

          ok: true,

          chainId:
            network.chainId
              .toString(),

          blockNumber,
        };

      } catch (error) {

        blockchain.error =
          errorMessage(
            error
          );
      }

    } else {

      blockchain.error =
        blockchainInitError;
    }


    res.json({

      status: "ok",

      service:
        "automation-backend",

      activeRunId,

      blockchain,

      oracleApiUrl:
        ORACLE_API_URL,

      registryApiUrl:
        REGISTRY_API_URL,
    });
  }
);


// ============================================================
// 02 — AUTOMATED E2E
// ============================================================

app.post(
  "/api/automation/deals",
  (req, res) => {

    if (activeRunId) {

      const active =
        runs.get(
          activeRunId
        );


      if (
        active &&
        [
          "starting",
          "running",
        ].includes(
          active.status
        )
      ) {

        return res
          .status(409)
          .json({

            success: false,

            error:
              "automation_already_running",

            message:
              "Другой автоматизированный сценарий уже выполняется",

            activeRunId,
          });
      }
    }


    const runId =
      randomUUID();


    const startedAt =
      new Date()
        .toISOString();


    const run = {

      runId,

      status:
        "starting",

      startedAt,

      finishedAt:
        null,

      exitCode:
        null,

      logs: [],
    };


    runs.set(
      runId,
      run
    );


    activeRunId =
      runId;


    const child =
      spawn(

        process.execPath,

        [
          E2E_SCRIPT
        ],

        {

          cwd:
            PROJECT_ROOT,

          env:
            process.env,
        }
      );


    run.status =
      "running";

    run.pid =
      child.pid;


    child.stdout.on(
      "data",
      chunk => {

        const text =
          chunk.toString();


        run.logs.push({

          type:
            "stdout",

          time:
            new Date()
              .toISOString(),

          text,
        });


        process.stdout.write(

          `[${runId}] ${text}`
        );
      }
    );


    child.stderr.on(
      "data",
      chunk => {

        const text =
          chunk.toString();


        run.logs.push({

          type:
            "stderr",

          time:
            new Date()
              .toISOString(),

          text,
        });


        process.stderr.write(

          `[${runId}] ${text}`
        );
      }
    );


    child.on(
      "error",
      error => {

        run.status =
          "failed";

        run.finishedAt =
          new Date()
            .toISOString();

        run.error =
          error.message;


        if (
          activeRunId ===
          runId
        ) {

          activeRunId =
            null;
        }
      }
    );


    child.on(
      "close",
      code => {

        run.exitCode =
          code;


        run.finishedAt =
          new Date()
            .toISOString();


        run.status =
          code === 0
            ? "completed"
            : "failed";


        if (
          activeRunId ===
          runId
        ) {

          activeRunId =
            null;
        }
      }
    );


    return res
      .status(202)
      .json({

        runId,

        status:
          run.status,

        message:
          "Автоматизированная сделка запущена",

        statusUrl:
          `/api/automation/deals/${runId}`,

        resultsUrl:
          `/api/automation/deals/${runId}/results`,

        logsUrl:
          `/api/automation/deals/${runId}/logs`,
      });
  }
);


// ============================================================
// AUTOMATION LIST
// ============================================================

app.get(
  "/api/automation/deals",
  (req, res) => {

    const items =
      Array.from(
        runs.values()
      )
      .map(
        run => ({

          runId:
            run.runId,

          status:
            run.status,

          startedAt:
            run.startedAt,

          finishedAt:
            run.finishedAt,

          exitCode:
            run.exitCode,

          logsCount:
            run.logs.length,
        })
      )
      .reverse();


    res.json(
      items
    );
  }
);


// ============================================================
// AUTOMATION STATUS
// ============================================================

app.get(
  "/api/automation/deals/:runId",
  (req, res) => {

    const run =
      runs.get(
        req.params.runId
      );


    if (!run) {

      return res
        .status(404)
        .json({

          success: false,

          error:
            "run_not_found",

          message:
            "Запуск автоматизации не найден",
        });
    }


    return res.json({

      runId:
        run.runId,

      status:
        run.status,

      startedAt:
        run.startedAt,

      finishedAt:
        run.finishedAt,

      exitCode:
        run.exitCode,

      error:
        run.error ||
        null,

      logsCount:
        run.logs.length,

      resultsUrl:
        `/api/automation/deals/${run.runId}/results`,

      logsUrl:
        `/api/automation/deals/${run.runId}/logs`,
    });
  }
);


// ============================================================
// AUTOMATION RESULTS
// ============================================================

app.get(
  "/api/automation/deals/:runId/results",
  (req, res) => {

    const run =
      runs.get(
        req.params.runId
      );


    if (!run) {

      return res
        .status(404)
        .json({

          success: false,

          error:
            "run_not_found",

          message:
            "Запуск автоматизации не найден",
        });
    }


    if (
      run.status ===
        "running" ||

      run.status ===
        "starting"
    ) {

      return res
        .status(202)
        .json({

          runId:
            run.runId,

          status:
            run.status,

          message:
            "Автоматизированная сделка ещё выполняется",
        });
    }


    return res.json(
      parseAutomationResult(
        run
      )
    );
  }
);


// ============================================================
// AUTOMATION LOGS
// ============================================================

app.get(
  "/api/automation/deals/:runId/logs",
  (req, res) => {

    const run =
      runs.get(
        req.params.runId
      );


    if (!run) {

      return res
        .status(404)
        .json({

          success: false,

          error:
            "run_not_found",

          message:
            "Запуск автоматизации не найден",
        });
    }


    return res.json({

      runId:
        run.runId,

      status:
        run.status,

      logs:
        run.logs,
    });
  }
);


// ============================================================
// 03 — MANUAL DEAL FLOW
// ============================================================


// ============================================================
// STEP 01 — CREATE DEAL
// ============================================================

app.post(
  "/api/manual/deals",
  requireBlockchain,
  async (req, res) => {

    try {

      const {

        cadastralNumber,

        apartmentAddress,

        propertyDocumentHash,

        registryRecordId,

        priceEth,

        paymentTimeoutSeconds =
          3600,

      } = req.body;


      if (
        !cadastralNumber ||
        !apartmentAddress ||
        !propertyDocumentHash ||
        !registryRecordId ||
        !priceEth
      ) {

        return res
          .status(400)
          .json({

            success: false,

            error:
              "missing_fields",

            message:
              "Обязательные поля: " +
              "cadastralNumber, " +
              "apartmentAddress, " +
              "propertyDocumentHash, " +
              "registryRecordId, " +
              "priceEth",
          });
      }


      const nextDealId =
        await marketRead
          .nextDealId();


      const tx =
        await marketSeller
          .createDeal(

            String(
              cadastralNumber
            ),

            String(
              apartmentAddress
            ),

            String(
              propertyDocumentHash
            ),

            String(
              registryRecordId
            ),

            ethers.parseEther(
              String(
                priceEth
              )
            ),

            BigInt(
              paymentTimeoutSeconds
            )
          );


      const receipt =
        await tx.wait();


      const dealId =
        Number(
          nextDealId
        );


      const deal =
        await readManualDeal(
          dealId
        );


      return res
        .status(201)
        .json(

          transactionResponse(
            receipt,
            {

              message:
                "Сделка создана",

              dealId,

              deal,

              nextStep:
                `POST /api/manual/deals/${dealId}/seller-data`,
            }
          )
        );


    } catch (error) {

      console.error(
        "createDeal:",
        error
      );


      return res
        .status(500)
        .json({

          success: false,

          error:
            "create_deal_failed",

          message:
            errorMessage(
              error
            ),
        });
    }
  }
);


// ============================================================
// STEP 02 — SELLER DATA
// ============================================================

app.post(
  "/api/manual/deals/:dealId/seller-data",
  requireBlockchain,
  async (req, res) => {

    try {

      const dealId =
        Number(
          req.params.dealId
        );


      const {

        sellerFullName,

        sellerPassportHash,

      } = req.body;


      if (
        !Number.isInteger(
          dealId
        ) ||
        dealId < 0
      ) {

        return res
          .status(400)
          .json({

            success: false,

            error:
              "invalid_deal_id",

            message:
              "Некорректный dealId",
          });
      }


      if (
        !sellerFullName ||
        !sellerPassportHash
      ) {

        return res
          .status(400)
          .json({

            success: false,

            error:
              "missing_fields",

            message:
              "sellerFullName и sellerPassportHash обязательны",
          });
      }


      const tx =
        await marketSeller
          .submitSellerData(

            dealId,

            String(
              sellerFullName
            ),

            String(
              sellerPassportHash
            )
          );


      const receipt =
        await tx.wait();


      const deal =
        await readManualDeal(
          dealId
        );


      return res.json(

        transactionResponse(
          receipt,
          {

            message:
              "Данные продавца отправлены. Oracle проверяет владельца.",

            dealId,

            deal,

            nextStep:
              `GET /api/manual/deals/${dealId}/stage`,

            expectedStage: {

              stage: 2,

              stageName:
                "SellerVerified",
            },
          }
        )
      );


    } catch (error) {

      console.error(
        "submitSellerData:",
        error
      );


      return res
        .status(500)
        .json({

          success: false,

          error:
            "seller_data_failed",

          message:
            errorMessage(
              error
            ),
        });
    }
  }
);
// ============================================================
// DYNAAPP — SELLER DATA VIA BODY
// ============================================================

app.post(
  "/api/manual/seller-data",
  requireBlockchain,
  async (req, res) => {
    try {
      const {
        dealId,
        sellerFullName,
        sellerPassportHash,
      } = req.body;

      const parsedDealId = Number(dealId);

      if (
        !Number.isInteger(parsedDealId) ||
        parsedDealId < 0
      ) {
        return res.status(400).json({
          success: false,
          error: "invalid_deal_id",
          message: "Некорректный dealId",
        });
      }

      if (
        !sellerFullName ||
        !sellerPassportHash
      ) {
        return res.status(400).json({
          success: false,
          error: "missing_fields",
          message:
            "sellerFullName и sellerPassportHash обязательны",
        });
      }

      const tx =
        await marketSeller.submitSellerData(
          parsedDealId,
          String(sellerFullName),
          String(sellerPassportHash)
        );

      const receipt = await tx.wait();

      const deal =
        await readManualDeal(parsedDealId);

      return res.json(
        transactionResponse(
          receipt,
          {
            message:
              "Данные продавца отправлены. Oracle проверяет владельца.",

            dealId: parsedDealId,

            deal,

            nextStep:
              `GET /api/manual/deals/${parsedDealId}/stage`,

            expectedStage: {
              stage: 2,
              stageName: "SellerVerified",
            },
          }
        )
      );

    } catch (error) {
      console.error(
        "submitSellerDataFromBody:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "seller_data_failed",
        message: errorMessage(error),
      });
    }
  }
);
// ============================================================
// DYNAAPP — CHECK DEAL STAGE VIA BODY
// ============================================================

app.post(
  "/api/manual/stage",
  requireBlockchain,
  async (req, res) => {
    try {
      const dealId = Number(req.body.dealId);

      if (
        !Number.isInteger(dealId) ||
        dealId < 0
      ) {
        return res.status(400).json({
          success: false,
          error: "invalid_deal_id",
          message: "Некорректный dealId",
        });
      }

      const deal = await readManualDeal(dealId);

      return res.json({
        success: true,
        dealId,
        stage: deal.stage,
        stageName: deal.stageName,
        lastOracleError: deal.lastOracleError,
        deal,
      });

    } catch (error) {
      console.error("checkStageFromBody:", error);

      return res.status(500).json({
        success: false,
        error: "stage_check_failed",
        message: errorMessage(error),
      });
    }
  }
);
// ============================================================
// DYNAAPP — BUYER DATA VIA BODY
// ============================================================

app.post(
  "/api/manual/buyer-data",
  requireBlockchain,
  async (req, res) => {
    try {
      const {
        dealId,
        buyerFullName,
        buyerPassportHash,
      } = req.body;

      const parsedDealId = Number(dealId);

      if (
        !Number.isInteger(parsedDealId) ||
        parsedDealId < 0
      ) {
        return res.status(400).json({
          success: false,
          error: "invalid_deal_id",
          message: "Некорректный dealId",
        });
      }

      if (
        !buyerFullName ||
        !buyerPassportHash
      ) {
        return res.status(400).json({
          success: false,
          error: "missing_fields",
          message:
            "buyerFullName и buyerPassportHash обязательны",
        });
      }

      const tx =
        await marketBuyer.submitBuyerData(
          parsedDealId,
          String(buyerFullName),
          String(buyerPassportHash)
        );

      const receipt = await tx.wait();

      const deal =
        await readManualDeal(parsedDealId);

      return res.json(
        transactionResponse(
          receipt,
          {
            message:
              "Данные покупателя отправлены. Oracle проверяет покупателя.",

            dealId: parsedDealId,

            deal,

            nextStep:
              "Проверить стадию сделки",

            expectedStage: {
              stage: 4,
              stageName: "BuyerVerified",
            },
          }
        )
      );

    } catch (error) {
      console.error(
        "submitBuyerDataFromBody:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "buyer_data_failed",
        message: errorMessage(error),
      });
    }
  }
);
// ============================================================
// DYNAAPP — PAYMENT VIA BODY
// ============================================================

app.post(
  "/api/manual/payment",
  requireBlockchain,
  async (req, res) => {
    try {
      const {
        dealId,
        amountEth,
      } = req.body;

      const parsedDealId = Number(dealId);

      if (
        !Number.isInteger(parsedDealId) ||
        parsedDealId < 0
      ) {
        return res.status(400).json({
          success: false,
          error: "invalid_deal_id",
          message: "Некорректный dealId",
        });
      }

      if (!amountEth) {
        return res.status(400).json({
          success: false,
          error: "missing_amount",
          message: "amountEth обязателен",
        });
      }

      const tx =
        await marketBuyer.reservePayment(
          parsedDealId,
          {
            value: ethers.parseEther(
              String(amountEth)
            ),
          }
        );

      const receipt = await tx.wait();

      const deal =
        await readManualDeal(parsedDealId);

      return res.json(
        transactionResponse(
          receipt,
          {
            message:
              "Оплата внесена в escrow",

            dealId: parsedDealId,

            deal,

            expectedStage: {
              stage: 5,
              stageName: "PaymentReceived",
            },
          }
        )
      );

    } catch (error) {
      console.error(
        "paymentFromBody:",
        error
      );

      return res.status(500).json({
        success: false,
        error: "payment_failed",
        message: errorMessage(error),
      });
    }
  }
);
// ============================================================
// DYNAAPP — WAIT SELLER VERIFICATION
// ============================================================
// ============================================================
// DYNAAPP — WAIT BUYER VERIFICATION
// ============================================================

app.post(
  "/api/manual/wait-buyer-verification",
  requireBlockchain,
  async (req, res) => {
    try {
      const dealId = Number(req.body.dealId);

      if (!Number.isInteger(dealId) || dealId < 0) {
        return res.status(400).json({
          success: false,
          verified: false,
          error: "invalid_deal_id",
          message: "Некорректный dealId",
        });
      }

      const timeoutMs = 90000;
      const intervalMs = 2000;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const deal = await readManualDeal(dealId);

        if (deal.stage === 4) {
          return res.json({
            success: true,
            verified: true,
            dealId,
            stage: deal.stage,
            stageName: deal.stageName,
            deal,
          });
        }

        if (deal.lastOracleError) {
          return res.json({
            success: false,
            verified: false,
            dealId,
            stage: deal.stage,
            stageName: deal.stageName,
            lastOracleError: deal.lastOracleError,
            deal,
          });
        }

        await new Promise(resolve =>
          setTimeout(resolve, intervalMs)
        );
      }

      const deal = await readManualDeal(dealId);

      return res.json({
        success: false,
        verified: false,
        dealId,
        stage: deal.stage,
        stageName: deal.stageName,
        lastOracleError:
          deal.lastOracleError ||
          "Истекло время ожидания проверки покупателя",
        deal,
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        verified: false,
        error: "buyer_verification_wait_failed",
        message: errorMessage(error),
      });
    }
  }
);


// ============================================================
// DYNAAPP — SELLER CONFIRM ESCROW VIA BODY
// ============================================================

app.post(
  "/api/manual/confirm-escrow",
  requireBlockchain,
  async (req, res) => {
    try {
      const dealId = Number(req.body.dealId);

      if (!Number.isInteger(dealId) || dealId < 0) {
        return res.status(400).json({
          success: false,
          error: "invalid_deal_id",
          message: "Некорректный dealId",
        });
      }

      const tx =
        await marketSeller
          .sellerConfirmEscrowAndRequestRegistry(dealId);

      const receipt = await tx.wait();
      const deal = await readManualDeal(dealId);

      return res.json(
        transactionResponse(receipt, {
          message:
            "Escrow подтверждён продавцом. Запрос в реестр инициирован.",
          dealId,
          deal,
        })
      );

    } catch (error) {
      return res.status(500).json({
        success: false,
        error: "confirm_escrow_failed",
        message: errorMessage(error),
      });
    }
  }
);


// ============================================================
// DYNAAPP — WAIT REGISTRY REQUEST
// ============================================================

app.post(
  "/api/manual/wait-registry-request",
  requireBlockchain,
  async (req, res) => {
    try {
      const dealId = Number(req.body.dealId);

      if (!Number.isInteger(dealId) || dealId < 0) {
        return res.status(400).json({
          success: false,
          found: false,
          error: "invalid_deal_id",
          message: "Некорректный dealId",
        });
      }

      const timeoutMs = 90000;
      const intervalMs = 2000;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const response =
          await fetch(
            `${REGISTRY_API_URL}/transfer-requests`
          );

        if (response.ok) {
          const data = await response.json();

          const request =
            (data.requests || []).find(
              item =>
                String(item.dealId) ===
                String(dealId)
            );

          if (request) {
            return res.json({
              success: true,
              found: true,
              dealId,
              registryRequestId: request.id,
              registryStatus: request.status,
              request,
            });
          }
        }

        await new Promise(resolve =>
          setTimeout(resolve, intervalMs)
        );
      }

      return res.json({
        success: false,
        found: false,
        dealId,
        message:
          "Истекло время ожидания заявки в Registry",
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        found: false,
        error: "registry_request_wait_failed",
        message: errorMessage(error),
      });
    }
  }
);


// ============================================================
// DYNAAPP — APPROVE REGISTRY REQUEST
// ============================================================

app.post(
  "/api/manual/approve-registry-request",
  async (req, res) => {
    try {
      const {
        registryRequestId,
        email,
        passport,
      } = req.body;

      if (
        !registryRequestId ||
        !email ||
        !passport
      ) {
        return res.status(400).json({
          success: false,
          error: "missing_fields",
          message:
            "registryRequestId, email и passport обязательны",
        });
      }

      const response =
        await fetch(
          `${REGISTRY_API_URL}/transfer-requests/${registryRequestId}/approve`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              email,
              passport,
            }),
          }
        );

      const data = await response.json();

      if (!response.ok) {
        return res.status(response.status).json({
          success: false,
          error: "registry_approval_failed",
          registryResponse: data,
        });
      }

      return res.json({
        success: true,
        approved: true,
        registryRequestId,
        request: data.request,
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        approved: false,
        error: "registry_approval_failed",
        message: errorMessage(error),
      });
    }
  }
);


// ============================================================
// DYNAAPP — WAIT OWNERSHIP TRANSFER
// ============================================================

app.post(
  "/api/manual/wait-ownership-transfer",
  async (req, res) => {
    try {
      const { registryRequestId } = req.body;

      if (!registryRequestId) {
        return res.status(400).json({
          success: false,
          transferred: false,
          error: "missing_registry_request_id",
        });
      }

      const timeoutMs = 90000;
      const intervalMs = 2000;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const response =
          await fetch(
            `${REGISTRY_API_URL}/transfer-requests/${registryRequestId}`
          );

        if (response.ok) {
          const data = await response.json();
          const request = data.request;

          if (
            request.status ===
            "OWNERSHIP_TRANSFERRED"
          ) {
            return res.json({
              success: true,
              transferred: true,
              registryRequestId,
              newRegistryId:
                request.newRegistryId,
              request,
            });
          }

          if (request.status === "REJECTED") {
            return res.json({
              success: false,
              transferred: false,
              registryRequestId,
              error: "registry_rejected",
              message:
                request.rejectReason ||
                "Registry отклонил переход права",
              request,
            });
          }
        }

        await new Promise(resolve =>
          setTimeout(resolve, intervalMs)
        );
      }

      return res.json({
        success: false,
        transferred: false,
        registryRequestId,
        message:
          "Истекло время ожидания перехода права собственности",
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        transferred: false,
        error: "ownership_transfer_wait_failed",
        message: errorMessage(error),
      });
    }
  }
);


// ============================================================
// DYNAAPP — WAIT FINAL DEAL COMPLETION
// ============================================================

app.post(
  "/api/manual/wait-completed",
  requireBlockchain,
  async (req, res) => {
    try {
      const dealId = Number(req.body.dealId);

      if (!Number.isInteger(dealId) || dealId < 0) {
        return res.status(400).json({
          success: false,
          completed: false,
          error: "invalid_deal_id",
        });
      }

      const timeoutMs = 90000;
      const intervalMs = 2000;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const deal = await readManualDeal(dealId);

        if (deal.stage === 8) {
          return res.json({
            success: true,
            completed: true,
            dealId,
            stage: 8,
            stageName: "Completed",
            deal,
          });
        }

        if (
          deal.stage === 9 ||
          deal.lastOracleError
        ) {
          return res.json({
            success: false,
            completed: false,
            dealId,
            stage: deal.stage,
            stageName: deal.stageName,
            lastOracleError:
              deal.lastOracleError,
            deal,
          });
        }

        await new Promise(resolve =>
          setTimeout(resolve, intervalMs)
        );
      }

      const deal = await readManualDeal(dealId);

      return res.json({
        success: false,
        completed: false,
        dealId,
        stage: deal.stage,
        stageName: deal.stageName,
        message:
          "Истекло время ожидания завершения сделки",
        deal,
      });

    } catch (error) {
      return res.status(500).json({
        success: false,
        completed: false,
        error: "completion_wait_failed",
        message: errorMessage(error),
      });
    }
  }
);
app.post(
  "/api/manual/wait-seller-verification",
  requireBlockchain,
  async (req, res) => {
    try {
      const dealId = Number(req.body.dealId);

      if (
        !Number.isInteger(dealId) ||
        dealId < 0
      ) {
        return res.status(400).json({
          success: false,
          error: "invalid_deal_id",
          message: "Некорректный dealId",
        });
      }

      const timeoutMs = 90000;
      const intervalMs = 2000;
      const startedAt = Date.now();

      while (Date.now() - startedAt < timeoutMs) {
        const deal = await readManualDeal(dealId);

        if (deal.stage === 2) {
          return res.json({
            success: true,
            verified: true,
            dealId,
            stage: deal.stage,
            stageName: deal.stageName,
            lastOracleError: deal.lastOracleError,
            deal,
          });
        }

        if (deal.lastOracleError) {
          return res.json({
            success: false,
            verified: false,
            dealId,
            stage: deal.stage,
            stageName: deal.stageName,
            lastOracleError: deal.lastOracleError,
            deal,
          });
        }

        await new Promise(
          resolve => setTimeout(resolve, intervalMs)
        );
      }

      const deal = await readManualDeal(dealId);

      return res.json({
        success: false,
        verified: false,
        dealId,
        stage: deal.stage,
        stageName: deal.stageName,
        lastOracleError:
          deal.lastOracleError ||
          "Истекло время ожидания проверки продавца",
        deal,
      });

    } catch (error) {
      console.error(
        "waitSellerVerification:",
        error
      );

      return res.status(500).json({
        success: false,
        verified: false,
        error: "seller_verification_wait_failed",
        message: errorMessage(error),
      });
    }
  }
);
// ============================================================
// CHECK CURRENT STAGE
// ============================================================

app.get(
  "/api/manual/deals/:dealId/stage",
  requireBlockchain,
  async (req, res) => {

    try {

      const dealId =
        Number(
          req.params.dealId
        );


      const deal =
        await readManualDeal(
          dealId
        );


      return res.json({

        success: true,

        dealId,

        stage:
          deal.stage,

        stageName:
          deal.stageName,

        lastOracleError:
          deal.lastOracleError,

        registryRecordId:
          deal.registryRecordId,

        newRegistryRecordId:
          deal.newRegistryRecordId,
      });


    } catch (error) {

      return res
        .status(500)
        .json({

          success: false,

          error:
            "read_stage_failed",

          message:
            errorMessage(
              error
            ),
        });
    }
  }
);


// ============================================================
// STEP 04 — BUYER DATA
// ============================================================

app.post(
  "/api/manual/deals/:dealId/buyer-data",
  requireBlockchain,
  async (req, res) => {

    try {

      const dealId =
        Number(
          req.params.dealId
        );


      const {

        buyerFullName,

        buyerPassportHash,

      } = req.body;


      if (
        !buyerFullName ||
        !buyerPassportHash
      ) {

        return res
          .status(400)
          .json({

            success: false,

            error:
              "missing_fields",

            message:
              "buyerFullName и buyerPassportHash обязательны",
          });
      }


      const tx =
        await marketBuyer
          .submitBuyerData(

            dealId,

            String(
              buyerFullName
            ),

            String(
              buyerPassportHash
            )
          );


      const receipt =
        await tx.wait();


      const deal =
        await readManualDeal(
          dealId
        );


      return res.json(

        transactionResponse(
          receipt,
          {

            message:
              "Данные покупателя отправлены. Oracle проверяет покупателя.",

            dealId,

            deal,

            nextStep:
              `GET /api/manual/deals/${dealId}/stage`,

            expectedStage: {

              stage: 4,

              stageName:
                "BuyerVerified",
            },
          }
        )
      );


    } catch (error) {

      console.error(
        "submitBuyerData:",
        error
      );


      return res
        .status(500)
        .json({

          success: false,

          error:
            "buyer_data_failed",

          message:
            errorMessage(
              error
            ),
        });
    }
  }
);


// ============================================================
// STEP 06 — PAYMENT
// ============================================================

app.post(
  "/api/manual/deals/:dealId/payment",
  requireBlockchain,
  async (req, res) => {

    try {

      const dealId =
        Number(
          req.params.dealId
        );


      const dealBefore =
        await readManualDeal(
          dealId
        );


      const amountWei =
        req.body.amountEth

          ? ethers.parseEther(
              String(
                req.body.amountEth
              )
            )

          : BigInt(
              dealBefore.priceWei
            );


      const tx =
        await marketBuyer
          .reservePayment(

            dealId,

            {
              value:
                amountWei,
            }
          );


      const receipt =
        await tx.wait();


      const deal =
        await readManualDeal(
          dealId
        );


      return res.json(

        transactionResponse(
          receipt,
          {

            message:
              "Оплата внесена в escrow",

            dealId,

            amountWei:
              amountWei
                .toString(),

            amountEth:
              ethers.formatEther(
                amountWei
              ),

            deal,

            nextStep:
              `POST /api/manual/deals/${dealId}/confirm-escrow`,
          }
        )
      );


    } catch (error) {

      console.error(
        "reservePayment:",
        error
      );


      return res
        .status(500)
        .json({

          success: false,

          error:
            "payment_failed",

          message:
            errorMessage(
              error
            ),
        });
    }
  }
);


// ============================================================
// STEP 08 — SELLER CONFIRM ESCROW
// ============================================================

app.post(
  "/api/manual/deals/:dealId/confirm-escrow",
  requireBlockchain,
  async (req, res) => {

    try {

      const dealId =
        Number(
          req.params.dealId
        );


      const tx =
        await marketSeller
          .sellerConfirmEscrowAndRequestRegistry(
            dealId
          );


      const receipt =
        await tx.wait();


      const deal =
        await readManualDeal(
          dealId
        );


      return res.json(

        transactionResponse(
          receipt,
          {

            message:
              "Escrow подтверждён продавцом. Запрос в реестр инициирован.",

            dealId,

            deal,

            nextStep:
              "GET /transfer-requests в Mock Registry",
          }
        )
      );


    } catch (error) {

      console.error(
        "sellerConfirmEscrow:",
        error
      );


      return res
        .status(500)
        .json({

          success: false,

          error:
            "confirm_escrow_failed",

          message:
            errorMessage(
              error
            ),
        });
    }
  }
);


// ============================================================
// FULL DEAL INFO
// ============================================================

app.get(
  "/api/manual/deals/:dealId",
  requireBlockchain,
  async (req, res) => {

    try {

      const dealId =
        Number(
          req.params.dealId
        );


      const deal =
        await readManualDeal(
          dealId
        );


      return res.json({

        success: true,

        deal,
      });


    } catch (error) {

      return res
        .status(500)
        .json({

          success: false,

          error:
            "read_deal_failed",

          message:
            errorMessage(
              error
            ),
        });
    }
  }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  () => {

    console.log(
      `\n🚀 Automation Backend: http://localhost:${PORT}`
    );


    console.log(
      "\nAUTOMATED E2E:"
    );

    console.log(
      "POST /api/automation/deals"
    );

    console.log(
      "GET  /api/automation/deals/:runId"
    );

    console.log(
      "GET  /api/automation/deals/:runId/results"
    );

    console.log(
      "GET  /api/automation/deals/:runId/logs"
    );


    console.log(
      "\nMANUAL DEAL FLOW:"
    );

    console.log(
      "POST /api/manual/deals"
    );

    console.log(
      "POST /api/manual/deals/:dealId/seller-data"
    );

    console.log(
      "GET  /api/manual/deals/:dealId/stage"
    );

    console.log(
      "POST /api/manual/deals/:dealId/buyer-data"
    );

    console.log(
      "POST /api/manual/deals/:dealId/payment"
    );

    console.log(
      "POST /api/manual/deals/:dealId/confirm-escrow"
    );

    console.log(
      "GET  /api/manual/deals/:dealId"
    );
  }
);