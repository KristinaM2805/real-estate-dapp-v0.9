import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const CONTRACT_ADDRESS = "0x5FbDB2315678afecb367f032d93F642f64180aa3";

const ORACLE = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const artifactPath = path.join(
  rootDir,
  "artifacts/contracts/RealEstatePurchase.sol/RealEstatePurchase.json"
);

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");
const oracleSigner = await provider.getSigner(ORACLE);

const contract = new ethers.Contract(
  CONTRACT_ADDRESS,
  artifact.abi,
  oracleSigner
);

const mainInfoBefore = await contract.getMainInfo();
const documentInfoBefore = await contract.getDocumentInfo();

console.log("Текущий этап:", Number(mainInfoBefore[5]));
console.log("Баланс escrow:", ethers.formatEther(mainInfoBefore[6]), "ETH");
console.log("ФИО покупателя:", documentInfoBefore[0]);
console.log("Строка договора:", documentInfoBefore[1]);
console.log("Продавец подписал:", documentInfoBefore[2]);
console.log("Покупатель подписал:", documentInfoBefore[3]);

console.log("");
console.log("Оракул проверяет строку договора...");

const buyerName = documentInfoBefore[0];

const tx = await contract.oracleCheckContractLine(buyerName);
await tx.wait();

console.log("Сделка завершена.");

const mainInfoAfter = await contract.getMainInfo();
const documentInfoAfter = await contract.getDocumentInfo();

console.log("");
console.log("Новый владелец:", mainInfoAfter[3]);
console.log("Новый этап:", Number(mainInfoAfter[5]));
console.log("Баланс escrow:", ethers.formatEther(mainInfoAfter[6]), "ETH");
console.log("Договор отправлен покупателю:", documentInfoAfter[4]);