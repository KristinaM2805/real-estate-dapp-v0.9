<div align="center">

# 🏡 Real Estate DApp

### Decentralized Real Estate Transaction Platform

Secure real estate transactions powered by **Ethereum Smart Contracts**, **Oracle Verification**, and **React**.

![Solidity](https://img.shields.io/badge/Solidity-0.8.28-363636?logo=solidity)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Hardhat](https://img.shields.io/badge/Hardhat-3.0-F7DF1E)
![Node.js](https://img.shields.io/badge/Node.js-22-339933?logo=node.js)
![License](https://img.shields.io/badge/License-Educational-blue)

</div>

---

# 📖 About

**Real Estate DApp** is a decentralized web application that demonstrates a secure real estate transaction using Ethereum smart contracts.

Unlike traditional escrow services, the application automatically executes transaction stages through smart contracts and verifies participants using an Oracle service that simulates interaction with government registries.

The project was developed as part of a university graduation project.

---

# ✨ Features

- 🔐 Wallet connection via MetaMask
- 📄 Creation of real estate transactions
- 👤 Seller verification
- 👥 Buyer verification
- 🤖 Oracle integration
- 🏛 Government registry simulation
- 💰 Escrow payment mechanism
- 🔑 Ownership transfer
- ⛓ Recording completed transactions on blockchain
- 🎬 Interactive visualization of every transaction stage

---

# ⚙ Technology Stack

### Frontend

- React
- JavaScript
- Vite
- HTML5 Canvas
- CSS3
- ethers.js

### Blockchain

- Solidity
- Hardhat
- Ethereum
- MetaMask

### Backend

- Node.js
- Express
- Oracle Backend

---

# 🚀 Transaction Workflow

1. Seller creates a transaction.
2. Seller submits property information.
3. Smart contract requests seller verification.
4. Oracle verifies ownership through registry.
5. Buyer submits personal information.
6. Oracle verifies buyer identity.
7. Buyer deposits funds into escrow.
8. Ownership is transferred.
9. Seller receives payment.
10. Buyer receives ownership and keys.
11. Transaction is permanently stored on blockchain.

---

# 📂 Project Structure

```
real-estate-dapp/

├── contracts/
│   ├── PropertyOracle.sol
│   └── RealEstateMarket.sol
│
├── frontend/
│   ├── public/
│   ├── src/
│   └── package.json
│
├── oracle-backend/
│   ├── server.mjs
│   └── package.json
│
├── scripts/
├── ignition/
└── hardhat.config.ts
```

---

# ▶ Running the Project

## 1. Install dependencies

```bash
npm install
```

Frontend

```bash
cd frontend
npm install
```

Oracle

```bash
cd oracle-backend
npm install
```

---

## 2. Start Hardhat

```bash
npx hardhat node
```

---

## 3. Deploy contracts

```bash
npx hardhat ignition deploy ignition/modules/RealEstateMarket.ts --network localhost
```

---

## 4. Start Oracle Backend

```bash
cd oracle-backend

node server.mjs
```

---

## 5. Start Frontend

```bash
cd frontend

npm run dev
```

---

# 🖼 Demo

The application visualizes every stage of a real estate transaction:

- property information submission;
- Oracle verification;
- government registry interaction;
- escrow payment;
- ownership transfer;
- blockchain recording.

---

# 📌 Future Improvements

- Deployment to Ethereum Sepolia testnet
- Online Oracle backend
- IPFS document storage
- Digital signatures
- NFT property certificates
- Multi-property support
- Government API integration

---

# 👩‍💻 Author

**Kristina Miakushina**

2026

---

# 📄 License

This project was created for educational and research purposes.
```shell
npx hardhat ignition deploy --network sepolia ignition/modules/Counter.ts
```
