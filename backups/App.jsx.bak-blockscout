import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { ethers } from "ethers";
import "./App.css";

import {
  MARKET_ADDRESS,
  MARKET_ABI,
  EXPLORER_BASE_URL,
} from "./contractConfig";

import AnimatedScene from "./AnimatedScene";

const anime = () => window.anime;

const STAGES = [
  "Данные продавца подготовлены",          // 0
  "Oracle проверяет продавца",             // 1
  "Сделка создана и опубликована",         // 2
  "Покупатель подал данные",               // 3
  "Покупатель верифицирован",              // 4
  "Оплата получена в escrow",              // 5
  "Продавец подтвердил escrow",            // 6
  "Заявка в реестр / переоформление",      // 7
  "Сделка завершена",                      // 8
  "Сделка отменена",                       // 9
];

function getStageLabel(stage) {
  return STAGES[Number(stage)] || `Этап ${stage}`;
}

function shortAddr(a) {
  if (!a) return "";
  return `${a.slice(0, 6)}...${a.slice(-4)}`;
}
function normalize(a) { return a?.toLowerCase(); }
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";
function isZeroAddress(a) {
  return !a || normalize(a) === normalize(ZERO_ADDRESS);
}
function isCancelledDeal(d) {
  return Number(d?.stage) === 9;
}
function belongsToAddress(d, address) {
  if (!d || !address) return false;
  const addr = normalize(address);
  return normalize(d.seller) === addr || (!isZeroAddress(d.buyer) && normalize(d.buyer) === addr);
}
function shouldShowInMyDeals(d, address) {
  // Строго "мои сделки": адрес должен быть участником в самом контракте.
  // Публичная активная сделка без buyer НЕ является сделкой покупателя.
  // Отменённые сделки не показываем вообще, даже если адрес был участником раньше.
  if (!d || !address || isCancelledDeal(d)) return false;
  const addr = normalize(address);
  const isSellerOfDeal = normalize(d.seller) === addr;
  const isBuyerOfDeal = !isZeroAddress(d.buyer) && normalize(d.buyer) === addr;
  return isSellerOfDeal || isBuyerOfDeal;
}
function isPublicActiveDeal(d) {
  // В публичный список попадают только опубликованные сделки после проверки продавца.
  // Отменённые сделки и сделки с покупателем здесь не показываются.
  return d && Number(d.stage) === 2 && isZeroAddress(d.buyer);
}
function fmtTime(v) {
  if (!v) return "—";
  const n = Number(v);
  return n ? new Date(n * 1000).toLocaleString("ru-RU") : "—";
}
function fmtSec(s) {
  if (s <= 0) return "срок истёк";
  const m = Math.floor(s / 60), r = s % 60;
  return m <= 0 ? `${r} сек.` : `${m} мин. ${r} сек.`;
}

function getDefaultExplorerBase(chainId) {
  const id = Number(chainId);
  if (id === 1) return "https://etherscan.io";
  if (id === 11155111) return "https://sepolia.etherscan.io";
  return "";
}
function getChainLabel(chainId) {
  const id = Number(chainId);
  if (id === 1) return "Ethereum Mainnet";
  if (id === 11155111) return "Sepolia";
  if (id === 31337) return "Hardhat Local";
  if (!chainId) return "сеть не определена";
  return `Chain ID ${id}`;
}
function getStoredTxHashes() {
  try {
    return JSON.parse(window.localStorage.getItem("realEstateTxHashes") || "{}");
  } catch {
    return {};
  }
}
const delay = (ms) => new Promise(r => setTimeout(r, ms));
const REGISTRY_FRONTEND_URL = import.meta.env.VITE_REGISTRY_FRONTEND_URL || "http://localhost:8081";

// ─── MetaMask Toast ──────────────────────────────────────────────────────────
function MetaMaskToast({ status, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    if (status === "idle" || !ref.current) return;
    const a = anime();
    if (a) a({ targets: ref.current, translateX: [120, 0], opacity: [0, 1], duration: 380, easing: "easeOutBack" });
  }, [status]);

  if (status === "idle") return null;
  return (
    <div ref={ref} className={`mm-toast mm-toast--${status}`} role="status">
      <div className="mm-toast__header">
        <span className="mm-fox">🦊</span>
        <span className="mm-toast__title">MetaMask</span>
        {status !== "waiting" && <button className="mm-toast__close" onClick={onClose}>×</button>}
      </div>
      <div className="mm-toast__body">
        {status === "waiting" && (<><div className="mm-spinner"><div/><div/><div/></div><div><p className="mm-toast__label">Ожидание подписи</p><p className="mm-toast__sub">Подтвердите в MetaMask</p></div></>)}
        {status === "success" && (<><span className="mm-toast__icon mm-toast__icon--ok">✓</span><div><p className="mm-toast__label">Подтверждено!</p></div></>)}
        {status === "error" && (<><span className="mm-toast__icon mm-toast__icon--err">✕</span><div><p className="mm-toast__label">Отклонено</p></div></>)}
      </div>
      {status === "waiting" && <div className="mm-toast__progress"><div className="mm-toast__progress-bar"/></div>}
    </div>
  );
}

// ─── Stage Progress ───────────────────────────────────────────────────────────
function StageProgress({ stage, isCancelled }) {
  const steps = [
    { icon: "✍️", label: "Продавец" },
    { icon: "🔍", label: "Проверка" },
    { icon: "🏠", label: "Создана" },
    { icon: "🧍", label: "Покупатель" },
    { icon: "💰", label: "Escrow" },
    { icon: "👁️", label: "Проверка денег" },
    { icon: "📋", label: "Реестр" },
    { icon: "✅", label: "Готово" },
  ];
  const vs = stage >= 8 ? 7 : stage >= 7 ? 6 : stage >= 6 ? 5 : stage >= 5 ? 4 : stage >= 4 ? 3 : stage >= 2 ? 2 : stage >= 1 ? 1 : 0;
  return (
    <div className="stage-progress">
      {steps.map((s, i) => {
        const done = !isCancelled && vs > i;
        const active = !isCancelled && vs === i;
        return (
          <div key={i} className={`stage-step ${done?"done":""} ${active?"active":""} ${isCancelled&&i>=vs?"cancelled":""}`}>
            <div className="stage-step__dot"><span>{done ? "✓" : (isCancelled && i >= vs) ? "✕" : s.icon}</span></div>
            <span className="stage-step__label">{s.label}</span>
            {i < steps.length - 1 && <div className={`stage-step__line ${done?"done":""}`}/>}
          </div>
        );
      })}
    </div>
  );
}

// ─── Create Deal Form ─────────────────────────────────────────────────────────
function CreateDealForm({ onSubmit, disabled }) {
  const [form, setForm] = useState({
    cadastralNumber: "77:01:0004012:1056",
    apartmentAddress: "г. Екатеринбург, ул. Щербакова, д. 4, кв. 12",
    propertyDocumentHash: "QmHash123abc",
    registryRecordId: "REG-2026-000001",
    sellerFullName: "Ivan Petrov",
    sellerPassportHash: "hash_seller_001",
    priceEth: "0.01",
    timeoutMinutes: "30",
  });
  const set = k => e => setForm(f => ({ ...f, [k]: e.target.value }));

  return (
    <div className="create-deal-form">
      <h3>Параметры сделки</h3>
      <div className="form-grid">
        <div className="form-field"><label>Кадастровый номер</label><input value={form.cadastralNumber} onChange={set("cadastralNumber")}/></div>
        <div className="form-field"><label>Адрес объекта</label><input value={form.apartmentAddress} onChange={set("apartmentAddress")}/></div>
        <div className="form-field"><label>Хеш документа</label><input value={form.propertyDocumentHash} onChange={set("propertyDocumentHash")}/></div>
        <div className="form-field"><label>ID в реестре</label><input value={form.registryRecordId} onChange={set("registryRecordId")}/></div>
        <div className="form-field"><label>ФИО продавца</label><input value={form.sellerFullName} onChange={set("sellerFullName")} placeholder="Ivan Petrov"/></div>
        <div className="form-field"><label>Хеш паспорта продавца</label><input value={form.sellerPassportHash} onChange={set("sellerPassportHash")} placeholder="hash_seller_001"/></div>
        <div className="form-field"><label>Цена (ETH)</label><input type="number" step="0.001" value={form.priceEth} onChange={set("priceEth")}/></div>
        <div className="form-field"><label>Срок оплаты (минут)</label><input type="number" value={form.timeoutMinutes} onChange={set("timeoutMinutes")}/></div>
      </div>
      <button className="action-btn action-btn--blue" disabled={disabled}
        style={{ marginTop: 14, width: "100%" }}
        onClick={() => onSubmit({
          cadastralNumber: form.cadastralNumber,
          apartmentAddress: form.apartmentAddress,
          propertyDocumentHash: form.propertyDocumentHash,
          registryRecordId: form.registryRecordId,
          priceWei: ethers.parseEther(form.priceEth || "0.01"),
          timeoutSeconds: Number(form.timeoutMinutes) * 60,
          sellerFullName: form.sellerFullName,
          sellerPassportHash: form.sellerPassportHash,
        })}>
        <span className="action-btn__num">✦</span>
        <span className="action-btn__text"><strong>Создать и отправить на проверку</strong><small>Сделка станет активной после Oracle</small></span>
      </button>
    </div>
  );
}


function PublicVerificationBox({ deal, chainId, txHashes }) {
  if (!deal) return null;

  const explorerBase = EXPLORER_BASE_URL || getDefaultExplorerBase(chainId);
  const paymentTxHash = txHashes?.[`${deal.id}:payment`] || "";
  const registryTxHash = txHashes?.[`${deal.id}:registryRequest`] || "";
  const createTxHash = txHashes?.[`${deal.id}:create`] || "";
  const escrowAmount = deal.contractBalance ?? 0n;
  const isLocal = Number(chainId) === 31337;

  const linkStyle = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    minHeight: 38,
    padding: "8px 12px",
    borderRadius: 12,
    border: "1px solid #bfdbfe",
    background: "#eff6ff",
    color: "#1d4ed8",
    textDecoration: "none",
    fontWeight: 800,
    fontSize: 13,
  };
  const disabledStyle = {
    ...linkStyle,
    borderColor: "#e2e8f0",
    background: "#f8fafc",
    color: "#64748b",
  };

  const openAddress = explorerBase ? `${explorerBase}/address/${MARKET_ADDRESS}` : "";
  const openPayment = explorerBase && paymentTxHash ? `${explorerBase}/tx/${paymentTxHash}` : "";
  const openCreate = explorerBase && createTxHash ? `${explorerBase}/tx/${createTxHash}` : "";
  const openRegistry = explorerBase && registryTxHash ? `${explorerBase}/tx/${registryTxHash}` : "";

  return (
    <section className="details" style={{ borderColor: "#bfdbfe", background: "#f8fbff" }}>
      <h2>Публичная проверка escrow</h2>
      <div className="grid">
        <p><span>Сеть</span>{getChainLabel(chainId)}</p>
        <p><span>Deal ID</span>#{deal.id}</p>
        <p style={{ gridColumn: "1/-1" }}><span>Escrow / RealEstateMarket contract</span><code style={{ wordBreak: "break-all" }}>{MARKET_ADDRESS}</code></p>
        <p><span>Сумма сделки</span>{ethers.formatEther(deal.price)} ETH</p>
        <p><span>В escrow по сделке</span>{ethers.formatEther(escrowAmount)} ETH</p>
        <p><span>Покупатель</span>{!isZeroAddress(deal.buyer) ? deal.buyer : "не назначен"}</p>
        <p><span>Продавец</span>{deal.seller}</p>
        <p style={{ gridColumn: "1/-1" }}><span>Tx оплаты</span>{paymentTxHash ? <code style={{ wordBreak: "break-all" }}>{paymentTxHash}</code> : "появится после оплаты покупателем в этом браузере"}</p>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, marginTop: 14 }}>
        {openAddress ? (
          <a href={openAddress} target="_blank" rel="noreferrer" style={linkStyle}>Открыть контракт в Etherscan</a>
        ) : (
          <span style={disabledStyle}>Etherscan появится в Sepolia</span>
        )}
        {openPayment ? (
          <a href={openPayment} target="_blank" rel="noreferrer" style={linkStyle}>Открыть транзакцию оплаты</a>
        ) : (
          <span style={disabledStyle}>Tx оплаты ещё не зафиксирован в UI</span>
        )}
        {openCreate && <a href={openCreate} target="_blank" rel="noreferrer" style={linkStyle}>Tx создания сделки</a>}
        {openRegistry && <a href={openRegistry} target="_blank" rel="noreferrer" style={linkStyle}>Tx заявки в реестр</a>}
        {Number(deal.stage) >= 7 && (
          <a href={REGISTRY_FRONTEND_URL} target="_blank" rel="noreferrer" style={{ ...linkStyle, background: "#ecfdf5", borderColor: "#a7f3d0", color: "#047857" }}>Открыть сайт реестра</a>
        )}
      </div>

      {isLocal && (
        <p style={{ marginTop: 12, color: "#64748b", lineHeight: 1.5 }}>
          Сейчас выбрана локальная Hardhat-сеть, поэтому Etherscan не может открыть этот адрес. После деплоя в Sepolia этот же блок автоматически начнёт вести на Sepolia Etherscan. Для локальной проверки можно использовать RPC-команду <code>eth_getBalance</code> по адресу контракта выше. Заявку на переоформление покупатель подтверждает отдельно на сайте mock-реестра.
        </p>
      )}
    </section>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [account, setAccount] = useState("");
  const [contract, setContract] = useState(null);
  const [deal, setDeal] = useState(null);
  const [dealId, setDealId] = useState(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("Подключи MetaMask к нужной сети и выбери действие");
  const [mmStatus, setMmStatus] = useState("idle");
  const [animPhase, setAnimPhase] = useState(0);
  const [isAnimating, setIsAnimating] = useState(false);
  const [sellerName, setSellerName] = useState("Ivan Petrov");
  const [sellerPassport, setSellerPassport] = useState("hash_seller_001");
  const [buyerName, setBuyerName] = useState("Kristina Maykushina");
  const [buyerPassport, setBuyerPassport] = useState("hash_buyer_001");
  const [currentTs, setCurrentTs] = useState(Math.floor(Date.now() / 1000));
  const [isCertOpen, setIsCertOpen] = useState(false);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [mode, setMode] = useState("home"); // home | create | join | deal
  const [activeDeals, setActiveDeals] = useState([]);
  const [activeDealsLoading, setActiveDealsLoading] = useState(false);
  const [myDeals, setMyDeals] = useState([]);
  const [myDealsLoading, setMyDealsLoading] = useState(false);
  const [manualDealId, setManualDealId] = useState("");
  const [replayStage, setReplayStage] = useState(null);
  const [showPaymentConfirm, setShowPaymentConfirm] = useState(false);
  const [chainId, setChainId] = useState(null);
  const [txHashes, setTxHashes] = useState(() => getStoredTxHashes());
  const mmTimer = useRef(null);
  const pollRef = useRef(null);
  const selectedDealIdRef = useRef(null);
  const txLockRef = useRef(false);
  const accountRef = useRef("");
  const listRequestRef = useRef(0);
  const activeRequestRef = useRef(0);

  const stage = deal?.stage ?? 0;
  const hasBuyer = deal?.buyer && !isZeroAddress(deal.buyer);
  const isSeller = Boolean(account && deal?.seller && normalize(account) === normalize(deal.seller));
  const isBuyer = Boolean(account && hasBuyer && normalize(account) === normalize(deal.buyer));
  const canJoinAsBuyer = Boolean(account && deal && !isSeller && !hasBuyer && stage === 2);
  const isDealCreator = isSeller;
  const isCompleted = stage === 8;
  const isCancelled = stage === 9;

  // UI/role rules:
  // - простое "сбросить с экрана" показываем только для отменённой сделки;
  // - продавец может отменить объявление, пока покупатель ещё не назначен;
  // - покупатель может выйти из сделки только после своей проверки и до оплаты.
  const canCloseCancelledDeal = Boolean(deal && isCancelled && deal?.lastOracleError);
  const canSellerCancelListing = Boolean(deal && isSeller && !hasBuyer && !isCompleted && !isCancelled && stage !== 1);
  const canBuyerLeaveBeforePayment = Boolean(
    deal &&
    isBuyer &&
    !pending &&
    !showPaymentConfirm &&
    !isCompleted &&
    !isCancelled &&
    (stage === 3 || stage === 4) &&
    deal?.contractBalance === 0n
  );

  const paymentDeadlineN = deal?.paymentDeadline ? Number(deal.paymentDeadline) : 0;
  const paymentPassed = paymentDeadlineN > 0 && currentTs > paymentDeadlineN;
  const secToDeadline = paymentDeadlineN > 0 ? Math.max(0, paymentDeadlineN - currentTs) : 0;

  const priceEth = deal?.price ? ethers.formatEther(deal.price) : "—";
  const buyerDisplayName = deal?.buyerFullName || (hasBuyer ? shortAddr(deal.buyer) : "—");

  const sellerNextActionMessage = useMemo(() => {
    if (!deal || !isSeller || pending || isAnimating) return null;

    if (stage === 0) return "Продавец подготовил данные объекта и личности. До проверки Oracle сделка ещё не публикуется для покупателей.";
    if (stage === 1) return "Oracle проверяет право собственности продавца в реестре недвижимости. После подтверждения сделка будет считаться созданной и появится в активном списке.";
    if (stage === 2 && !hasBuyer) return "Сделка создана и опубликована: продавец подтверждён Oracle. Ваши действия выполнены, ожидаем подключение покупателя.";
    if (stage === 3) return `Покупатель ${buyerDisplayName} подключился и подал личные данные. Oracle проверяет покупателя. Продавцу пока ничего делать не нужно.`;
    if (stage === 4) return `Покупатель ${buyerDisplayName} подтверждён Oracle. Ожидаем оплату ${priceEth} ETH в escrow.`;
    if (stage === 5) return "Покупатель внёс оплату в escrow. Проверьте депозит через explorer и создайте заявку в реестр.";
    if (stage === 6) return "Продавец подтвердил escrow. Oracle создаёт заявку в реестр.";
    if (stage === 7) return "Идёт переоформление права собственности в реестре. Oracle отправит результат в смарт-контракт автоматически.";
    return null;
  }, [deal, isSeller, pending, isAnimating, stage, hasBuyer, buyerDisplayName, priceEth]);

  const simpleDealMessage = useMemo(() => {
    if (!deal) {
      if (mode === "join") return "Выберите подтверждённую сделку из списка или введите ID сделки вручную.";
      if (mode === "create") return "Заполните данные объекта и продавца. После проверки Oracle сделка появится в активном списке.";
      return message;
    }

    const idText = `Сделка #${deal.id}.`;

    if (stage === 0) return `${idText} Данные продавца отправлены в контракт. Ожидаем запуск проверки Oracle.`;
    if (stage === 1) return `${idText} Oracle проверяет право собственности продавца.`;
    if (stage === 2 && !hasBuyer) return `${idText} Продавец подтверждён, сделка опубликована. Ожидаем покупателя.`;
    if (stage === 2 && hasBuyer) return `${idText} Покупатель выбран, ожидается подача данных.`;
    if (stage === 3) return `${idText} Данные покупателя отправлены. Oracle проверяет покупателя.`;
    if (stage === 4) return `${idText} Покупатель подтверждён. Ожидается ручная оплата в escrow.`;
    if (stage === 5) return `${idText} Оплата внесена в escrow. Продавец должен проверить депозит через explorer и разрешить заявку в реестр.`;
    if (stage === 6) return `${idText} Продавец подтвердил escrow. Oracle создаёт заявку в реестр.`;
    if (stage === 7) return `${idText} Реестр регистрирует нового владельца. Ожидаем финальное подтверждение Oracle.`;
    if (stage === 8) return `${idText} Сделка завершена: новый владелец зарегистрирован, средства переведены продавцу.`;
    if (stage === 9) return `${idText} Сделка отменена.`;
    return message;
  }, [deal, mode, message, stage, hasBuyer]);

  const visibleMessage = pending || isAnimating ? message : simpleDealMessage;

  // История должна быть строго привязана к текущему MetaMask-адресу.
  // Даже если старый async-запрос вернул сделки предыдущего аккаунта,
  // в UI они не появятся для нового адреса.
  const myDealsForCurrent = useMemo(() => {
    if (!account) return [];
    return myDeals.filter(item => shouldShowInMyDeals(item, account));
  }, [myDeals, account]);

  const role = useMemo(() => {
    if (!account) return "Не подключён";
    if (isSeller) return "Продавец";
    if (isBuyer) return "Покупатель";
    if (canJoinAsBuyer) return "Покупатель / может присоединиться";
    return "Подключённый пользователь";
  }, [account, isSeller, isBuyer, canJoinAsBuyer]);

  // Для canvas-сцены передаём реальный stage контракта, иначе действия отображаются с задержкой.
  // Для сцены не показываем финальный обмен ключами/деньгами до настоящего Completed.
  // Stage 7 означает только ожидание/процесс в реестре, а не завершение сделки.
  const rawVisualStage = replayStage ?? stage;
  const visualStage = isCancelled ? 0 : isCompleted ? 8 : Math.min(rawVisualStage, 6);
  const progressStage = isCancelled ? stage : rawVisualStage;
  const certLocation = isCompleted ? "buyer" : isCancelled ? "seller" : stage >= 2 ? "escrow" : "seller";
  const moneyLocation = isCompleted ? "seller" : isCancelled ? "buyer" : stage >= 5 ? "escrow" : "buyer";

  function getStableDealId() {
    const id = deal?.id ?? dealId ?? selectedDealIdRef.current;
    if (id === null || id === undefined || id === "") return null;
    const n = Number(id);
    return Number.isNaN(n) ? null : n;
  }

  function rememberTxHash(kind, id, hash) {
    if (id === null || id === undefined || !hash) return;
    setTxHashes(prev => {
      const next = { ...prev, [`${Number(id)}:${kind}`]: hash };
      try {
        window.localStorage.setItem("realEstateTxHashes", JSON.stringify(next));
      } catch {}
      return next;
    });
  }

  async function readDeal(c, id) {
    const [main, prop, parties] = await Promise.all([
      c.getDealMain(id),
      c.getDealProperty(id),
      c.getDealParties(id),
    ]);

    return {
      id: Number(main[0]),
      seller: main[1],
      buyer: main[2],
      stage: Number(main[3]),
      price: main[4],
      contractBalance: main[5],
      paymentDeadline: main[6],
      createdAt: main[7],
      completedAt: main[8],
      cadastralNumber: prop[0],
      apartmentAddress: prop[1],
      registryRecordId: prop[2],
      newRegistryRecordId: prop[3],
      lastOracleError: prop[4],
      sellerFullName: parties[0],
      buyerFullName: parties[1],
    };
  }

  async function loadDeal(c = contract, id = dealId, options = {}) {
    if (!c || id === null || id === undefined || id === "") return null;
    try {
      const nId = Number(id);
      const d = await readDeal(c, nId);
      selectedDealIdRef.current = nId;
      setDeal(d);
      setDealId(nId);
      if (options.openDeal !== false) {
        setMode("deal");
        setShowCreateForm(false);
      }
      if (options.replayVerifiedSeller && d.stage >= 2) {
        replaySellerVerification(d.stage);
      }
      return d;
    } catch (e) {
      console.error("loadDeal:", e);
      setMessage(`Не удалось загрузить сделку #${id}. Проверьте ID сделки.`);
      return null;
    }
  }

  async function loadActiveDeals(c = contract) {
    if (!c) return [];
    const requestId = ++activeRequestRef.current;
    setActiveDealsLoading(true);
    try {
      const count = Number(await c.getDealCount());
      const items = [];

      for (let i = 0; i < count; i++) {
        try {
          const d = await readDeal(c, i);

          // В публичный список попадают только сделки после проверки продавца,
          // без покупателя и не отменённые. Сделки, снятые продавцом, сюда не попадают.
          if (isPublicActiveDeal(d)) items.push(d);
        } catch (e) {
          console.warn(`Не удалось прочитать сделку #${i}:`, e);
        }
      }

      if (requestId === activeRequestRef.current) setActiveDeals(items);
      return items;
    } catch (e) {
      console.warn("Не удалось загрузить список активных сделок:", e);
      if (requestId === activeRequestRef.current) setActiveDeals([]);
      setMessage("Не удалось загрузить список активных сделок.");
      return [];
    } finally {
      if (requestId === activeRequestRef.current) setActiveDealsLoading(false);
    }
  }

  async function loadMyDeals(c = contract, address = account) {
    if (!c || !address) {
      setMyDeals([]);
      return [];
    }

    const requestedAddress = normalize(address);
    const requestId = ++listRequestRef.current;
    setMyDealsLoading(true);

    try {
      const count = Number(await c.getDealCount());
      const items = [];

      for (let i = 0; i < count; i++) {
        try {
          const d = await readDeal(c, i);

          // Строгая история: только сделки, где текущий адрес уже записан в контракте
          // как seller или buyer. Публичные активные сделки, к которым покупатель ещё
          // не присоединился, сюда НЕ попадают. Отменённые сделки тоже не показываем.
          if (shouldShowInMyDeals(d, address)) items.push(d);
        } catch (e) {
          console.warn(`Не удалось прочитать сделку #${i} для истории:`, e);
        }
      }

      items.sort((a, b) => Number(b.id) - Number(a.id));

      // Защита от race condition: если пользователь переключил аккаунт, пока список
      // загружался, старый результат нельзя показывать новому адресу.
      if (requestId === listRequestRef.current && normalize(accountRef.current) === requestedAddress) {
        setMyDeals(items);
      }

      return items;
    } catch (e) {
      console.warn("Не удалось загрузить историю сделок:", e);
      if (requestId === listRequestRef.current && normalize(accountRef.current) === requestedAddress) {
        setMyDeals([]);
      }
      return [];
    } finally {
      if (requestId === listRequestRef.current) setMyDealsLoading(false);
    }
  }

  async function replaySellerVerification(targetStage = 2) {
    const maxStage = Math.min(Number(targetStage || 2), 2);
    setIsAnimating(true);
    setMessage("🎬 Показываем пройденные этапы: продавец → проверка Oracle → сделка создана...");
    for (let s = 0; s <= maxStage; s++) {
      setReplayStage(s);
      setAnimPhase(p => p + 1);
      await delay(s === 0 ? 450 : 900);
    }
    setReplayStage(null);
    setIsAnimating(false);
    setMessage("✅ Сделка уже создана после проверки продавца. Покупатель может подать свои данные.");
  }

  async function openJoinMode(c = contract) {
    // В режиме подключения покупатель должен сам выбрать сделку.
    // Поэтому очищаем выбранную сделку, останавливаем polling предыдущей сделки
    // и после загрузки списка ещё раз гарантируем, что сделка не открыта автоматически.
    clearInterval(pollRef.current);
    setMode("join");
    selectedDealIdRef.current = null;
    setDeal(null);
    setDealId(null);
    setReplayStage(null);
    setShowPaymentConfirm(false);
    setShowCreateForm(false);
    setManualDealId("");
    setMessage("Выберите активную подтверждённую сделку или введите её ID вручную.");
    await loadActiveDeals(c);
    selectedDealIdRef.current = null;
    setDeal(null);
    setDealId(null);
    setMode("join");
  }

  async function openCreateMode() {
    setMode("create");
    selectedDealIdRef.current = null;
    setDeal(null);
    setDealId(null);
    setShowCreateForm(true);
    setMessage("Создание новой сделки. Заполните параметры объекта.");
  }


  async function loadLastDealForAddress(c, address) {
    if (!c || !address) return false;

    try {
      const count = Number(await c.getDealCount());
      let lastMatch = null;

      for (let i = 0; i < count; i++) {
        try {
          const d = await readDeal(c, i);
          const isActive = d.stage < 8 && !isCancelledDeal(d);

          if (isActive && belongsToAddress(d, address)) {
            lastMatch = i;
          }
        } catch (e) {
          console.warn(`Не удалось прочитать сделку #${i}:`, e);
        }
      }

      if (lastMatch !== null) {
        await loadDeal(c, lastMatch, { openDeal: true });
        setMessage(`Загружена активная сделка #${lastMatch} для текущего адреса.`);
        return true;
      }

      setDeal(null);
      setDealId(null);
      setMode("home");
      setShowCreateForm(false);
      return false;
    } catch (e) {
      console.warn("Не удалось найти сделки аккаунта:", e);
      return false;
    }
  }


  // Poll selected deal until it reaches final state.
  // This keeps seller and buyer windows synchronized after Oracle updates.
  useEffect(() => {
    clearInterval(pollRef.current);

    const idToPoll = getStableDealId();
    if (!contract || idToPoll === null || mode !== "deal") return;

    const shouldPoll = !deal || (Number(deal.stage) !== 8 && Number(deal.stage) !== 9);

    if (shouldPoll) {
      pollRef.current = setInterval(async () => {
        const latest = await loadDeal(contract, idToPoll, { openDeal: true });
        if (latest?.stage === 8 || latest?.stage === 9) {
          clearInterval(pollRef.current);
        }
        if (accountRef.current) await loadMyDeals(contract, accountRef.current);
        await loadActiveDeals(contract);
      }, 2000);
    }

    return () => clearInterval(pollRef.current);
  }, [contract, dealId, deal?.stage]);

  async function getFresh() {
    if (!window.ethereum) throw new Error("MetaMask не найден");
    const provider = new ethers.BrowserProvider(window.ethereum);
    const accounts = await provider.send("eth_requestAccounts", []);
    const signer = await provider.getSigner();
    const network = await provider.getNetwork();
    setChainId(Number(network.chainId));
    const c = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
    accountRef.current = accounts[0];
    setAccount(accounts[0]);
    setContract(c);
    return { c, address: accounts[0] };
  }

  async function connectWallet() {
    try {
      const { c, address } = await getFresh();

      listRequestRef.current += 1;
      activeRequestRef.current += 1;
      setMyDeals([]);
      setActiveDeals([]);
      selectedDealIdRef.current = null;
      setReplayStage(null);
      setShowPaymentConfirm(false);

      await loadMyDeals(c, address);
      setMode("home");
      selectedDealIdRef.current = null;
      setDeal(null);
      setDealId(null);
      setShowCreateForm(false);
      setMessage(
        `Кошелёк подключён: ${shortAddr(address)}. Выберите действие: создать сделку, подключиться к сделке или открыть свою сделку из истории.`
      );
    } catch (e) {
      setMessage(e?.reason || e?.shortMessage || e?.message || "Ошибка");
    }
  }

  const closeMm = useCallback(() => { clearTimeout(mmTimer.current); setMmStatus("idle"); }, []);

  async function runTx(fn, animMsg, successMsg, options = {}) {
    try {
      const { c, address } = await getFresh();
      setPending(true);
      setMmStatus("waiting");
      setMessage("Подтвердите транзакцию в MetaMask...");
      const refreshDealId = options.dealId ?? getStableDealId();
      const tx = await fn(c);
      await tx.wait();

      // Сразу перечитываем тот же dealId, по которому отправлялась транзакция.
      if (refreshDealId !== null) await loadDeal(c, refreshDealId);
      await loadMyDeals(c, address);

      setMmStatus("success");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 3000);
      setMessage(animMsg);
      setIsAnimating(true);
      setAnimPhase(p => p + 1);
      await delay(900);
      setIsAnimating(false);
      if (refreshDealId !== null) await loadDeal(c, refreshDealId);
      await loadMyDeals(c, address);
      setMessage(successMsg);
    } catch (e) {
      console.error(e);
      setMmStatus("error");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 4000);
      setMessage(e?.reason || e?.shortMessage || e?.message || "Ошибка транзакции");
    } finally { setPending(false); }
  }

  async function handleCreateDeal(params) {
    try {
      const { c, address } = await getFresh();
      setPending(true); setMmStatus("waiting");
      setMessage("Отправляем данные продавца и объекта. Сделка появится в списке только после проверки Oracle...");
      const tx = await c.createDealWithSellerData(
        params.cadastralNumber, params.apartmentAddress,
        params.propertyDocumentHash, params.registryRecordId,
        params.priceWei, params.timeoutSeconds,
        params.sellerFullName, params.sellerPassportHash
      );
      const receipt = await tx.wait();
      const iface = new ethers.Interface(MARKET_ABI);
      let newId = null;
      for (const log of receipt.logs) {
        try { const p = iface.parseLog(log); if (p?.name === "DealCreated") { newId = Number(p.args.dealId); break; } } catch {}
      }
      setMmStatus("success");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 3000);
      if (newId !== null) {
        rememberTxHash("create", newId, receipt.hash);
        setDealId(newId);
        await loadDeal(c, newId, { openDeal: true });
        await loadMyDeals(c, address);
        setMessage(`✅ Данные отправлены. Oracle проверяет продавца; после подтверждения сделка #${newId} будет создана и опубликована.`);
      }
      setMode("deal");
      setShowCreateForm(false);
    } catch (e) {
      setMmStatus("error");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 4000);
      setMessage(e?.reason || e?.shortMessage || e?.message || "Ошибка");
    } finally { setPending(false); }
  }


  async function handleSubmitBuyerData() {
    if (txLockRef.current || pending) return;

    const currentDealId = getStableDealId();
    if (currentDealId === null) {
      setMessage("Сначала выберите сделку из активного списка или введите ID.");
      return;
    }

    txLockRef.current = true;
    setPending(true);

    try {
      const { c, address } = await getFresh();
      selectedDealIdRef.current = currentDealId;

      const fresh = await readDeal(c, currentDealId).catch(() => null);

      if (!fresh) {
        setMessage("Сделка не найдена. Обновите список активных сделок и выберите её заново.");
        return;
      }

      if (Number(fresh.stage) !== 2) {
        setMessage(`Сделка #${currentDealId} уже перешла на другой этап. Обновляем данные.`);
        await loadDeal(c, currentDealId, { openDeal: true });
        await loadMyDeals(c, address);
        return;
      }

      if (!isZeroAddress(fresh.buyer)) {
        setMessage("К этой сделке уже подключён покупатель. Выберите другую активную сделку.");
        await loadActiveDeals(c);
        return;
      }

      if (normalize(fresh.seller) === normalize(address)) {
        setMessage("Продавец не может подключиться к своей сделке как покупатель.");
        return;
      }

      setMmStatus("waiting");
      setMessage(`Подтвердите подключение к сделке #${currentDealId} в MetaMask...`);

      const tx = await c.submitBuyerData(currentDealId, buyerName, buyerPassport);
      await tx.wait();

      setMmStatus("success");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 3000);
      setMessage(`Данные покупателя отправлены по сделке #${currentDealId}. Oracle проверяет покупателя.`);

      await loadDeal(c, currentDealId, { openDeal: true });
      await loadMyDeals(c, address);
      await loadActiveDeals(c);

      // Ждём, пока Oracle переведёт stage 3 -> 4, чтобы оба окна были синхронны.
      for (let i = 0; i < 12; i++) {
        await delay(2000);
        const latest = await loadDeal(c, currentDealId, { openDeal: true });
        await loadMyDeals(c, address);
        if (latest?.stage >= 4 || latest?.stage === 9) break;
      }
    } catch (e) {
      console.error(e);
      setMmStatus("error");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 4000);
      setMessage(e?.reason || e?.shortMessage || e?.message || "Ошибка подачи данных покупателя");
    } finally {
      setPending(false);
      txLockRef.current = false;
    }
  }

  async function handleReservePayment() {
    if (txLockRef.current || pending) return;

    const currentDealId = getStableDealId();
    if (currentDealId === null) {
      setMessage("Сначала откройте сделку покупателя.");
      return;
    }

    txLockRef.current = true;

    try {
      const { c, address } = await getFresh();
      selectedDealIdRef.current = currentDealId;
      const fresh = await readDeal(c, currentDealId).catch(() => null);

      if (!fresh) {
        setMessage("Сделка не найдена. Откройте её заново из списка моих сделок.");
        return;
      }

      if (normalize(fresh.buyer) !== normalize(address)) {
        setMessage("Оплата доступна только покупателю этой сделки. Переключите MetaMask на адрес покупателя.");
        await loadDeal(c, currentDealId, { openDeal: true });
        return;
      }

      if (Number(fresh.stage) !== 4) {
        setMessage("Оплата сейчас недоступна: сделка уже перешла на другой этап.");
        await loadDeal(c, currentDealId, { openDeal: true });
        await loadMyDeals(c, address);
        return;
      }

      setPending(true);
      setMmStatus("waiting");
      setShowPaymentConfirm(false);
      setMessage("Подтвердите оплату в MetaMask. После оплаты деньги останутся в escrow до проверки продавцом.");

      const tx = await c.reservePayment(currentDealId, { value: fresh.price });
      const receipt = await tx.wait();
      rememberTxHash("payment", currentDealId, receipt.hash);

      setMmStatus("success");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 3000);
      setMessage("💰 Оплата внесена в escrow. Теперь продавец может проверить депозит через explorer и создать заявку в реестр.");
      setAnimPhase(p => p + 1);

      // Force buyer window to stay synchronized until Oracle completes registry transfer.
      for (let i = 0; i < 30; i++) {
        await delay(2000);
        const latest = await loadDeal(c, currentDealId, { openDeal: true });
        await loadMyDeals(c, address);
        await loadActiveDeals(c);

        if (latest?.stage === 8) {
          setMessage("✅ Сделка завершена: право собственности переоформлено, средства переведены продавцу.");
          break;
        }

        if (latest?.stage === 9) {
          setMessage(latest.lastOracleError ? `❌ Сделка отменена: ${latest.lastOracleError}` : "❌ Сделка отменена.");
          break;
        }
      }
    } catch (e) {
      console.error(e);
      setMmStatus("error");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 4000);
      setMessage(e?.reason || e?.shortMessage || e?.message || "Ошибка оплаты");
    } finally {
      setPending(false);
      txLockRef.current = false;
    }
  }

  async function handleSellerConfirmEscrow() {
    const currentDealId = selectedDealIdRef.current ?? dealId;
    if (!contract || currentDealId === null || pending || txLockRef.current) return;

    try {
      txLockRef.current = true;
      setPending(true);
      setMmStatus("waiting");
      setMessage("Подтвердите в MetaMask: продавец проверил депозит и разрешает создание заявки в реестр...");

      const tx = await contract.sellerConfirmEscrowAndRequestRegistry(currentDealId);
      const receipt = await tx.wait();
      rememberTxHash("registryRequest", currentDealId, receipt.hash);

      setMmStatus("success");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 3000);
      setMessage("📋 Заявка в реестр запущена. Ожидаем подтверждение покупателя в сервисе реестра и ответ Oracle.");
      await loadDeal(contract, currentDealId, { openDeal: true });
      await loadMyDeals(contract, accountRef.current);
    } catch (e) {
      console.error(e);
      setMmStatus("error");
      mmTimer.current = setTimeout(() => setMmStatus("idle"), 3000);
      setMessage(`❌ Не удалось создать заявку в реестр: ${e.shortMessage || e.message}`);
    } finally {
      setPending(false);
      txLockRef.current = false;
    }
  }

  useEffect(() => {
    accountRef.current = account;
  }, [account]);

  useEffect(() => {
    const t = setInterval(() => setCurrentTs(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;

    const onAcc = async (accs) => {
      const a = accs?.[0] || "";
      accountRef.current = a;
      listRequestRef.current += 1;
      activeRequestRef.current += 1;
      setAccount(a);
      selectedDealIdRef.current = null;
      setDeal(null);
      setMyDeals([]);
      setActiveDeals([]);
      setDealId(null);
      setReplayStage(null);
      setShowCreateForm(false);
      setMode("home");

      if (!a) {
        setContract(null);
        setMessage("Кошелёк отключён.");
        return;
      }

      try {
        const provider = new ethers.BrowserProvider(window.ethereum);
        const signer = await provider.getSigner();
        const network = await provider.getNetwork();
        setChainId(Number(network.chainId));
        const c = new ethers.Contract(MARKET_ADDRESS, MARKET_ABI, signer);
        setContract(c);

        await loadMyDeals(c, a);
        setDeal(null);
        setDealId(null);
        setMode("home");
        setMessage(
          `Аккаунт изменён: ${shortAddr(a)}. Выберите действие заново или откройте свою сделку из истории.`
        );
      } catch (e) {
        console.warn("accountsChanged:", e);
        setMessage("Аккаунт изменён. Подключите MetaMask заново.");
      }
    };

    const onChain = () => window.location.reload();
    window.ethereum.on("accountsChanged", onAcc);
    window.ethereum.on("chainChanged", onChain);
    return () => {
      window.ethereum.removeListener("accountsChanged", onAcc);
      window.ethereum.removeListener("chainChanged", onChain);
    };
  }, []);


  useEffect(() => {
    const a = anime();
    if (!a) return;
    a({ targets: ".action-btn", translateY: [30, 0], opacity: [0, 1], delay: a.stagger(60, { start: 200 }), duration: 500, easing: "easeOutBack" });
  }, []);

  useEffect(() => {
    if (stage !== 4) setShowPaymentConfirm(false);
  }, [stage, dealId]);

  const oracleLabel = stage === 1 ? "⏳ Oracle проверяет продавца перед созданием активной сделки..."
    : stage === 3 ? "⏳ Oracle проверяет личность покупателя..."
    : stage === 7 ? "⏳ Реестр регистрирует нового владельца..."
    : null;

  useEffect(() => {
  if (isCompleted) {
    setMessage("✅ Сделка завершена: новый владелец зарегистрирован, средства переведены продавцу. Можно создать новую сделку или подключиться к другой; завершённая сделка сохранена в истории.");
    if (contract && account) loadMyDeals(contract, account);
  }

  if (isCancelled) {
    if (deal?.lastOracleError) {
      setMessage(`❌ Сделка отменена: ${deal.lastOracleError}`);
    } else {
      setMessage("❌ Сделка отменена.");
    }
  }
}, [isCompleted, isCancelled, deal?.lastOracleError]);


  useEffect(() => {
    if (!deal || !account) return;

    // Сделка, снятая продавцом, не должна оставаться открытой ни у продавца,
    // ни тем более у покупателя. Закрываем её из интерфейса и обновляем списки.
    if (isCancelledDeal(deal) && !deal.lastOracleError) {
      setDeal(null);
      setDealId(null);
      setMode("home");
      setShowCreateForm(false);
      setReplayStage(null);
      setMessage("Эта сделка снята продавцом с публикации и больше не отображается в интерфейсе.");
      if (contract) {
        loadActiveDeals(contract);
        loadMyDeals(contract, account);
      }
    }
  }, [deal?.id, deal?.stage, deal?.lastOracleError, account]);

  return (
    <main className="page">
      <MetaMaskToast status={mmStatus} onClose={closeMm} />

      <section className="hero">
        <div>
          <p className="eyebrow">Real Estate Smart Contract dApp</p>
          <h1>Передача права собственности<br/>через смарт-контракт</h1>
          <p className="subtitle">
            Оракул верифицирует стороны, смарт-контракт хранит деньги в escrow,
            реестр автоматически переоформляет право собственности.
          </p>
        </div>
        <button className="connectButton" onClick={connectWallet}>
          {account ? <><span className="connect-dot"/>{shortAddr(account)}</> : "Подключить MetaMask"}
        </button>
      </section>

      <section className="statusPanel">
        <div><span>Роль</span><strong>{role}</strong></div>
        <div><span>Этап сделки</span><strong>{deal ? getStageLabel(stage) : "—"}</strong></div>
        <div><span>Баланс escrow</span>
          <strong>{deal?.contractBalance !== undefined ? `${ethers.formatEther(deal.contractBalance)} ETH` : "—"}</strong>
        </div>
      </section>

      {oracleLabel && (
        <div className="oracle-waiting">
          <div className="oracle-waiting__dot"/>
          <div>
            <span>{oracleLabel}</span>
            <span className="oracle-waiting__sub">oracle-backend обрабатывает запрос (~2–3 сек)</span>
          </div>
        </div>
      )}

      {deal && <StageProgress stage={progressStage} isCancelled={isCancelled}/>}

      <section className="deal-workbench">
        <div className="deal-workbench__scene">
      <AnimatedScene
        visualStage={visualStage}
        isCompleted={isCompleted}
        isCancelled={isCancelled}
        deal={deal}
        buyerNameInput={buyerName}
        certificateLocation={certLocation}
        moneyLocation={moneyLocation}
        onCertificateClick={() => setIsCertOpen(true)}
        onMoneyClick={() => {}}
        animationTrigger={animPhase}
      />
        </div>

      <aside className="controls controls--side">

        {/* Start screen */}
        {account && !deal && mode === "home" && (
          <>
            <button
              className="action-btn action-btn--blue"
              style={{ gridColumn: "1/-1" }}
              disabled={pending}
              onClick={openCreateMode}
            >
              <span className="action-btn__num">＋</span>
              <span className="action-btn__text">
                <strong>Создать сделку</strong>
                <small>Роль продавца: создать объект и запустить проверку</small>
              </span>
            </button>

            <button
              className="action-btn action-btn--purple"
              style={{ gridColumn: "1/-1" }}
              disabled={pending || !contract}
              onClick={() => openJoinMode(contract)}
            >
              <span className="action-btn__num">↪</span>
              <span className="action-btn__text">
                <strong>Подключиться к сделке</strong>
                <small>Роль покупателя: выбрать подтверждённую сделку</small>
              </span>
            </button>
          </>
        )}

        {/* Create deal */}
        {account && !deal && mode === "create" && (
          <>
            <button
              className="action-btn action-btn--purple"
              style={{ gridColumn: "1/-1" }}
              disabled={pending}
              onClick={() => {
                setMode("home");
                setShowCreateForm(false);
                setMessage("Выберите действие: создать сделку или подключиться к сделке.");
              }}
            >
              <span className="action-btn__num">←</span>
              <span className="action-btn__text">
                <strong>Назад</strong>
                <small>Вернуться к выбору роли</small>
              </span>
            </button>

            <div style={{ gridColumn: "1/-1" }}>
              <CreateDealForm onSubmit={handleCreateDeal} disabled={pending} />
            </div>
          </>
        )}

        {/* Join deal */}
        {account && !deal && mode === "join" && (
          <>
            <button
              className="action-btn action-btn--purple"
              style={{ gridColumn: "1/-1" }}
              disabled={pending}
              onClick={() => {
                setMode("home");
                setActiveDeals([]);
                setManualDealId("");
                setMessage("Выберите действие: создать сделку или подключиться к сделке.");
              }}
            >
              <span className="action-btn__num">←</span>
              <span className="action-btn__text">
                <strong>Назад</strong>
                <small>Вернуться к выбору роли</small>
              </span>
            </button>

            <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
              <label>ID сделки</label>
              <input
                type="number"
                placeholder="Введите ID сделки, если он известен"
                value={manualDealId}
                onChange={e => setManualDealId(e.target.value)}
              />
              <button
                className="action-btn action-btn--blue"
                disabled={pending || manualDealId === ""}
                style={{ marginTop: 12, width: "100%" }}
                onClick={async () => {
                  const id = Number(manualDealId);
                  if (Number.isNaN(id)) return;
                  const d = await readDeal(contract, id).catch(() => null);
                  if (!d) {
                    setMessage(`Не удалось загрузить сделку #${id}.`);
                    return;
                  }
                  if (!isPublicActiveDeal(d)) {
                    setDeal(null);
                    setDealId(null);
                    setMode("join");
                    if (isCancelledDeal(d)) {
                      setMessage(`Сделка #${id} отменена или снята продавцом и не доступна для подключения.`);
                    } else if (!isZeroAddress(d.buyer)) {
                      setMessage(`Сделка #${id} уже занята другим покупателем.`);
                    } else {
                      setMessage(`Сделка #${id} пока не опубликована для покупателей.`);
                    }
                    await loadActiveDeals(contract);
                    return;
                  }
                  await loadDeal(contract, id, { openDeal: true, replayVerifiedSeller: true });
                  setMessage(`Открыта активная сделка #${id}. Теперь можно подключиться как покупатель.`);
                }}
              >
                <span className="action-btn__num">#</span>
                <span className="action-btn__text">
                  <strong>Открыть по ID</strong>
                  <small>Если номер сделки передан напрямую</small>
                </span>
              </button>
            </div>

            <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
              <label>Активные подтверждённые сделки</label>
              <button
                className="action-btn action-btn--blue"
                disabled={pending || activeDealsLoading}
                style={{ marginBottom: 12, width: "100%" }}
                onClick={() => loadActiveDeals(contract)}
              >
                <span className="action-btn__num">↻</span>
                <span className="action-btn__text">
                  <strong>{activeDealsLoading ? "Загружаем..." : "Обновить список"}</strong>
                  <small>Показываются сделки после проверки продавца</small>
                </span>
              </button>

              {activeDeals.length === 0 && (
                <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
                  {activeDealsLoading ? "Загрузка..." : "Пока нет активных сделок, подтверждённых оракулом."}
                </p>
              )}

              {activeDeals.filter(isPublicActiveDeal).map(item => (
                <button
                  key={item.id}
                  className="action-btn action-btn--green"
                  disabled={pending}
                  style={{ marginTop: 10, width: "100%", textAlign: "left" }}
                  onClick={async () => {
                    const fresh = await readDeal(contract, item.id).catch(() => null);
                    if (!fresh || !isPublicActiveDeal(fresh)) {
                      setDeal(null);
                      setDealId(null);
                      setMode("join");
                      setMessage(`Сделка #${item.id} уже недоступна: она отменена, занята покупателем или ещё не опубликована.`);
                      await loadActiveDeals(contract);
                      return;
                    }
                    await loadDeal(contract, item.id, { openDeal: true, replayVerifiedSeller: true });
                  }}
                >
                  <span className="action-btn__num">#{item.id}</span>
                  <span className="action-btn__text">
                    <strong>{item.cadastralNumber}</strong>
                    <small>
                      {item.sellerFullName || "Продавец подтверждён"} · {ethers.formatEther(item.price)} ETH · {shortAddr(item.seller)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          </>
        )}


        {/* Completed deal actions */}
        {account && deal && isCompleted && (
          <>
            <button
              className="action-btn action-btn--blue"
              style={{ gridColumn: "1/-1" }}
              disabled={pending}
              onClick={openCreateMode}
            >
              <span className="action-btn__num">＋</span>
              <span className="action-btn__text">
                <strong>Создать новую сделку</strong>
                <small>Завершённая сделка останется в истории</small>
              </span>
            </button>

            <button
              className="action-btn action-btn--purple"
              style={{ gridColumn: "1/-1" }}
              disabled={pending || !contract}
              onClick={() => openJoinMode(contract)}
            >
              <span className="action-btn__num">↪</span>
              <span className="action-btn__text">
                <strong>Подключиться к другой сделке</strong>
                <small>Выбрать активную сделку из списка</small>
              </span>
            </button>
          </>
        )}

        {/* Close cancelled deal from UI only */}
        {canCloseCancelledDeal && (
          <button
            className="action-btn action-btn--purple"
            style={{ gridColumn: "1/-1" }}
            disabled={pending}
            onClick={() => {
              setDeal(null);
              setDealId(null);
              setReplayStage(null);
              setMode("home");
              setShowCreateForm(false);
              setMessage("Отменённая сделка закрыта в интерфейсе. Можно выбрать новое действие.");
            }}
          >
            <span className="action-btn__num">↺</span>
            <span className="action-btn__text">
              <strong>Закрыть отменённую сделку</strong>
              <small>Не влияет на блокчейн, только очищает экран</small>
            </span>
          </button>
        )}

        {/* Seller — submit data, stage 0 */}
        {isSeller && deal && stage === 0 && false && (
          <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
            <label>ФИО продавца</label>
            <input value={sellerName} onChange={e => setSellerName(e.target.value)} placeholder="Ivan Petrov"/>
            <label style={{ marginTop: 10 }}>Хеш паспорта</label>
            <input value={sellerPassport} onChange={e => setSellerPassport(e.target.value)} placeholder="hash_..."/>
            <button
              className="action-btn action-btn--orange"
              disabled={pending}
              style={{ marginTop: 12, width: "100%" }}
              onClick={() => runTx(
                c => c.submitSellerData(dealId, sellerName, sellerPassport),
                "✍️ Данные продавца отправлены. Оракул проверяет право собственности в реестре...",
                "Ожидаем ответ оракула..."
              )}
            >
              <span className="action-btn__num">1</span>
              <span className="action-btn__text">
                <strong>Подать данные продавца</strong>
                <small>Оракул проверит владельца в реестре</small>
              </span>
            </button>
          </div>
        )}

        {/* Buyer — submit data, stage 2. If buyer is not assigned yet, any non-seller account can join. */}
        {(isBuyer || canJoinAsBuyer) && deal && stage === 2 && (
          <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
            <label>ФИО покупателя</label>
            <input value={buyerName} onChange={e => setBuyerName(e.target.value)} placeholder="Kristina Maykushina"/>
            <label style={{ marginTop: 10 }}>Хеш паспорта</label>
            <input value={buyerPassport} onChange={e => setBuyerPassport(e.target.value)} placeholder="hash_..."/>
            <button className="action-btn action-btn--blue" disabled={pending} style={{ marginTop: 12, width: "100%" }}
              onClick={handleSubmitBuyerData}>
              <span className="action-btn__num">2</span>
              <span className="action-btn__text"><strong>Подать данные покупателя</strong><small>Oracle проверит личность</small></span>
            </button>
          </div>
        )}

        {/* Buyer — reserve payment, stage 4. Payment is always a separate explicit action. */}
        {isBuyer && deal && stage === 4 && (
          <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
            <strong>Оплата в escrow</strong>
            <p style={{ margin: "8px 0 12px", color: "#64748b", lineHeight: 1.5 }}>
              Покупатель прошёл проверку Oracle. Деньги ещё не списаны.
              Для оплаты нужна отдельная транзакция MetaMask на сумму {priceEth} ETH.
            </p>

            {!showPaymentConfirm ? (
              <button
                type="button"
                className="action-btn action-btn--green"
                style={{ width: "100%" }}
                disabled={pending}
                onClick={() => {
                  setShowPaymentConfirm(true);
                  setMessage("Проверьте сумму и нажмите подтверждение оплаты. Без этого ETH не отправляются в escrow.");
                }}
              >
                <span className="action-btn__num">3</span>
                <span className="action-btn__text">
                  <strong>Перейти к оплате</strong>
                  <small>Показать подтверждение перед отправкой ETH</small>
                </span>
              </button>
            ) : (
              <>
                <button
                  type="button"
                  className="action-btn action-btn--green"
                  style={{ width: "100%", marginBottom: 8 }}
                  disabled={pending}
                  onClick={handleReservePayment}
                >
                  <span className="action-btn__num">✓</span>
                  <span className="action-btn__text">
                    <strong>Подтвердить оплату {priceEth} ETH</strong>
                    <small>Отдельная транзакция MetaMask</small>
                  </span>
                </button>
                <button
                  type="button"
                  className="action-btn action-btn--purple"
                  style={{ width: "100%" }}
                  disabled={pending}
                  onClick={() => setShowPaymentConfirm(false)}
                >
                  <span className="action-btn__num">←</span>
                  <span className="action-btn__text">
                    <strong>Отмена оплаты</strong>
                    <small>Вернуться без отправки ETH</small>
                  </span>
                </button>
              </>
            )}
          </div>
        )}


        {/* Seller — after payment, confirm escrow and start registry request */}
        {isSeller && deal && stage === 5 && (
          <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
            <strong>Проверка escrow продавцом</strong>
            <p style={{ margin: "8px 0 12px", color: "#64748b", lineHeight: 1.5 }}>
              Покупатель внёс оплату. Ниже в блоке «Публичная проверка escrow» показаны адрес escrow-контракта, сумма сделки, сумма в escrow и ссылка на Etherscan. В локальной сети ссылка станет активной автоматически после деплоя в Sepolia.
            </p>
            <button
              type="button"
              className="action-btn action-btn--blue"
              style={{ width: "100%" }}
              disabled={pending}
              onClick={handleSellerConfirmEscrow}
            >
              <span className="action-btn__num">4</span>
              <span className="action-btn__text">
                <strong>Деньги проверены, создать заявку в реестр</strong>
                <small>Отдельная транзакция MetaMask от продавца</small>
              </span>
            </button>
          </div>
        )}

        {/* Seller can cancel only while buyer has not joined */}
        {canSellerCancelListing && (
          <button className="action-btn action-btn--red danger" disabled={pending}
            onClick={async () => {
              await runTx(
                c => c.cancelDeal(dealId, "Отменено продавцом до подключения покупателя"),
                "❌ Продавец снимает сделку из активных...",
                "Сделка отменена продавцом и больше не отображается в списке активных."
              );
              setDeal(null);
              setDealId(null);
              setMode("home");
              setShowCreateForm(false);
              setMessage("Сделка снята продавцом с публикации. Она больше не отображается в активных сделках и в истории.");
              if (contract && account) await loadMyDeals(contract, account);
              if (contract) await loadActiveDeals(contract);
            }}>
            <span className="action-btn__num">✕</span>
            <span className="action-btn__text">
              <strong>Снять сделку с публикации</strong>
              <small>Доступно, пока покупатель ещё не подключён</small>
            </span>
          </button>
        )}

        {/* Buyer can leave only before escrow payment. Uses cancelDealAsBuyer alias so the existing ABI keeps working. */}
        {canBuyerLeaveBeforePayment && (
          <button className="action-btn action-btn--red danger" disabled={pending}
            onClick={async () => {
              const leaveDealId = getStableDealId();
              if (leaveDealId === null) { setMessage("Сначала откройте свою сделку покупателя."); return; }
              const freshDeal = await loadDeal(contract, leaveDealId, { openDeal: true });
              if (!freshDeal || normalize(freshDeal.buyer) !== normalize(account)) {
                setMessage("Этот адрес не является покупателем выбранной сделки. Переключите MetaMask на аккаунт покупателя или выберите свою сделку заново.");
                return;
              }
              if (!(freshDeal.stage === 3 || freshDeal.stage === 4)) {
                setMessage("Выйти из сделки можно только после подачи данных покупателя и до оплаты в escrow.");
                return;
              }
              await runTx(
                c => c.cancelDealAsBuyer(leaveDealId, "Покупатель вышел из сделки до оплаты"),
                "🚪 Покупатель выходит из сделки. Сделка возвращается в список активных...",
                "Покупатель вышел из сделки. Сделка снова доступна для новых покупателей."
              );

              // После выхода buyer больше не является участником этой сделки.
              // Поэтому не оставляем его на экране сделки stage=2, иначе UI выглядит так,
              // будто он снова должен подавать данные покупателя.
              setDeal(null);
              setDealId(null);
              setReplayStage(null);
              setMode("home");
              setShowCreateForm(false);
              setMessage("Вы вышли из сделки. Теперь можно создать новую сделку или подключиться к другой.");

              if (contract && account) await loadMyDeals(contract, account);
              if (contract) await loadActiveDeals(contract);
            }}>
            <span className="action-btn__num">↩</span>
            <span className="action-btn__text">
              <strong>Выйти из сделки</strong>
              <small>До оплаты: buyer сбрасывается, сделка снова активна</small>
            </span>
          </button>
        )}

        {isBuyer && deal && stage === 3 && !isCompleted && !isCancelled && (
          <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
            <p style={{ margin: 0, color: "#64748b", fontSize: 13 }}>
              Данные покупателя отправлены. Дождитесь ответа Oracle. После успешной проверки можно будет либо оплатить сделку, либо выйти из неё до оплаты.
            </p>
          </div>
        )}

        {isSeller && deal && stage >= 2 && stage < 8 && !isCancelled && (
          <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
            <label>Статус действий покупателя</label>
            <p style={{ margin: "6px 0 0", color: "#475569", fontSize: 13, lineHeight: 1.45 }}>
              {stage === 2 && !hasBuyer && "Покупатель ещё не подключился. Сделка находится в списке активных подтверждённых сделок."}
              {stage === 3 && `Покупатель ${buyerDisplayName} отправил личные данные. Oracle выполняет проверку.`}
              {stage === 4 && `Покупатель ${buyerDisplayName} прошёл проверку. Ожидается оплата в escrow.`}
              {stage === 5 && `Покупатель ${buyerDisplayName} внёс оплату в escrow. Проверьте депозит через explorer и нажмите кнопку создания заявки в реестр.`}
              {stage === 6 && "Продавец подтвердил escrow. Oracle создаёт заявку в реестр."}
              {stage === 7 && "Oracle переоформляет право собственности в реестре. Действия продавца не требуются."}
            </p>
            {hasBuyer && (
              <p style={{ margin: "8px 0 0", color: "#64748b", fontSize: 12 }}>
                Адрес покупателя: {shortAddr(deal.buyer)}
              </p>
            )}
          </div>
        )}

        {deal && stage === 4 && isSeller && paymentPassed && (
          <button className="action-btn action-btn--purple" disabled={pending}
            onClick={() => runTx(c => c.claimTimeoutCancellation(dealId), "⏱ Срок истёк...", "Отменена по сроку.")}>
            <span className="action-btn__num">⏱</span>
            <span className="action-btn__text"><strong>Истёк срок оплаты</strong><small>Вернуть сертификат</small></span>
          </button>
        )}

        {/* Refresh button */}
        {deal && (
          <button className="action-btn action-btn--blue" disabled={pending}
            onClick={() => { const id = getStableDealId(); if (id !== null) loadDeal(contract, id); }}>
            <span className="action-btn__num">↻</span>
            <span className="action-btn__text"><strong>Обновить данные</strong><small>Перечитать из контракта</small></span>
          </button>
        )}


        {/* My deals history */}
        {account && mode !== "join" && myDealsForCurrent.length > 0 && (
          <div className="nameInputBox" style={{ gridColumn: "1/-1" }}>
            <label>Мои сделки {myDealsLoading ? "— обновляем..." : ""}</label>
            {myDealsForCurrent.slice(0, 5).map(item => {
              const itemRole = normalize(item.seller) === normalize(account) ? "продавец" : "покупатель";
              return (
                <button
                  key={`history-${item.id}`}
                  className="action-btn action-btn--purple"
                  disabled={pending}
                  style={{ marginTop: 8, width: "100%", textAlign: "left" }}
                  onClick={() => loadDeal(contract, item.id, { openDeal: true })}
                >
                  <span className="action-btn__num">#{item.id}</span>
                  <span className="action-btn__text">
                    <strong>{item.cadastralNumber || "Объект недвижимости"}</strong>
                    <small>{itemRole} · {getStageLabel(item.stage)} · {ethers.formatEther(item.price)} ETH</small>
                  </span>
                </button>
              );
            })}
          </div>
        )}
<section className={`messageBox ${pending || isAnimating ? "messageBox--pending" : ""}`}>
        <strong>{pending ? "⏳ Выполняется..." : isAnimating ? "🎬 Анимация..." : "Что происходит:"}</strong>
        <p>{visibleMessage}</p>
        {(pending || isAnimating) && <div className="messageBox__pulse"/>}
      </section>
      </aside>
      </section>

      {deal && <PublicVerificationBox deal={deal} chainId={chainId} txHashes={txHashes} />}

      {deal && (
        <section className="details">
          <h2>Данные сделки #{deal.id}</h2>
          <div className="grid">
            <p><span>Цена</span>{priceEth} ETH</p>
            <p><span>Продавец</span>{shortAddr(deal.seller)}</p>
            <p><span>Покупатель</span>{!isZeroAddress(deal.buyer) ? shortAddr(deal.buyer) : "не назначен"}</p>
            <p><span>Этап</span>{getStageLabel(stage)}</p>
            <p><span>ФИО продавца</span>{deal.sellerFullName || "—"}</p>
            <p><span>ФИО покупателя</span>{deal.buyerFullName || "—"}</p>
            <p><span>Кадастровый №</span>{deal.cadastralNumber}</p>
            <p><span>Адрес объекта</span>{deal.apartmentAddress}</p>
            <p><span>ID в реестре (до)</span>{deal.registryRecordId || "—"}</p>
            <p><span>ID в реестре (после)</span>{deal.newRegistryRecordId || "—"}</p>
            <p><span>Срок оплаты</span>{fmtTime(deal.paymentDeadline)}</p>
            <p><span>Осталось</span>{stage === 4 ? fmtSec(secToDeadline) : "—"}</p>
            <p><span>Создана</span>{fmtTime(deal.createdAt)}</p>
            <p><span>Завершена</span>{fmtTime(deal.completedAt)}</p>
            {deal.lastOracleError && <p style={{ gridColumn:"1/-1", background:"#fef2f2", borderColor:"#fca5a5" }}><span>Ошибка оракула</span>{deal.lastOracleError}</p>}
          </div>
        </section>
      )}

      {isCertOpen && (
        <div className="modalBackdrop" onClick={() => setIsCertOpen(false)}>
          <div className="modalCard" onClick={e => e.stopPropagation()}>
            <div className="modalHeader"><h2>📄 Сертификат</h2><button onClick={() => setIsCertOpen(false)}>×</button></div>
            <pre className="contractPreview">{`Объект: ${deal?.apartmentAddress || "—"}
Кадастровый: ${deal?.cadastralNumber || "—"}
Цена: ${priceEth} ETH
Продавец: ${deal?.sellerFullName || "—"} (${shortAddr(deal?.seller)})
Покупатель: ${deal?.buyerFullName || "—"} (${shortAddr(deal?.buyer)})
Этап: ${getStageLabel(stage)}
ID реестра (новый): ${deal?.newRegistryRecordId || "ожидание..."}
Завершена: ${fmtTime(deal?.completedAt)}`}</pre>
            <div className="modalActions"><button onClick={() => setIsCertOpen(false)}>Закрыть</button></div>
          </div>
        </div>
      )}
    </main>
  );
}