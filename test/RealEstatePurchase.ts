import { expect } from "chai";
import { network } from "hardhat";

const { ethers } = await network.create();

describe("RealEstatePurchase", function () {
  it("should complete the deal after oracle checks buyer name in contract line", async function () {
    const [, buyer, seller, oracle] = await ethers.getSigners();

    const price = ethers.parseEther("1");
    const buyerName = "Kristina Maykushina";

    const contract = await ethers.deployContract("RealEstatePurchase", [
      await buyer.getAddress(),
      await seller.getAddress(),
      await oracle.getAddress(),
      "77:01:0004012:1056",
      "г. Екатеринбург, ул. Щербакова, д. 4, квартира 12",
      price,
    ]);

    await expect(contract.connect(buyer).buyerFillOwnershipLine(buyerName))
      .to.emit(contract, "BuyerNameFilled");

    await expect(contract.connect(seller).sellerSign())
      .to.emit(contract, "ContractSigned")
      .withArgs(await seller.getAddress(), "Seller");

    await expect(contract.connect(buyer).buyerSign())
      .to.emit(contract, "ContractSigned")
      .withArgs(await buyer.getAddress(), "Buyer");

    await expect(contract.connect(buyer).deposit({ value: price }))
      .to.emit(contract, "FundsDeposited")
      .withArgs(await buyer.getAddress(), price);

    await expect(contract.connect(oracle).oracleCheckContractLine(buyerName))
      .to.emit(contract, "FundsReleased");

    const mainInfo = await contract.getMainInfo();
    const documentInfo = await contract.getDocumentInfo();

    expect(mainInfo[3]).to.equal(await buyer.getAddress());

    // Completed = 5
    expect(mainInfo[5]).to.equal(5n);

    // После завершения escrow пустой
    expect(mainInfo[6]).to.equal(0n);

    expect(documentInfo[0]).to.equal(buyerName);
    expect(documentInfo[1]).to.equal(`New owner: ${buyerName}`);
    expect(documentInfo[2]).to.equal(true); // sellerSigned
    expect(documentInfo[3]).to.equal(true); // buyerSigned
    expect(documentInfo[4]).to.equal(true); // ownershipDocumentSent
  });

  it("should reject contract line check from non-oracle account", async function () {
    const [, buyer, seller, oracle] = await ethers.getSigners();

    const price = ethers.parseEther("1");
    const buyerName = "Kristina Maykushina";

    const contract = await ethers.deployContract("RealEstatePurchase", [
      await buyer.getAddress(),
      await seller.getAddress(),
      await oracle.getAddress(),
      "77:01:0004012:1056",
      "г. Екатеринбург, ул. Щербакова, д. 4, квартира 12",
      price,
    ]);

    await contract.connect(buyer).buyerFillOwnershipLine(buyerName);
    await contract.connect(seller).sellerSign();
    await contract.connect(buyer).buyerSign();
    await contract.connect(buyer).deposit({ value: price });

    await expect(
      contract.connect(seller).oracleCheckContractLine(buyerName)
    ).to.be.revertedWith("Only oracle can do this");
  });
});