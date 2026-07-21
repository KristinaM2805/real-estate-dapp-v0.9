// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title RealEstateMarket
 * @notice Универсальный маркетплейс сделок с недвижимостью.
 *
 * Жизненный цикл сделки:
 *
 *  Created (0)
 *    └─ seller вызывает submitSellerData()
 *  SellerSubmitted (1)
 *    └─ оракул проверяет владение (off-chain → fulfilSellerVerification)
 *  SellerVerified (2)
 *    └─ buyer вызывает submitBuyerData()
 *  BuyerSubmitted (3)
 *    └─ оракул проверяет личность покупателя (off-chain → fulfilBuyerVerification)
 *  BuyerVerified (4)
 *    └─ buyer вызывает reservePayment() — отправляет ETH в escrow
 *  PaymentPending (5)  [устаревшее, переход сразу на 6]
 *  PaymentReceived (6)
 *    └─ любой участник вызывает completeDeal()
 *  RegistryPending (7)
 *    └─ оракул обновляет реестр (off-chain → fulfilRegistryTransfer)
 *  Completed (8)       — деньги переходят продавцу, право — покупателю
 *  Cancelled (9)       — из любого этапа до RegistryPending
 */

interface IPropertyOracle {
    function requestSellerVerification(
        uint256 dealId,
        string calldata cadastralNumber,
        string calldata sellerWalletAddress,
        string calldata sellerFullName
    ) external returns (uint256 requestId);

    function requestBuyerVerification(
        uint256 dealId,
        string calldata buyerWalletAddress,
        string calldata buyerFullName,
        string calldata buyerPassportHash
    ) external returns (uint256 requestId);

    function requestRegistryTransfer(
        uint256 dealId,
        string calldata cadastralNumber,
        string calldata sellerFullName,
        string calldata buyerFullName,
        uint256 priceWei
    ) external returns (uint256 requestId);
}

contract RealEstateMarket {

    // ─── Types ──────────────────────────────────────────────────────────────

    enum DealStage {
        Created,           // 0 — сделка создана, ждёт данных продавца
        SellerSubmitted,   // 1 — продавец подал данные, ждёт оракула
        SellerVerified,    // 2 — оракул подтвердил владение, ждёт данных покупателя
        BuyerSubmitted,    // 3 — покупатель подал данные, ждёт оракула
        BuyerVerified,     // 4 — оракул подтвердил покупателя, ждёт оплату
        PaymentReceived,   // 5 — деньги в escrow, ждёт проверки продавцом
        SellerEscrowConfirmed, // 6 — продавец подтвердил депозит и разрешил запрос в реестр
        RegistryPending,   // 7 — запрос в реестр отправлен, ждёт подтверждения
        Completed,         // 8 — сделка завершена
        Cancelled          // 9 — отменена
    }

    struct Deal {
        uint256 id;
        address seller;
        address buyer;
        DealStage stage;

        // Данные об объекте
        string cadastralNumber;
        string apartmentAddress;
        string propertyDocumentHash;

        // Участники
        string sellerFullName;
        string sellerPassportHash;
        string buyerFullName;
        string buyerPassportHash;

        // Финансы
        uint256 price;               // в wei
        uint256 escrowAmount;        // сумма, заблокированная в escrow именно по этой сделке
        uint256 paymentTimeoutSeconds;
        uint256 paymentDeadline;

        // Временные метки
        uint256 createdAt;
        uint256 sellerSubmittedAt;
        uint256 sellerVerifiedAt;
        uint256 buyerSubmittedAt;
        uint256 buyerVerifiedAt;
        uint256 paymentReceivedAt;
        uint256 sellerEscrowConfirmedAt;
        uint256 registryRequestedAt;
        uint256 completedAt;
        uint256 cancelledAt;

        // Реестр
        string registryRecordId;     // ID записи до сделки
        string newRegistryRecordId;  // ID записи после
        bytes32 registryProofHash;   // хеш подтверждения новой записи / документа реестра

        // Оракул
        uint256 pendingOracleRequestId;

        // Ошибки
        string lastOracleError;
    }

    // ─── State ───────────────────────────────────────────────────────────────

    address public immutable owner;
    IPropertyOracle public oracle;

    uint256 public nextDealId;
    mapping(uint256 => Deal) private deals;

    // seller address → список deal ID
    mapping(address => uint256[]) public sellerDeals;
    // buyer address → список deal ID (после BuyerVerified)
    mapping(address => uint256[]) public buyerDeals;

    bool private locked;

    // ─── Events ──────────────────────────────────────────────────────────────

    event DealCreated(
        uint256 indexed dealId,
        address indexed seller,
        uint256 price,
        string cadastralNumber
    );

    event SellerDataSubmitted(uint256 indexed dealId, uint256 oracleRequestId);
    event SellerVerifiedOK(uint256 indexed dealId);
    event SellerVerificationFailed(uint256 indexed dealId, string reason);

    event BuyerDataSubmitted(uint256 indexed dealId, address indexed buyer, uint256 oracleRequestId);
    event BuyerVerifiedOK(uint256 indexed dealId);
    event BuyerVerificationFailed(uint256 indexed dealId, string reason);
    event BuyerLeft(uint256 indexed dealId, address indexed buyer, string reason);

    event PaymentReceived(uint256 indexed dealId, address indexed buyer, uint256 amount);
    event PaymentDeposited(
        uint256 indexed dealId,
        address indexed buyer,
        address indexed seller,
        uint256 amount,
        uint256 contractBalanceAfterDeposit
    );
    event EscrowConfirmedBySeller(uint256 indexed dealId, address indexed seller, uint256 amount);
    event RegistryRequestAllowed(uint256 indexed dealId, address indexed seller, address indexed buyer, string cadastralNumber);

    event RegistryTransferRequested(uint256 indexed dealId, uint256 oracleRequestId);
    event RegistryTransferConfirmed(uint256 indexed dealId, string newRegistryId, bytes32 proofHash);
    event DealCompleted(uint256 indexed dealId, address indexed buyer, string newRegistryId);
    event RegistryTransferFailed(uint256 indexed dealId, string reason);

    event DealCancelled(uint256 indexed dealId, string reason);
    event FundsRefunded(uint256 indexed dealId, address indexed buyer, uint256 amount);
    event FundsReleasedToSeller(uint256 indexed dealId, address indexed seller, uint256 amount);
    event StageChanged(uint256 indexed dealId, uint8 stage, string visualText);

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    modifier onlyOracle() {
        require(msg.sender == address(oracle), "Not oracle");
        _;
    }

    modifier onlySeller(uint256 dealId) {
        require(msg.sender == deals[dealId].seller, "Not seller of this deal");
        _;
    }

    modifier onlyBuyer(uint256 dealId) {
        require(msg.sender == deals[dealId].buyer, "Not buyer of this deal");
        _;
    }

    modifier onlyParticipant(uint256 dealId) {
        require(
            msg.sender == deals[dealId].seller || msg.sender == deals[dealId].buyer,
            "Not a participant"
        );
        _;
    }

    modifier atStage(uint256 dealId, DealStage expected) {
        require(deals[dealId].stage == expected, "Wrong deal stage");
        _;
    }

    modifier nonReentrant() {
        require(!locked, "Reentrant call");
        locked = true;
        _;
        locked = false;
    }

    // ─── Constructor ─────────────────────────────────────────────────────────

    constructor(address _oracle) {
        owner = msg.sender;
        oracle = IPropertyOracle(_oracle);
    }

    function setOracle(address _oracle) external onlyOwner {
        oracle = IPropertyOracle(_oracle);
    }

    // ─── Step 1: Seller creates a deal ───────────────────────────────────────

    /**
     * @notice Продавец создаёт сделку. Никаких жёстко заданных адресов —
     *         любой кошелёк может быть продавцом.
     * @param _price Цена в wei (должна быть > 0)
     * @param _paymentTimeoutSeconds Срок ожидания оплаты после верификации покупателя
     */
    function _createDealRecord(
        string calldata _cadastralNumber,
        string calldata _apartmentAddress,
        string calldata _propertyDocumentHash,
        string calldata _registryRecordId,
        uint256 _price,
        uint256 _paymentTimeoutSeconds
    ) internal returns (uint256 dealId) {
        require(bytes(_cadastralNumber).length > 0, "Cadastral number is empty");
        require(bytes(_apartmentAddress).length > 0, "Apartment address is empty");
        require(bytes(_propertyDocumentHash).length > 0, "Document hash is empty");
        require(_price > 0, "Price must be > 0");
        require(_paymentTimeoutSeconds >= 60, "Timeout too short");

        dealId = nextDealId++;

        Deal storage d = deals[dealId];
        d.id = dealId;
        d.seller = msg.sender;
        d.stage = DealStage.Created;
        d.cadastralNumber = _cadastralNumber;
        d.apartmentAddress = _apartmentAddress;
        d.propertyDocumentHash = _propertyDocumentHash;
        d.registryRecordId = _registryRecordId;
        d.price = _price;
        d.paymentTimeoutSeconds = _paymentTimeoutSeconds;
        d.createdAt = block.timestamp;

        sellerDeals[msg.sender].push(dealId);

        _emitDealCreated(dealId);
    }

    function _emitDealCreated(uint256 dealId) internal {
        Deal storage d = deals[dealId];
        emit DealCreated(dealId, d.seller, d.price, d.cadastralNumber);
    }

    function createDeal(
        string calldata _cadastralNumber,
        string calldata _apartmentAddress,
        string calldata _propertyDocumentHash,
        string calldata _registryRecordId,
        uint256 _price,
        uint256 _paymentTimeoutSeconds
    ) external returns (uint256 dealId) {
        dealId = _createDealRecord(
            _cadastralNumber,
            _apartmentAddress,
            _propertyDocumentHash,
            _registryRecordId,
            _price,
            _paymentTimeoutSeconds
        );

        _emitStage(dealId, unicode"Сделка создана. Ожидание данных продавца.");
    }

    /**
     * @notice Создание сделки вместе с данными продавца.
     *         Для пользователя это один шаг: продавец вводит параметры объекта и свои данные,
     *         после чего контракт сразу отправляет запрос Oracle на проверку права собственности.
     *         До успешной проверки Oracle такая сделка не попадает в список активных для покупателей.
     */
    function createDealWithSellerData(
        string calldata _cadastralNumber,
        string calldata _apartmentAddress,
        string calldata _propertyDocumentHash,
        string calldata _registryRecordId,
        uint256 _price,
        uint256 _paymentTimeoutSeconds,
        string calldata _sellerFullName,
        string calldata _sellerPassportHash
    ) external returns (uint256 dealId) {
        require(bytes(_sellerFullName).length > 0, "Seller name is empty");
        require(bytes(_sellerPassportHash).length > 0, "Seller passport hash is empty");

        dealId = _createDealRecord(
            _cadastralNumber,
            _apartmentAddress,
            _propertyDocumentHash,
            _registryRecordId,
            _price,
            _paymentTimeoutSeconds
        );

        _submitSellerDataAfterCreate(dealId, _sellerFullName, _sellerPassportHash);
    }

    function _submitSellerDataAfterCreate(
        uint256 dealId,
        string calldata _sellerFullName,
        string calldata _sellerPassportHash
    ) internal {
        Deal storage d = deals[dealId];
        d.stage = DealStage.SellerSubmitted;
        d.sellerFullName = _sellerFullName;
        d.sellerPassportHash = _sellerPassportHash;
        d.sellerSubmittedAt = block.timestamp;

        uint256 reqId = oracle.requestSellerVerification(
            dealId,
            d.cadastralNumber,
            _addressToString(d.seller),
            _sellerFullName
        );
        d.pendingOracleRequestId = reqId;

        emit SellerDataSubmitted(dealId, reqId);
        _emitStage(dealId, unicode"Сделка создана, данные продавца отправлены. Oracle проверяет право собственности...");
    }

    // ─── Step 2: Seller submits personal data → oracle verifies ownership ────

    /**
     * @notice Продавец вводит своё ФИО и хеш паспорта.
     *         Контракт отправляет запрос оракулу, который проверяет,
     *         что cadastralNumber действительно принадлежит этому адресу в реестре.
     */
    function submitSellerData(
        uint256 dealId,
        string calldata _sellerFullName,
        string calldata _sellerPassportHash
    ) external onlySeller(dealId) atStage(dealId, DealStage.Created) {
        require(bytes(_sellerFullName).length > 0, "Seller name is empty");
        require(bytes(_sellerPassportHash).length > 0, "Seller passport hash is empty");

        Deal storage d = deals[dealId];
        d.sellerFullName = _sellerFullName;
        d.sellerPassportHash = _sellerPassportHash;
        d.sellerSubmittedAt = block.timestamp;
        d.stage = DealStage.SellerSubmitted;

        // Запрашиваем оракул: проверь что msg.sender — владелец кадастрового номера
        uint256 reqId = oracle.requestSellerVerification(
            dealId,
            d.cadastralNumber,
            _addressToString(msg.sender),
            _sellerFullName
        );
        d.pendingOracleRequestId = reqId;

        emit SellerDataSubmitted(dealId, reqId);
        _emitStage(dealId, unicode"Данные продавца отправлены. Оракул проверяет право собственности...");
    }

    // ─── Oracle callback: seller verified ────────────────────────────────────

    function onSellerVerified(
        uint256 dealId,
        bool success,
        string calldata reason
    ) external onlyOracle {
        Deal storage d = deals[dealId];
        require(d.stage == DealStage.SellerSubmitted, "Wrong stage for seller callback");

        if (success) {
            d.stage = DealStage.SellerVerified;
            d.sellerVerifiedAt = block.timestamp;
            emit SellerVerifiedOK(dealId);
            _emitStage(dealId, unicode"Оракул подтвердил: продавец — законный владелец. Ожидание покупателя.");
        } else {
            d.stage = DealStage.Cancelled;
            d.cancelledAt = block.timestamp;
            d.lastOracleError = reason;
            emit SellerVerificationFailed(dealId, reason);
            emit DealCancelled(dealId, string.concat("Verification failed: ", reason));
            _emitStage(dealId, unicode"Оракул отклонил: продавец не является владельцем объекта.");
        }
    }

    // ─── Step 3: Buyer submits data → oracle verifies identity ───────────────

    /**
     * @notice Покупатель (любой адрес) подаёт свои данные.
     *         Контракт запрашивает оракул для проверки личности.
     */
    function submitBuyerData(
        uint256 dealId,
        string calldata _buyerFullName,
        string calldata _buyerPassportHash
    ) external atStage(dealId, DealStage.SellerVerified) {
        Deal storage d = deals[dealId];
        // Первый вызов — покупатель ещё не назначен
        if (d.buyer == address(0)) {
            d.buyer = msg.sender;
            buyerDeals[msg.sender].push(dealId);
        } else {
            require(msg.sender == d.buyer, "Different buyer already submitted");
        }

        require(msg.sender != d.seller, "Seller cannot be buyer");
        require(bytes(_buyerFullName).length > 0, "Buyer name is empty");
        require(bytes(_buyerPassportHash).length > 0, "Buyer passport hash is empty");

        d.buyerFullName = _buyerFullName;
        d.buyerPassportHash = _buyerPassportHash;
        d.buyerSubmittedAt = block.timestamp;
        d.stage = DealStage.BuyerSubmitted;

        uint256 reqId = oracle.requestBuyerVerification(
            dealId,
            _addressToString(msg.sender),
            _buyerFullName,
            _buyerPassportHash
        );
        d.pendingOracleRequestId = reqId;

        emit BuyerDataSubmitted(dealId, msg.sender, reqId);
        _emitStage(dealId, unicode"Данные покупателя отправлены. Оракул проверяет личность...");
    }

    // ─── Oracle callback: buyer verified ─────────────────────────────────────

    function onBuyerVerified(
        uint256 dealId,
        bool success,
        string calldata reason
    ) external onlyOracle {
        Deal storage d = deals[dealId];
        require(d.stage == DealStage.BuyerSubmitted, "Wrong stage for buyer callback");

        if (success) {
            d.stage = DealStage.BuyerVerified;
            d.buyerVerifiedAt = block.timestamp;
            d.paymentDeadline = block.timestamp + d.paymentTimeoutSeconds;
            emit BuyerVerifiedOK(dealId);
            _emitStage(dealId, unicode"Покупатель верифицирован. Ожидание оплаты в escrow.");
        } else {
            // Покупатель не прошёл — сбрасываем до SellerVerified (может зайти другой)
            d.stage = DealStage.SellerVerified;
            d.buyer = address(0);
            d.buyerFullName = "";
            d.buyerPassportHash = "";
            d.lastOracleError = reason;
            emit BuyerVerificationFailed(dealId, reason);
            _emitStage(dealId, unicode"Оракул отклонил покупателя. Ожидание другого покупателя.");
        }
    }

    // ─── Step 4: Buyer sends payment to escrow ────────────────────────────────

    function reservePayment(
        uint256 dealId
    ) external payable onlyBuyer(dealId) atStage(dealId, DealStage.BuyerVerified) nonReentrant {
        Deal storage d = deals[dealId];
        require(block.timestamp <= d.paymentDeadline, "Payment deadline passed");
        require(msg.value == d.price, "Wrong payment amount");
        require(d.escrowAmount == 0, "Payment already deposited");

        d.stage = DealStage.PaymentReceived;
        d.escrowAmount = msg.value;
        d.paymentReceivedAt = block.timestamp;

        // Старое событие оставлено для совместимости frontend.
        emit PaymentReceived(dealId, msg.sender, msg.value);
        // Новое событие содержит seller и баланс контракта, чтобы участники могли
        // проверить депозит в explorer по адресу escrow-контракта и dealId.
        emit PaymentDeposited(dealId, msg.sender, d.seller, msg.value, address(this).balance);
        _emitStage(dealId, unicode"Оплата получена в escrow. Продавец может проверить депозит через explorer и разрешить заявку в реестр.");
    }

    // ─── Step 5: Seller verifies escrow publicly and starts registry request ──

    function sellerConfirmEscrowAndRequestRegistry(
        uint256 dealId
    ) external onlySeller(dealId) atStage(dealId, DealStage.PaymentReceived) nonReentrant {
        Deal storage d = deals[dealId];
        require(d.buyer != address(0), "Buyer is not assigned");
        require(d.escrowAmount == d.price, "Escrow amount mismatch");
        require(address(this).balance >= d.escrowAmount, "Contract balance is insufficient");

        d.stage = DealStage.SellerEscrowConfirmed;
        d.sellerEscrowConfirmedAt = block.timestamp;

        emit EscrowConfirmedBySeller(dealId, msg.sender, d.escrowAmount);
        emit RegistryRequestAllowed(dealId, d.seller, d.buyer, d.cadastralNumber);
        _emitStage(dealId, unicode"Продавец подтвердил наличие средств в escrow. Oracle создаёт заявку на переоформление в реестре.");

        uint256 reqId = oracle.requestRegistryTransfer(
            dealId,
            d.cadastralNumber,
            d.sellerFullName,
            d.buyerFullName,
            d.price
        );
        d.pendingOracleRequestId = reqId;
        d.registryRequestedAt = block.timestamp;
        d.stage = DealStage.RegistryPending;

        emit RegistryTransferRequested(dealId, reqId);
        _emitStage(dealId, unicode"Заявка в реестр создана. Ожидаем подтверждение покупателя и новую запись о праве собственности.");
    }

    // ─── Oracle callback: registry confirmed ─────────────────────────────────

    function onRegistryTransferConfirmed(
        uint256 dealId,
        bool success,
        string calldata newRegistryId
    ) external onlyOracle nonReentrant {
        Deal storage d = deals[dealId];
        require(d.stage == DealStage.RegistryPending, "Wrong stage for registry callback");

        if (success) {
            d.stage = DealStage.Completed;
            d.completedAt = block.timestamp;
            d.newRegistryRecordId = newRegistryId;
            d.registryProofHash = keccak256(abi.encodePacked(dealId, d.cadastralNumber, d.buyer, newRegistryId));

            emit RegistryTransferConfirmed(dealId, newRegistryId, d.registryProofHash);
            emit DealCompleted(dealId, d.buyer, newRegistryId);
            _emitStage(dealId, unicode"Реестр подтвердил новую запись. Смарт-контракт переводит escrow продавцу.");

            uint256 toSend = d.escrowAmount;
            require(toSend > 0, "No escrow funds");
            d.escrowAmount = 0;

            (bool sent, ) = payable(d.seller).call{value: toSend}("");
            require(sent, "Transfer to seller failed");

            emit FundsReleasedToSeller(dealId, d.seller, toSend);
        } else {
            // Реестр отклонил — возвращаем деньги покупателю
            d.stage = DealStage.Cancelled;
            d.cancelledAt = block.timestamp;
            d.lastOracleError = newRegistryId; // здесь причина отказа

            emit RegistryTransferFailed(dealId, newRegistryId);
            emit DealCancelled(dealId, string.concat("Registry rejected: ", newRegistryId));
            _emitStage(dealId, unicode"Реестр отклонил сделку. Возврат средств покупателю...");

            uint256 toRefund = d.escrowAmount;
            require(toRefund > 0, "No escrow funds");
            d.escrowAmount = 0;

            (bool refunded, ) = payable(d.buyer).call{value: toRefund}("");
            require(refunded, "Refund to buyer failed");

            emit FundsRefunded(dealId, d.buyer, toRefund);
        }
    }

    // ─── Cancellation paths ───────────────────────────────────────────────────

    /**
     * @notice Продавец может снять сделку с публикации только до подключения покупателя.
     *         После назначения покупателя продавец уже не может отменить сделку в одностороннем порядке.
     */
    function cancelDeal(
        uint256 dealId,
        string calldata reason
    ) external onlySeller(dealId) nonReentrant {
        Deal storage d = deals[dealId];
        require(
            d.stage == DealStage.Created ||
            d.stage == DealStage.SellerSubmitted ||
            d.stage == DealStage.SellerVerified,
            "Seller cannot cancel at this stage"
        );
        require(d.buyer == address(0), "Buyer already joined");

        d.stage = DealStage.Cancelled;
        d.cancelledAt = block.timestamp;

        emit DealCancelled(dealId, reason);
        _emitStage(dealId, unicode"Сделка снята продавцом с публикации.");
    }

    /**
     * @notice Покупатель может выйти из сделки только до внесения оплаты в escrow.
     *         Сделка не отменяется, а возвращается в SellerVerified и снова доступна новым покупателям.
     */
    function leaveDealAsBuyer(
        uint256 dealId,
        string calldata reason
    ) external onlyBuyer(dealId) nonReentrant {
        Deal storage d = deals[dealId];
        require(
            d.stage == DealStage.BuyerSubmitted ||
            d.stage == DealStage.BuyerVerified,
            "Buyer cannot leave at this stage"
        );

        address oldBuyer = d.buyer;
        _clearBuyerAndReopen(d);

        emit BuyerLeft(dealId, oldBuyer, reason);
        _emitStage(dealId, unicode"Покупатель вышел из сделки. Ожидание другого покупателя.");
    }

    /**
     * @notice Backward-compatible alias для старого frontend.
     *         Теперь не отменяет всю сделку, а выполняет выход покупателя до оплаты.
     */
    function cancelDealAsBuyer(
        uint256 dealId,
        string calldata reason
    ) external onlyBuyer(dealId) nonReentrant {
        Deal storage d = deals[dealId];
        require(
            d.stage == DealStage.BuyerSubmitted ||
            d.stage == DealStage.BuyerVerified,
            "Buyer cannot leave at this stage"
        );

        address oldBuyer = d.buyer;
        _clearBuyerAndReopen(d);

        emit BuyerLeft(dealId, oldBuyer, reason);
        _emitStage(dealId, unicode"Покупатель вышел из сделки. Ожидание другого покупателя.");
    }

    /**
     * @notice Продавец забирает сертификат после истечения срока оплаты.
     */
    function claimTimeoutCancellation(uint256 dealId) external onlySeller(dealId) {
        Deal storage d = deals[dealId];
        require(d.stage == DealStage.BuyerVerified, "Not in BuyerVerified stage");
        require(block.timestamp > d.paymentDeadline, "Deadline not passed");

        d.stage = DealStage.Cancelled;
        d.cancelledAt = block.timestamp;

        emit DealCancelled(dealId, "Payment deadline expired");
        _emitStage(dealId, unicode"Срок оплаты истёк. Сделка отменена.");
    }

    // ─── View functions (split to avoid stack-too-deep) ───────────────────────

    /// Основные поля сделки: участники, этап, цена.
    /// contractBalance сохранён в названии для совместимости ABI, но теперь возвращает escrowAmount конкретной сделки.
    function getDealMain(uint256 dealId) external view returns (
        uint256 id,
        address seller,
        address buyer,
        uint8 stage,
        uint256 price,
        uint256 contractBalance,
        uint256 paymentDeadline,
        uint256 createdAt,
        uint256 completedAt
    ) {
        Deal storage d = deals[dealId];
        return (
            d.id,
            d.seller,
            d.buyer,
            uint8(d.stage),
            d.price,
            d.escrowAmount,
            d.paymentDeadline,
            d.createdAt,
            d.completedAt
        );
    }

    /// Данные об объекте и реестре
    function getDealProperty(uint256 dealId) external view returns (
        string memory cadastralNumber,
        string memory apartmentAddress,
        string memory registryRecordId,
        string memory newRegistryRecordId,
        string memory lastOracleError
    ) {
        Deal storage d = deals[dealId];
        return (
            d.cadastralNumber,
            d.apartmentAddress,
            d.registryRecordId,
            d.newRegistryRecordId,
            d.lastOracleError
        );
    }

    /// Данные участников (ФИО)
    function getDealParties(uint256 dealId) external view returns (
        string memory sellerFullName,
        string memory buyerFullName
    ) {
        Deal storage d = deals[dealId];
        return (d.sellerFullName, d.buyerFullName);
    }

    /// Временные метки этапов
    function getDealTimestamps(uint256 dealId) external view returns (
        uint256 sellerSubmittedAt,
        uint256 sellerVerifiedAt,
        uint256 buyerSubmittedAt,
        uint256 buyerVerifiedAt,
        uint256 paymentReceivedAt,
        uint256 cancelledAt
    ) {
        Deal storage d = deals[dealId];
        return (
            d.sellerSubmittedAt,
            d.sellerVerifiedAt,
            d.buyerSubmittedAt,
            d.buyerVerifiedAt,
            d.paymentReceivedAt,
            d.cancelledAt
        );
    }

    /// Прозрачность escrow и реестра для интерфейса/explorer
    function getDealEscrow(uint256 dealId) external view returns (
        uint256 escrowAmount,
        uint256 sellerEscrowConfirmedAt,
        uint256 registryRequestedAt,
        bytes32 registryProofHash
    ) {
        Deal storage d = deals[dealId];
        return (
            d.escrowAmount,
            d.sellerEscrowConfirmedAt,
            d.registryRequestedAt,
            d.registryProofHash
        );
    }

    function getDealCount() external view returns (uint256) {
        return nextDealId;
    }

    function getSellerDeals(address seller) external view returns (uint256[] memory) {
        return sellerDeals[seller];
    }

    function getBuyerDeals(address buyer) external view returns (uint256[] memory) {
        return buyerDeals[buyer];
    }

    // ─── Internals ────────────────────────────────────────────────────────────

    function _clearBuyerAndReopen(Deal storage d) internal {
        d.stage = DealStage.SellerVerified;
        d.buyer = address(0);
        d.buyerFullName = "";
        d.buyerPassportHash = "";
        d.buyerSubmittedAt = 0;
        d.buyerVerifiedAt = 0;
        d.paymentDeadline = 0;
        d.pendingOracleRequestId = 0;
        d.lastOracleError = "";
    }

    function _emitStage(uint256 dealId, string memory text) internal {
        emit StageChanged(dealId, uint8(deals[dealId].stage), text);
    }

    function _addressToString(address addr) internal pure returns (string memory) {
        bytes memory b = new bytes(42);
        b[0] = '0'; b[1] = 'x';
        bytes memory hex_chars = "0123456789abcdef";
        for (uint i = 0; i < 20; i++) {
            b[2 + i * 2] = hex_chars[uint8(uint160(addr) >> (4 * (39 - 2 * i))) & 0xf];
            b[3 + i * 2] = hex_chars[uint8(uint160(addr) >> (4 * (38 - 2 * i))) & 0xf];
        }
        return string(b);
    }
}
