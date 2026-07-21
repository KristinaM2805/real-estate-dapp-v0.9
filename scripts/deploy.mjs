import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const deployer = await provider.getSigner(0);

console.log("🚀 Начинаем деплой...");
console.log("📡 Деплоер:", await deployer.getAddress());

// 1. Деплой PropertyOracle
console.log("\n📦 Деплой PropertyOracle...");
const oracleArtifactPath = path.join(
  rootDir,
  "artifacts/contracts/PropertyOracle.sol/PropertyOracle.json"
);
const oracleArtifact = JSON.parse(fs.readFileSync(oracleArtifactPath, "utf8"));

// Проверяем конструктор
const OracleFactory = new ethers.ContractFactory(
  oracleArtifact.abi,
  oracleArtifact.bytecode,
  deployer
);

// Если конструктор требует аргументы - передаём их
// Например, если нужен адрес доверенного исполнителя:
const trustedFulfiller = await deployer.getAddress();
const oracle = await OracleFactory.deploy(trustedFulfiller);
// Если конструктор без аргументов, то:
// const oracle = await OracleFactory.deploy();

await oracle.waitForDeployment();
const oracleAddress = await oracle.getAddress();
console.log(`✅ PropertyOracle: ${oracleAddress}`);

// 2. Деплой RealEstateMarket
console.log("\n📦 Деплой RealEstateMarket...");
const marketArtifactPath = path.join(
  rootDir,
  "artifacts/contracts/RealEstateMarket.sol/RealEstateMarket.json"
);
const marketArtifact = JSON.parse(fs.readFileSync(marketArtifactPath, "utf8"));
const MarketFactory = new ethers.ContractFactory(
  marketArtifact.abi,
  marketArtifact.bytecode,
  deployer
);

// RealEstateMarket ожидает адрес оракула
const market = await MarketFactory.deploy(oracleAddress);
await market.waitForDeployment();
const marketAddress = await market.getAddress();
console.log(`✅ RealEstateMarket: ${marketAddress}`);

console.log("\n🎉 Деплой завершён!");
console.log("\n📋 Адреса:");
console.log(`ORACLE_ADDRESS=${oracleAddress}`);
console.log(`MARKET_ADDRESS=${marketAddress}`);