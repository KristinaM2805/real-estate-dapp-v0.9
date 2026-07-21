# v0.9 step 1 — escrow transparency and seller confirmation

Изменения на этом шаге:

1. `reservePayment(dealId)` больше не запускает реестр автоматически.
2. После оплаты средства фиксируются внутри конкретной сделки: `deal.escrowAmount`.
3. Добавлены события для независимой проверки через explorer:
   - `PaymentDeposited(dealId, buyer, seller, amount, contractBalanceAfterDeposit)`
   - `EscrowConfirmedBySeller(dealId, seller, amount)`
   - `RegistryRequestAllowed(dealId, seller, buyer, cadastralNumber)`
   - `RegistryTransferConfirmed(dealId, newRegistryId, proofHash)`
   - `FundsReleasedToSeller(dealId, seller, amount)`
4. Добавлена функция продавца:
   - `sellerConfirmEscrowAndRequestRegistry(dealId)`
5. Новый порядок этапов:
   - 0 Created
   - 1 SellerSubmitted
   - 2 SellerVerified
   - 3 BuyerSubmitted
   - 4 BuyerVerified
   - 5 PaymentReceived
   - 6 SellerEscrowConfirmed
   - 7 RegistryPending
   - 8 Completed
   - 9 Cancelled
6. В frontend добавлена кнопка продавца после оплаты:
   - “Деньги проверены, создать заявку в реестр”

Важно:
- Я не включала `.env`, `.env.docker`, `node_modules`, `artifacts`, `cache` и `.git` в архив.
- В моей среде компиляцию не удалось завершить из-за того, что в загруженном архиве был `node_modules` от macOS/Darwin, несовместимый с Linux. На твоём Mac нужно выполнить `npm install` и затем `npx hardhat compile --build-profile production --show-stack-traces`.
