import fs from "fs";
import path from "path";
import { ethers } from "ethers";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

const artifactPath = path.join(
  rootDir,
  "artifacts/contracts/RealEstatePurchase.sol/RealEstatePurchase.json"
);

const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));

const provider = new ethers.JsonRpcProvider("http://127.0.0.1:8545");

const deployer = await provider.getSigner(0);

const BUYER = "0x70997970C51812dc3A010C7d01b50e0d17dc79C8";
const SELLER = "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266";
const ORACLE = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";

const CADASTRAL_NUMBER = "77:01:0004012:1056";
const APARTMENT_ADDRESS = "г. Екатеринбург, ул. Щербакова, д. 4, квартира 12";
const PRICE = ethers.parseEther("1");

console.log("Deploying RealEstatePurchase...");
console.log("Deployer:", await deployer.getAddress());
console.log("Buyer:", BUYER);
console.log("Seller:", SELLER);
console.log("Oracle:", ORACLE);

const factory = new ethers.ContractFactory(
  artifact.abi,
  artifact.bytecode,
  deployer
);

const contract = await factory.deploy(
  BUYER,
  SELLER,
  ORACLE,
  CADASTRAL_NUMBER,
  APARTMENT_ADDRESS,
  PRICE
);

await contract.waitForDeployment();

const contractAddress = await contract.getAddress();

console.log("");
console.log("RealEstatePurchase deployed to:");
console.log(contractAddress);
console.log("");
console.log("Paste this address into frontend/src/contractConfig.js");
