import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "./style.css";

const API = import.meta.env.VITE_REGISTRY_API_URL || "http://localhost:3002";

const STATUS_LABELS = {
  WAITING_BUYER_APPROVAL: "Ожидает подтверждения покупателя",
  BUYER_APPROVED: "Покупатель подтвердил, идёт переоформление",
  OWNERSHIP_TRANSFERRED: "Право собственности переоформлено",
  REJECTED: "Заявка отклонена",
};

const ACTIVE_REQUEST_STATUSES = new Set(["WAITING_BUYER_APPROVAL"]);

function shortAddress(value) {
  if (!value) return "—";
  return `${value.slice(0, 8)}…${value.slice(-6)}`;
}

function fmtEth(value) {
  if (!value) return "—";
  return `${value} ETH`;
}

function fmtDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("ru-RU");
}

async function api(path, options = {}) {
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

function Login({ onLogin }) {
  const [email, setEmail] = useState("buyer@example.com");
  const [passport, setPassport] = useState("HB1234567");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, passport }),
      });
      onLogin({ ...data.user, email, passport });
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="badge">Mock Registry Service</div>
        <h1>Госреестр недвижимости</h1>
        <p>
          Демонстрационный независимый сервис для проверки имущества и подтверждения заявок на
          переоформление. Здесь нет MetaMask — вход выполняется как в обычном государственном сервисе.
        </p>

        <form onSubmit={submit} className="form">
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="buyer@example.com" />
          </label>
          <label>
            Паспорт
            <input value={passport} onChange={(e) => setPassport(e.target.value)} placeholder="HB1234567" />
          </label>
          {error && <div className="error">{error}</div>}
          <button disabled={loading}>{loading ? "Вход..." : "Войти"}</button>
        </form>

        <div className="demo-logins">
          <b>Демо-доступы:</b>
          <span>Покупатель: buyer@example.com / HB1234567</span>
          <span>Продавец: seller@example.com / MP1234567</span>
        </div>
      </section>
    </main>
  );
}

function RequestDetails({ request }) {
  return (
    <div className="grid two">
      <div><span>Объект</span><b>{request.propertyAddress || "—"}</b></div>
      <div><span>Сумма escrow</span><b>{fmtEth(request.priceEth)}</b></div>
      <div><span>Продавец</span><b>{request.sellerFullName}</b><small>{shortAddress(request.sellerAddress)}</small></div>
      <div><span>Покупатель</span><b>{request.buyerFullName}</b><small>{shortAddress(request.buyerAddress)}</small></div>
      <div><span>Escrow-контракт</span><b>{shortAddress(request.escrowContract)}</b></div>
      <div><span>Старая запись</span><b>{request.oldRegistryId || "—"}</b></div>
      <div><span>Новая запись</span><b>{request.newRegistryId || "ещё не создана"}</b></div>
      <div><span>Proof</span><b>{request.proofHash || "ещё не создан"}</b></div>
      <div><span>Создана</span><b>{fmtDate(request.createdAt)}</b></div>
      <div><span>Подтверждена покупателем</span><b>{fmtDate(request.buyerApprovedAt)}</b></div>
      <div><span>Переоформлена</span><b>{fmtDate(request.transferredAt)}</b></div>
      <div><span>Отклонена</span><b>{fmtDate(request.rejectedAt)}</b></div>
    </div>
  );
}

function RequestCard({ request, user, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isBuyer = request.buyerFullName?.toLowerCase() === user.fullName?.toLowerCase() ||
    request.buyerAddress?.toLowerCase() === user.walletAddress?.toLowerCase();
  const canApprove = isBuyer && request.status === "WAITING_BUYER_APPROVAL";

  async function approve() {
    setBusy(true);
    setError("");
    try {
      await api(`/transfer-requests/${request.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ email: user.email, passport: user.passport }),
      });
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function reject() {
    setBusy(true);
    setError("");
    try {
      await api(`/transfer-requests/${request.id}/reject`, {
        method: "POST",
        body: JSON.stringify({ email: user.email, passport: user.passport, reason: "Отклонено покупателем" }),
      });
      await onChanged();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="card request-card">
      <div className="card-head">
        <div>
          <h3>{request.id}</h3>
          <p>Сделка #{request.dealId} · {request.cadastralNumber}</p>
        </div>
        <span className={`status ${request.status}`}>{STATUS_LABELS[request.status] || request.status}</span>
      </div>

      <RequestDetails request={request} />

      {canApprove && (
        <div className="actions">
          <button onClick={approve} disabled={busy}>Подтвердить переоформление на меня</button>
          <button className="secondary" onClick={reject} disabled={busy}>Отклонить</button>
        </div>
      )}
      {request.status === "BUYER_APPROVED" && (
        <p className="hint">Реестр выполняет переоформление. Через несколько секунд Oracle получит готовность новой записи и отправит сигнал смарт-контракту.</p>
      )}
      {request.status === "OWNERSHIP_TRANSFERRED" && (
        <p className="success">Право собственности переоформлено. Oracle может подтвердить сделку в blockchain.</p>
      )}
      {error && <div className="error">{error}</div>}
    </article>
  );
}

function HistoryRequestRow({ request, expanded, onToggle }) {
  return (
    <article className="card history-card">
      <button className="history-row" type="button" onClick={onToggle}>
        <span className="history-main">
          <b>{request.id}</b>
          <small>Сделка #{request.dealId} · {request.cadastralNumber}</small>
        </span>
        <span className={`status ${request.status}`}>{STATUS_LABELS[request.status] || request.status}</span>
        <span className="history-open">{expanded ? "Свернуть" : "Открыть"}</span>
      </button>
      {expanded && (
        <div className="history-details">
          <RequestDetails request={request} />
        </div>
      )}
    </article>
  );
}

function RegistryApp() {
  const saved = useMemo(() => {
    try { return JSON.parse(localStorage.getItem("registryUser") || "null"); } catch { return null; }
  }, []);
  const [user, setUser] = useState(saved);
  const [properties, setProperties] = useState([]);
  const [requests, setRequests] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState("");
  const [expandedHistoryId, setExpandedHistoryId] = useState(null);

  function login(nextUser) {
    localStorage.setItem("registryUser", JSON.stringify(nextUser));
    setUser(nextUser);
  }

  function logout() {
    localStorage.removeItem("registryUser");
    setUser(null);
  }

  async function load() {
    if (!user) return;
    setError("");
    try {
      const qs = `email=${encodeURIComponent(user.email)}&passport=${encodeURIComponent(user.passport)}`;
      const [statusData, propertyData, requestData] = await Promise.all([
        api("/status"),
        api(`/properties?${qs}`),
        api(`/transfer-requests?${qs}`),
      ]);
      setStatus(statusData);
      setProperties(propertyData.properties || []);
      setRequests(requestData.requests || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => {
    load();
    const timer = setInterval(load, 2500);
    return () => clearInterval(timer);
  }, [user?.email, user?.passport]);

  const activeRequests = requests.filter((request) => ACTIVE_REQUEST_STATUSES.has(request.status));
  const historyRequests = requests
    .filter((request) => !ACTIVE_REQUEST_STATUSES.has(request.status))
    .sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));

  if (!user) return <Login onLogin={login} />;

  return (
    <main className="app">
      <header className="topbar">
        <div>
          <div className="badge">Официальный mock-реестр</div>
          <h1>Личный кабинет реестра</h1>
          <p>Проверка имущества и подтверждение заявок на переход права собственности.</p>
        </div>
        <div className="profile">
          <b>{user.fullName}</b>
          <span>{user.email}</span>
          <small>{shortAddress(user.walletAddress)}</small>
          <button className="secondary" onClick={logout}>Выйти</button>
        </div>
      </header>

      {error && <div className="error wide">{error}</div>}

      <section className="summary">
        <div className="mini"><span>Сервис</span><b>{status?.status || "—"}</b></div>
        <div className="mini"><span>Моё имущество</span><b>{properties.length}</b></div>
        <div className="mini"><span>Требуют действия</span><b>{activeRequests.length}</b></div>
        <div className="mini"><span>История заявок</span><b>{historyRequests.length}</b></div>
      </section>

      <section>
        <h2>Входящие заявки на переоформление</h2>
        {activeRequests.length === 0 ? (
          <div className="empty">Нет заявок, которые требуют подтверждения. Подтверждённые и завершённые заявки перенесены в историю ниже.</div>
        ) : (
          <div className="list">
            {activeRequests.map((request) => <RequestCard key={request.id} request={request} user={user} onChanged={load} />)}
          </div>
        )}
      </section>

      <section>
        <h2>История заявок</h2>
        {historyRequests.length === 0 ? (
          <div className="empty">История пока пуста. После подтверждения заявка будет свёрнута и сохранена здесь.</div>
        ) : (
          <div className="list compact-list">
            {historyRequests.map((request) => (
              <HistoryRequestRow
                key={request.id}
                request={request}
                expanded={expandedHistoryId === request.id}
                onToggle={() => setExpandedHistoryId((current) => current === request.id ? null : request.id)}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2>Имущество в реестре</h2>
        {properties.length === 0 ? (
          <div className="empty">На этот аккаунт пока не зарегистрировано имущество.</div>
        ) : (
          <div className="list property-list">
            {properties.map((item) => (
              <article className="card" key={item.cadastralNumber}>
                <div className="card-head">
                  <div>
                    <h3>{item.cadastralNumber}</h3>
                    <p>{item.propertyAddress}</p>
                  </div>
                  <span className="status ACTIVE">{item.status}</span>
                </div>
                <div className="grid two">
                  <div><span>Собственник</span><b>{item.ownerName}</b></div>
                  <div><span>Адрес кошелька</span><b>{shortAddress(item.ownerAddress)}</b></div>
                  <div><span>Запись реестра</span><b>{item.registryId}</b></div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById("root")).render(<RegistryApp />);
