// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title PropertyOracle
 * @notice Оракул реестра недвижимости.
 *
 * Схема работы:
 *  1. Смарт-контракт сделки вызывает requestSellerVerification / requestBuyerVerification
 *     / requestRegistryTransfer.
 *  2. Оракул эмитирует VerificationRequest / RegistryTransferRequest — off-chain backend
 *     слушает события, идёт в реестр, затем вызывает fulfilSellerVerification /
 *     fulfilBuyerVerification / fulfilRegistryTransfer обратно в контракт.
 *  3. Оракул передаёт результат в сделку через интерфейс IDealCallback.
 *
 * В продакшн роль fulfiller играет Chainlink Any API или собственный keeper.
 * Здесь fulfiller = trustedFulfiller (адрес oracle-backend/server.mjs).
 */

interface IDealCallback {
    function onSellerVerified(uint256 dealId, bool success, string calldata reason) external;
    function onBuyerVerified(uint256 dealId, bool success, string calldata reason) external;
    function onRegistryTransferConfirmed(uint256 dealId, bool success, string calldata newRegistryId) external;
}

contract PropertyOracle {
    address public immutable owner;
    address public trustedFulfiller;

    struct PendingRequest {
        address dealContract;
        uint256 dealId;
        RequestType reqType;
        bool fulfilled;
    }

    enum RequestType { SellerVerification, BuyerVerification, RegistryTransfer }

    uint256 public nextRequestId;
    mapping(uint256 => PendingRequest) public requests;

    event VerificationRequest(
        uint256 indexed requestId,
        uint256 indexed dealId,
        address indexed dealContract,
        RequestType reqType,
        string cadastralNumber,
        string subjectAddress,
        string fullName
    );

    event RegistryTransferRequest(
        uint256 indexed requestId,
        uint256 indexed dealId,
        address indexed dealContract,
        string cadastralNumber,
        string sellerFullName,
        string buyerFullName,
        uint256 priceWei
    );

    event RequestFulfilled(uint256 indexed requestId, bool success);

    modifier onlyOwner() {
        require(msg.sender == owner, "Oracle: not owner");
        _;
    }

    modifier onlyFulfiller() {
        require(msg.sender == trustedFulfiller, "Oracle: not fulfiller");
        _;
    }

    constructor(address _fulfiller) {
        owner = msg.sender;
        trustedFulfiller = _fulfiller;
    }

    function setFulfiller(address _fulfiller) external onlyOwner {
        trustedFulfiller = _fulfiller;
    }

    // ─── Called BY the deal contract ─────────────────────────────────────────

    function requestSellerVerification(
        uint256 dealId,
        string calldata cadastralNumber,
        string calldata sellerWalletAddress,
        string calldata sellerFullName
    ) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = PendingRequest(msg.sender, dealId, RequestType.SellerVerification, false);

        emit VerificationRequest(
            requestId,
            dealId,
            msg.sender,
            RequestType.SellerVerification,
            cadastralNumber,
            sellerWalletAddress,
            sellerFullName
        );
    }

    function requestBuyerVerification(
        uint256 dealId,
        string calldata buyerWalletAddress,
        string calldata buyerFullName,
        string calldata /* buyerPassportHash */
    ) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = PendingRequest(msg.sender, dealId, RequestType.BuyerVerification, false);

        emit VerificationRequest(
            requestId,
            dealId,
            msg.sender,
            RequestType.BuyerVerification,
            "",
            buyerWalletAddress,
            buyerFullName
        );
    }

    function requestRegistryTransfer(
        uint256 dealId,
        string calldata cadastralNumber,
        string calldata sellerFullName,
        string calldata buyerFullName,
        uint256 priceWei
    ) external returns (uint256 requestId) {
        requestId = nextRequestId++;
        requests[requestId] = PendingRequest(msg.sender, dealId, RequestType.RegistryTransfer, false);

        emit RegistryTransferRequest(
            requestId,
            dealId,
            msg.sender,
            cadastralNumber,
            sellerFullName,
            buyerFullName,
            priceWei
        );
    }

    // ─── Called BY the off-chain fulfiller ───────────────────────────────────

    function fulfilSellerVerification(
        uint256 requestId,
        bool success,
        string calldata reason
    ) external onlyFulfiller {
        PendingRequest storage req = requests[requestId];
        require(!req.fulfilled, "Oracle: already fulfilled");
        require(req.reqType == RequestType.SellerVerification, "Oracle: wrong type");
        req.fulfilled = true;

        emit RequestFulfilled(requestId, success);
        IDealCallback(req.dealContract).onSellerVerified(req.dealId, success, reason);
    }

    function fulfilBuyerVerification(
        uint256 requestId,
        bool success,
        string calldata reason
    ) external onlyFulfiller {
        PendingRequest storage req = requests[requestId];
        require(!req.fulfilled, "Oracle: already fulfilled");
        require(req.reqType == RequestType.BuyerVerification, "Oracle: wrong type");
        req.fulfilled = true;

        emit RequestFulfilled(requestId, success);
        IDealCallback(req.dealContract).onBuyerVerified(req.dealId, success, reason);
    }

    function fulfilRegistryTransfer(
        uint256 requestId,
        bool success,
        string calldata newRegistryId
    ) external onlyFulfiller {
        PendingRequest storage req = requests[requestId];
        require(!req.fulfilled, "Oracle: already fulfilled");
        require(req.reqType == RequestType.RegistryTransfer, "Oracle: wrong type");
        req.fulfilled = true;

        emit RequestFulfilled(requestId, success);
        IDealCallback(req.dealContract).onRegistryTransferConfirmed(req.dealId, success, newRegistryId);
    }
}
