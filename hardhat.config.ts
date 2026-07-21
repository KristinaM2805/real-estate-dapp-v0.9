import "dotenv/config";
import { defineConfig, configVariable } from "hardhat/config";
import hardhatToolboxMochaEthers from "@nomicfoundation/hardhat-toolbox-mocha-ethers";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthers],

  solidity: {
  profiles: {
    default: {
      version: "0.8.28",
      settings: {
        optimizer: { enabled: true, runs: 200 },
        viaIR: true,
      },
    },
    production: {
      version: "0.8.28",
      settings: {
        optimizer: { enabled: true, runs: 200 },
        viaIR: true,
      },
    },
  },
},

  networks: {
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("PRIVATE_KEY")],
    },
    docker: {
      type: "http",
      chainType: "l1",
      url: "http://hardhat-node:8545",
      chainId: 31337,
    },

    hardhat: {
      type: "edr-simulated",
      chainType: "l1",
      chainId: 31337,
    },

    localhost: {
      type: "http",
      chainType: "l1",
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
  },
});