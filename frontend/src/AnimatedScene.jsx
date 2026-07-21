import { useEffect, useRef, useState } from 'react';
import { ethers } from 'ethers';

/**
 * AnimatedScene — сцена сделки, где центр процесса — смарт-контракт.
 *
 * Логика:
 * 1. Сертификат/шаблон сделки сразу хранится в смарт-контракте.
 * 2. Продавец и покупатель отправляют данные в смарт-контракт.
 * 3. Данные НЕ отправляются в блокчейн сразу: они лежат в смарт-контракте до завершения сделки.
 * 4. Смарт-контракт создаёт запрос Oracle.
 * 5. Oracle проверяет данные через Реестр недвижимости и Орган проверки личности.
 * 6. После подтверждения Oracle отправляет зелёную галочку обратно в смарт-контракт.
 * 7. После оплаты смарт-контракт удерживает ETH, затем в финале: данные и сертификат записываются в блокчейн, деньги → продавцу, ключи → покупателю.
 */

const W = 900;
const H = 580;

const POS = {
  house: { x: 450, y: 82 },

  // персонажи по краям сцены, крупнее и без наложений
  seller: { x: 155, y: 428 },
  buyer: { x: 775, y: 428 },
  buyerHome: { x: 595, y: 200 },

  // центр — смарт-контракт, ниже блокчейн, ниже Oracle
  escrow: { x: 450, y: 200 },
  blockchain: { x: 490, y: 390 },
  oracle: { x: 450, y: 520 },
  registry: { x: 230, y: 550 },
  identity: { x: 640, y: 550 },

  // данные сначала у сторон, затем в контракт, затем в блокчейн и исчезают
  sellerDataStart: { x: 250, y: 318 },
  buyerDataStart: { x: 650, y: 318 },
  dataEscrow: { x: 450, y: 308 },
  dataChain: { x: 450, y: 390 },

  cert: { x: 450, y: 280 },
  certBlockchain: { x: 525, y: 392 },
  moneyStart: { x: 820, y: 320 },
  moneyEscrow: { x: 510, y: 270 },
  moneySeller: { x: 110, y: 315 },

  // ключ изначально рядом с продавцом, потом к покупателю, финально к дому
  keysSeller: { x: 100, y: 340 },
  keysBuyer: { x: 720, y: 302 },
  keysHome: { x: 635, y: 100 },
};

function easeInOutCubic(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
function lerp(a, b, t) { return a + (b - a) * t; }

export default function AnimatedScene({
  visualStage = 0,
  isCompleted,
  isCancelled,
  deal,
  buyerNameInput,
  certificateLocation,
  moneyLocation,
  onCertificateClick,
  onMoneyClick,
  animationTrigger,
}) {
  const canvasRef = useRef(null);
  const ctxRef = useRef(null);
  const rafRef = useRef(null);
  const [imagesReady, setImagesReady] = useState(false);
  const imgsRef = useRef({ person: null, cert: null, money: null });

  const stateRef = useRef({
    currentStage: -1,
    cert: { x: POS.cert.x, y: POS.cert.y, scale: 1, opacity: 1 },
    money: { x: POS.moneyStart.x, y: POS.moneyStart.y, scale: 1, opacity: 0 },
    // ключ изначально у продавца
    keys: { x: POS.keysSeller.x, y: POS.keysSeller.y, scale: 1, opacity: 1 },
    buyerPos: { x: POS.buyer.x, y: POS.buyer.y, scale: 1 },
    sellerData: { x: POS.sellerDataStart.x, y: POS.sellerDataStart.y, scale: 1, opacity: 0 },
    buyerData: { x: POS.buyerDataStart.x, y: POS.buyerDataStart.y, scale: 1, opacity: 0 },
    oracleCheck: { x: POS.oracle.x, y: POS.oracle.y, scale: 1, opacity: 0 },
    chainPulse: 0,
    oraclePulse: 0,
    oracleActive: false,
    registryActive: false,
    identityActive: false,
    completedBadgeOpacity: 0,
    celebrationParticles: [],
  });

  useEffect(() => {
    let loaded = 0;
    const total = 3;
    const done = () => { if (++loaded === total) setImagesReady(true); };
    const load = (key, src) => {
      const img = new Image();
      img.onload = () => { imgsRef.current[key] = img; done(); };
      img.onerror = () => done();
      img.src = src;
    };
    load('person', '/images/castomer.png');
    load('cert', '/images/document.png');
    load('money', '/images/money.png');
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = '100%';
    canvas.style.height = 'auto';
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    ctxRef.current = ctx;
  }, []);

  useEffect(() => {
    const s = stateRef.current;
    if (s.currentStage === visualStage && s.currentStage !== -1) return;
    const timer = setTimeout(() => runStageAnimation(visualStage), visualStage === 0 ? 0 : 900);
    return () => clearTimeout(timer);
  }, [visualStage, animationTrigger]);

  function resetTransientActivity() {
    const s = stateRef.current;
    s.oracleActive = false;
    s.registryActive = false;
    s.identityActive = false;
  }

  function runStageAnimation(stage) {
    const s = stateRef.current;
    s.currentStage = stage;
    resetTransientActivity();

    const completed = stage >= 7 || isCompleted;
    const cancelled = isCancelled;
    const sellerSubmitted = stage >= 1 && !cancelled;
    const buyerSubmitted = stage >= 3 && !cancelled;

    // Сертификат сразу хранится в смарт-контракте и не летает до финала.
    if (!completed) {
      s.cert.x = POS.cert.x;
      s.cert.y = POS.cert.y;
      s.cert.scale = 1;
      s.cert.opacity = 1;
    }

    // Деньги видны у покупателя с самого начала.
    // В escrow они переходят только после подтверждения покупателя и вызова reservePayment (stage 5).
    s.money.opacity = 1;
    if (stage < 5 || cancelled) {
      s.money.x = POS.moneyStart.x;
      s.money.y = POS.moneyStart.y;
      s.money.scale = 1;
    }

    // Ключ изначально у продавца. К покупателю он переходит только в самом конце.
    if (!completed) {
      s.keys.x = POS.keysSeller.x;
      s.keys.y = POS.keysSeller.y;
      s.keys.opacity = 1;
      s.keys.scale = 1;
      s.buyerPos.x = POS.buyer.x;
      s.buyerPos.y = POS.buyer.y;
      s.buyerPos.scale = 1;
    }

    // Изначально данных сторон на сцене нет.
    // После отправки они поступают в смарт-контракт и остаются там до завершения сделки.
    if (!sellerSubmitted) {
      s.sellerData.x = POS.sellerDataStart.x;
      s.sellerData.y = POS.sellerDataStart.y;
      s.sellerData.scale = 1;
      s.sellerData.opacity = 0;
    } else if (stage === 1) {
      s.sellerData.x = POS.sellerDataStart.x;
      s.sellerData.y = POS.sellerDataStart.y;
      s.sellerData.scale = 1;
      s.sellerData.opacity = 1;
      moveDataIntoContract(s.sellerData, POS.dataEscrow.x - 58, POS.dataEscrow.y);
    } else {
      s.sellerData.x = POS.dataEscrow.x - 58;
      s.sellerData.y = POS.dataEscrow.y;
      s.sellerData.scale = 1;
      s.sellerData.opacity = completed ? 1 : 0.92;
    }

    if (!buyerSubmitted) {
      s.buyerData.x = POS.buyerDataStart.x;
      s.buyerData.y = POS.buyerDataStart.y;
      s.buyerData.scale = 1;
      s.buyerData.opacity = 0;
    } else if (stage === 3) {
      s.buyerData.x = POS.buyerDataStart.x;
      s.buyerData.y = POS.buyerDataStart.y;
      s.buyerData.scale = 1;
      s.buyerData.opacity = 1;
      moveDataIntoContract(s.buyerData, POS.dataEscrow.x + 58, POS.dataEscrow.y);
    } else {
      s.buyerData.x = POS.dataEscrow.x + 58;
      s.buyerData.y = POS.dataEscrow.y;
      s.buyerData.scale = 1;
      s.buyerData.opacity = completed ? 1 : 0.92;
    }

    // Этапы подтверждения: Oracle проверяет и отправляет зелёную галочку в контракт.
    if (stage === 2) {
      activateOracle({ registry: true, identity: true });
      setTimeout(() => sendOracleCheck(), 650);
    }

    if (stage === 4) {
      activateOracle({ identity: true });
      setTimeout(() => sendOracleCheck(), 650);
    }

    if (stage === 5) {
      moveObject(s.money, POS.moneyEscrow.x, POS.moneyEscrow.y, 1000);
    }

    if (stage === 6) {
      s.money.x = POS.moneyEscrow.x;
      s.money.y = POS.moneyEscrow.y;
      activateOracle({ registry: true });
    }

    if (completed) {
      // Финальная запись: сертификат и данные уменьшаются, уходят в блокчейн и исчезают.
      pulseChain();
      moveDataIntoBlockchain(s.sellerData, POS.dataChain.x - 70, POS.dataChain.y);
      moveDataIntoBlockchain(s.buyerData, POS.dataChain.x + 70, POS.dataChain.y);
      moveObject(s.cert, POS.certBlockchain.x, POS.certBlockchain.y, 900, () => {
        animateValue(s.cert, 'scale', s.cert.scale, 0.42, 500);
        setTimeout(() => animateValue(s.cert, 'opacity', s.cert.opacity, 0, 520), 280);
      });

      // После завершения деньги уходят продавцу, а ключ и покупатель перемещаются к дому.
      s.money.opacity = 1;
      moveObject(s.money, POS.moneySeller.x, POS.moneySeller.y, 900);
      s.keys.opacity = 1;
      moveObject(s.keys, POS.keysHome.x, POS.keysHome.y, 850);
      moveObject(s.buyerPos, POS.buyerHome.x, POS.buyerHome.y, 1100, () => {
        s.buyerPos.scale = 0.95;
      });
      setTimeout(() => sendOracleCheck(), 250);
    }

    if (cancelled) {
      s.keys.x = POS.keysSeller.x;
      s.keys.y = POS.keysSeller.y;
      s.keys.opacity = 1;
      s.money.x = POS.moneyStart.x;
      s.money.y = POS.moneyStart.y;
      s.money.opacity = 1;
    }
  }

  function activateOracle({ registry = false, identity = false }) {
    const s = stateRef.current;
    s.oracleActive = true;
    s.registryActive = registry;
    s.identityActive = identity;
    animateValue(s, 'oraclePulse', 0, 1, 500, () => {
      setTimeout(() => {
        animateValue(s, 'oraclePulse', 1, 0, 600, () => resetTransientActivity());
      }, 1100);
    });
  }

  function pulseChain() {
    const s = stateRef.current;
    animateValue(s, 'chainPulse', 0, 1, 450, () => animateValue(s, 'chainPulse', 1, 0, 550));
  }

  function moveDataIntoContract(obj, escrowX, escrowY) {
    obj.opacity = 1;
    obj.scale = 1;
    moveObject(obj, escrowX, escrowY, 820, () => {
      obj.x = escrowX;
      obj.y = escrowY;
      obj.scale = 1;
      obj.opacity = 0.92;
    });
  }

  function moveDataIntoBlockchain(obj, chainX, chainY) {
    if (obj.opacity <= 0) return;
    obj.opacity = 1;
    moveObject(obj, chainX, chainY, 720, () => {
      pulseChain();
      animateValue(obj, 'scale', obj.scale, 0.42, 420);
      setTimeout(() => animateValue(obj, 'opacity', obj.opacity, 0, 520), 120);
    });
  }

  function sendOracleCheck() {
    const s = stateRef.current;
    s.oracleCheck.x = POS.oracle.x;
    s.oracleCheck.y = POS.oracle.y - 10;
    s.oracleCheck.scale = 1;
    s.oracleCheck.opacity = 1;
    moveObject(s.oracleCheck, POS.escrow.x, POS.escrow.y + 22, 650, () => {
      setTimeout(() => animateValue(s.oracleCheck, 'opacity', 1, 0, 320), 180);
    });
  }

  function moveObject(obj, tx, ty, dur, onDone) {
    const sx = obj.x, sy = obj.y;
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / dur, 1);
      const e = easeInOutCubic(t);
      obj.x = lerp(sx, tx, e);
      obj.y = lerp(sy, ty, e);
      obj.scale = 1 + Math.sin(t * Math.PI) * 0.11;
      if (t < 1) requestAnimationFrame(tick);
      else { obj.scale = 1; if (onDone) onDone(); }
    };
    requestAnimationFrame(tick);
  }

  function animateValue(obj, key, from, to, dur, onDone) {
    const start = performance.now();
    const tick = (now) => {
      const t = Math.min((now - start) / dur, 1);
      obj[key] = lerp(from, to, easeInOutCubic(t));
      if (t < 1) requestAnimationFrame(tick);
      else if (onDone) onDone();
    };
    requestAnimationFrame(tick);
  }

  function spawnParticles(s, cx, cy) {
    const colors = ['#facc15','#22c55e','#8b5cf6','#f97316','#3b82f6','#06b6d4'];
    s.celebrationParticles = Array.from({ length: 26 }, (_, i) => ({
      x: cx, y: cy,
      vx: (Math.random() - 0.5) * 220,
      vy: -Math.random() * 175 - 50,
      color: colors[i % colors.length],
      size: Math.random() * 7 + 4,
      life: 1,
      decay: Math.random() * 0.018 + 0.012,
      rotation: Math.random() * Math.PI * 2,
      spin: (Math.random() - 0.5) * 0.2,
    }));
  }

  useEffect(() => {
    if (!imagesReady) return;
    const ctx = ctxRef.current;
    if (!ctx) return;

    const render = (now) => {
      const s = stateRef.current;
      ctx.clearRect(0, 0, W, H);

      drawBackground(ctx, now);
      drawHouse(ctx, now, isCompleted);
      drawSoftLinks(ctx, s, now, visualStage);
      drawBlockchain(ctx, s, now);
      drawEscrow(ctx, s, now, visualStage, isCompleted, isCancelled);
      drawOracleAndOrgans(ctx, s, now, visualStage);
      drawOracleCheck(ctx, s);
      drawDataPacket(ctx, s.sellerData, 'Данные продавца', visualStage >= 1, '#22c55e');
      drawDataPacket(ctx, s.buyerData, 'Данные покупателя', visualStage >= 3, '#8b5cf6');
      drawCert(ctx, s, now);
      drawMoney(ctx, s, now, visualStage);
      drawPerson(ctx, imgsRef.current.person, POS.seller.x, POS.seller.y, 1.32, 'Продавец', deal?.sellerFullName || 'Ivan Petrov', visualStage >= 1, 'seller');
      drawPerson(ctx, imgsRef.current.person, s.buyerPos.x, s.buyerPos.y, 1.32 * (s.buyerPos.scale || 1), 'Покупатель', buyerNameInput || deal?.buyerFullName || 'Ожидается', visualStage >= 3, 'buyer');
      drawKeys(ctx, s, now, visualStage);
      // Панель «Обмен после проверки» убрана, чтобы сцена не дублировала смысл денег и ключей.

      rafRef.current = requestAnimationFrame(render);
    };

    rafRef.current = requestAnimationFrame(render);
    return () => cancelAnimationFrame(rafRef.current);
  }, [imagesReady, visualStage, isCompleted, isCancelled, deal, buyerNameInput, certificateLocation, moneyLocation]);

  function drawBackground(ctx, now) {
    const sky = ctx.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#07111f');
    sky.addColorStop(0.55, '#0d1b31');
    sky.addColorStop(1, '#07140f');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, H);

    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = 'rgba(139,92,246,0.18)';
    ctx.lineWidth = 1;
    for (let x = 0; x < W; x += 45) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke();
    }
    for (let y = 0; y < H; y += 45) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke();
    }
    ctx.restore();

    const glow = ctx.createRadialGradient(W / 2, 260, 20, W / 2, 260, 420);
    glow.addColorStop(0, 'rgba(139,92,246,0.18)');
    glow.addColorStop(1, 'transparent');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);

    const floor = ctx.createLinearGradient(0, H * 0.72, 0, H);
    floor.addColorStop(0, 'rgba(15,23,42,0.38)');
    floor.addColorStop(1, 'rgba(2,6,23,0.76)');
    ctx.fillStyle = floor;
    ctx.fillRect(0, H * 0.72, W, H * 0.28);
  }

  function drawHouse(ctx, now, done) {
    const { x, y } = POS.house;
    ctx.save();
    if (done) {
      const glow = ctx.createRadialGradient(x, y + 40, 20, x, y + 40, 140);
      glow.addColorStop(0, 'rgba(250,204,21,0.24)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fillRect(x - 150, y - 45, 300, 210);
    }
    ctx.shadowColor = 'rgba(0,0,0,0.55)';
    ctx.shadowBlur = 25;
    ctx.shadowOffsetY = 12;

    ctx.beginPath();
    ctx.moveTo(x, y - 62);
    ctx.lineTo(x + 100, y - 4);
    ctx.lineTo(x - 100, y - 4);
    ctx.closePath();
    const roof = ctx.createLinearGradient(x - 100, y - 62, x + 100, y - 4);
    roof.addColorStop(0, '#334155');
    roof.addColorStop(1, '#64748b');
    ctx.fillStyle = roof;
    ctx.fill();

    const wall = ctx.createLinearGradient(x - 80, y - 4, x + 80, y + 95);
    wall.addColorStop(0, '#7c2d12');
    wall.addColorStop(1, '#92400e');
    ctx.fillStyle = wall;
    ctx.fillRect(x - 80, y - 4, 160, 105);
    ctx.restore();

    ctx.fillStyle = done ? '#fef08a' : '#fde68a';
    ctx.shadowColor = ctx.fillStyle;
    ctx.shadowBlur = 10;
    roundRect(ctx, x - 62, y + 16, 36, 29, 4); ctx.fill();
    roundRect(ctx, x + 26, y + 16, 36, 29, 4); ctx.fill();
    ctx.shadowBlur = 0;

    ctx.fillStyle = '#451a03';
    roundRect(ctx, x - 18, y + 55, 36, 46, [8, 8, 0, 0]); ctx.fill();
    ctx.fillStyle = '#facc15';
    ctx.beginPath(); ctx.arc(x + 10, y + 78, 3, 0, Math.PI * 2); ctx.fill();

    ctx.font = 'bold 11px system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.72)';
    ctx.textAlign = 'center';
    ctx.fillText('Объект недвижимости', x, y + 115);
    ctx.font = '9px system-ui';
    ctx.fillStyle = 'rgba(203,213,225,0.72)';
    ctx.fillText((deal?.cadastralNumber || '77:01:0004012:1056').slice(0, 28), x, y + 131);
  }

  function drawSoftLinks(ctx, s, now, stage) {
    // Без стрелок: только живые мягкие связи, чтобы не перегружать сцену.
    drawGlowPath(ctx, POS.seller.x + 60, POS.seller.y - 65, POS.escrow.x - 94, POS.escrow.y + 32, stage >= 1 ? '#38bdf8' : 'rgba(148,163,184,0.22)', now);
    drawGlowPath(ctx, POS.buyer.x - 60, POS.buyer.y - 65, POS.escrow.x + 94, POS.escrow.y + 32, stage >= 3 ? '#8b5cf6' : 'rgba(148,163,184,0.22)', now);
    drawGlowPath(ctx, POS.escrow.x, POS.escrow.y + 92, POS.blockchain.x, POS.blockchain.y - 38, stage >= 7 ? '#60a5fa' : 'rgba(148,163,184,0.18)', now);
    drawGlowPath(ctx, POS.blockchain.x, POS.blockchain.y + 38, POS.oracle.x, POS.oracle.y - 45, (stage === 2 || stage === 4 || stage === 6) ? '#a78bfa' : 'rgba(148,163,184,0.18)', now);
    drawGlowPath(ctx, POS.oracle.x - 42, POS.oracle.y, POS.registry.x + 70, POS.registry.y, s.registryActive ? '#22c55e' : 'rgba(148,163,184,0.16)', now);
    drawGlowPath(ctx, POS.oracle.x + 42, POS.oracle.y, POS.identity.x - 70, POS.identity.y, s.identityActive ? '#22d3ee' : 'rgba(148,163,184,0.16)', now);
  }

  function drawGlowPath(ctx, x1, y1, x2, y2, color, now) {
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 8]);
    ctx.lineDashOffset = -now / 80;
    ctx.shadowColor = color;
    ctx.shadowBlur = color.startsWith('rgba') ? 0 : 10;
    ctx.beginPath();
    const mx = (x1 + x2) / 2;
    ctx.moveTo(x1, y1);
    ctx.quadraticCurveTo(mx, y1 - 20, x2, y2);
    ctx.stroke();
    ctx.restore();
  }

  function drawEscrow(ctx, s, now, stage, done, cancelled) {
    const { x, y } = POS.escrow;
    const w = 210, h = 116;
    const active = stage >= 1 && !cancelled;
    ctx.save();
    ctx.shadowColor = active ? 'rgba(124,58,237,0.45)' : 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = active ? 24 : 14;
    ctx.shadowOffsetY = 6;
    const bg = ctx.createLinearGradient(x - w / 2, y, x + w / 2, y + h);
    bg.addColorStop(0, done ? '#052e16' : cancelled ? '#450a0a' : '#111827');
    bg.addColorStop(1, active ? '#2e1065' : '#1e293b');
    roundRect(ctx, x - w / 2, y, w, h, 20);
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.strokeStyle = done ? '#22c55e' : cancelled ? '#ef4444' : active ? '#8b5cf6' : '#334155';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    ctx.font = 'bold 13px system-ui';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.fillText('Смарт-контракт / Escrow', x, y + 20);
    ctx.font = '10px system-ui';
    ctx.fillStyle = '#c4b5fd';
    ctx.fillText('хранит данные, сертификат и средства', x, y + 38);

    // сейф
    ctx.save();
    ctx.translate(x, y + 74);
    ctx.shadowColor = '#8b5cf6';
    ctx.shadowBlur = active ? 18 : 7;
    const safe = ctx.createLinearGradient(-42, -28, 42, 30);
    safe.addColorStop(0, '#334155'); safe.addColorStop(1, '#020617');
    roundRect(ctx, -42, -30, 84, 60, 14); ctx.fillStyle = safe; ctx.fill();
    ctx.strokeStyle = '#6366f1'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.font = '26px system-ui'; ctx.textBaseline = 'middle'; ctx.fillText('🔒', 0, 3);
    ctx.restore();
  }

  function drawBlockchain(ctx, s, now) {
    const { x, y } = POS.blockchain;
    const active = s.chainPulse > 0.02;
    ctx.save();
    ctx.shadowColor = active ? '#60a5fa' : 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = active ? 28 : 10;
    roundRect(ctx, x - 178, y - 43, 270, 86, 22);
    ctx.fillStyle = active ? 'rgba(30,64,175,0.34)' : 'rgba(15,23,42,0.84)';
    ctx.fill();
    ctx.strokeStyle = active ? '#60a5fa' : 'rgba(99,102,241,0.38)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    for (let i = 0; i < 4; i++) drawBlock(ctx, x - 122 + i * 54, y - 8, active, i);

    ctx.font = 'bold 14px system-ui';
    ctx.fillStyle = '#bfdbfe';
    ctx.textAlign = 'center';
    ctx.fillText('Блокчейн', x - 40, y + 30);
    ctx.font = '10px system-ui';
    ctx.fillStyle = '#93c5fd';
  }

  function drawBlock(ctx, x, y, active, i) {
    ctx.save();
    ctx.translate(x, y);
    ctx.shadowColor = active ? '#8b5cf6' : 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = active ? 14 : 5;
    ctx.fillStyle = active ? 'rgba(88,28,135,0.95)' : 'rgba(30,41,59,0.95)';
    roundRect(ctx, -18, -18, 36, 36, 8); ctx.fill();
    ctx.strokeStyle = active ? '#a78bfa' : '#475569'; ctx.stroke();
    ctx.font = '13px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#e9d5ff'; ctx.fillText('▦', 0, 1);
    ctx.restore();
    if (i < 3) {
      ctx.strokeStyle = active ? '#a78bfa' : '#475569';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + 20, y); ctx.lineTo(x + 34, y); ctx.stroke();
    }
  }

  function drawOracleAndOrgans(ctx, s, now, stage) {
    drawOrgan(ctx, POS.registry.x, POS.registry.y, '🏛️', 'Реестр', 'право собственности', s.registryActive || stage === 2 || stage === 6, '#38bdf8');
    drawOrgan(ctx, POS.identity.x, POS.identity.y, '🪪', 'Орган личности', 'паспорт и личность', s.identityActive || stage === 2 || stage === 4, '#22d3ee');

    const { x, y } = POS.oracle;
    const active = s.oracleActive || stage === 2 || stage === 4 || stage === 6;
    const pulse = active ? 1 + 0.05 * Math.sin(now / 180) : 1;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(pulse, pulse);
    ctx.shadowColor = active ? '#8b5cf6' : 'rgba(0,0,0,0.4)';
    ctx.shadowBlur = active ? 28 : 9;
    roundRect(ctx, -58, -50, 116, 100, 26);
    ctx.fillStyle = active ? 'rgba(59,7,100,0.88)' : 'rgba(15,23,42,0.9)';
    ctx.fill();
    ctx.strokeStyle = active ? '#a78bfa' : '#475569';
    ctx.lineWidth = 1.8;
    ctx.stroke();
    ctx.font = '34px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🤖', 0, -10);
    ctx.font = 'bold 12px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText('Oracle', 0, 22);
    ctx.font = '9px system-ui'; ctx.fillStyle = '#c4b5fd'; ctx.fillText(active ? 'проверяет запрос' : 'ожидает запрос', 0, 38);
    ctx.restore();
  }

  function drawOrgan(ctx, x, y, icon, title, sub, active, color) {
    ctx.save();
    ctx.shadowColor = active ? color : 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = active ? 18 : 8;
    roundRect(ctx, x - 65, y - 28, 155, 50, 18);
    ctx.fillStyle = active ? 'rgba(8,47,73,0.36)' : 'rgba(15,23,42,0.82)';
    ctx.fill();
    ctx.strokeStyle = active ? color : 'rgba(71,85,105,0.8)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = '24px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(icon, x - 45, y - 2);
    ctx.font = 'bold 11px system-ui'; ctx.textAlign = 'left'; ctx.fillStyle = active ? '#fff' : '#cbd5e1'; ctx.fillText(title, x - 18, y - 8);
    ctx.font = '9px system-ui'; ctx.fillStyle = active ? '#bbf7d0' : '#94a3b8'; ctx.fillText(sub, x - 18, y + 9);
    ctx.restore();
  }

  function drawOracleCheck(ctx, s) {
    const obj = s.oracleCheck;
    if (!obj || obj.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = obj.opacity;
    ctx.translate(obj.x, obj.y);
    ctx.scale(obj.scale, obj.scale);
    ctx.shadowColor = '#22c55e';
    ctx.shadowBlur = 20;
    ctx.beginPath();
    ctx.arc(0, 0, 20, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(5,46,22,0.94)';
    ctx.fill();
    ctx.strokeStyle = '#4ade80';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = '22px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('✅', 0, 1);
    ctx.restore();
  }

  function drawDataPacket(ctx, obj, label, visible, color) {
    if (!visible || obj.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = obj.opacity;
    ctx.translate(obj.x, obj.y);
    ctx.scale(obj.scale, obj.scale);
    ctx.shadowColor = color;
    ctx.shadowBlur = 14;
    roundRect(ctx, -52, -28, 104, 56, 12);
    ctx.fillStyle = 'rgba(15,23,42,0.92)'; ctx.fill();
    ctx.strokeStyle = color; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = 'bold 10px system-ui'; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 0, -8);
    ctx.font = '9px system-ui'; ctx.fillStyle = '#cbd5e1'; ctx.fillText('ФИО · кошелёк · паспорт', 0, 10);
    ctx.restore();
  }

  function drawCert(ctx, s) {
    const obj = s.cert;
    ctx.save();
    ctx.globalAlpha = obj.opacity;
    ctx.translate(obj.x, obj.y);
    ctx.scale(obj.scale, obj.scale);
    const img = imgsRef.current.cert;
    ctx.shadowColor = '#facc15'; ctx.shadowBlur = 12;
    if (img) ctx.drawImage(img, -18, -22, 36, 44);
    else { ctx.font = '32px system-ui'; ctx.textAlign = 'center'; ctx.fillText('📄', 0, 0); }
    ctx.shadowBlur = 0;
    ctx.font = '8px system-ui'; ctx.fillStyle = '#fde68a'; ctx.textAlign = 'center'; ctx.fillText(obj.scale < 0.7 ? 'запись в блокчейне' : 'сертификат в контракте', 0, 32);
    ctx.restore();
  }

  function drawMoney(ctx, s, now, stage) {
    const obj = s.money;
    if (obj.opacity <= 0) return;
    ctx.save();
    ctx.globalAlpha = obj.opacity;
    ctx.translate(obj.x, obj.y);
    ctx.scale(obj.scale, obj.scale);
    const img = imgsRef.current.money;
    ctx.shadowColor = '#facc15'; ctx.shadowBlur = 14;
    if (img) ctx.drawImage(img, -24, -24, 48, 48);
    else { ctx.font = '36px system-ui'; ctx.textAlign = 'center'; ctx.fillText('💰', 0, 0); }
    ctx.shadowBlur = 0;
    ctx.font = '9px system-ui';
    ctx.fillStyle = '#fde68a';
    ctx.textAlign = 'center';
    const label = stage >= 7 ? '' : stage >= 5 ? '' : '';
    ctx.fillText(label, 0, 35);
    ctx.restore();
  }

  function drawKeys(ctx, s, now, stage) {
    if (s.keys.opacity <= 0) return;
    const obj = s.keys;
    ctx.save();
    ctx.globalAlpha = obj.opacity;
    ctx.translate(obj.x, obj.y);
    ctx.scale(obj.scale, obj.scale);
    ctx.shadowColor = '#facc15'; ctx.shadowBlur = 16;
    ctx.font = '38px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('🔑', 0, 0);
    ctx.shadowBlur = 0;
   
    ctx.restore();
  }

  function drawPerson(ctx, img, x, y, scale, role, name, active, type) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale * (type === 'seller' ? -1 : 1), scale);
    ctx.shadowColor = active ? (type === 'seller' ? '#22c55e' : '#8b5cf6') : 'rgba(0,0,0,0.45)';
    ctx.shadowBlur = active ? 24 : 10;
    if (img) ctx.drawImage(img, -55, -135, 110, 150);
    else { ctx.font = '80px system-ui'; ctx.textAlign = 'center'; ctx.fillText('🧍', 0, -52); }
    ctx.restore();

    ctx.save();
    roundRect(ctx, x - 62, y + 18, 124, 49, 13);
    ctx.fillStyle = 'rgba(15,23,42,0.88)'; ctx.fill();
    ctx.strokeStyle = active ? (type === 'seller' ? '#22c55e' : '#8b5cf6') : 'rgba(71,85,105,0.8)'; ctx.stroke();
    ctx.font = 'bold 10px system-ui'; ctx.fillStyle = '#cbd5e1'; ctx.textAlign = 'center'; ctx.fillText(role, x, y + 36);
    ctx.font = 'bold 11px system-ui'; ctx.fillStyle = '#fff'; ctx.fillText((name || 'Ожидается').slice(0, 18), x, y + 53);
    ctx.restore();
  }

  function drawExchangePanel(ctx, stage) {
    const x = 735, y = 210, w = 150, h = 82;
    const active = stage >= 5;
    ctx.save();
    ctx.shadowColor = active ? '#facc15' : 'rgba(0,0,0,0.35)';
    ctx.shadowBlur = active ? 20 : 8;
    roundRect(ctx, x - w / 2, y - h / 2, w, h, 18);
    ctx.fillStyle = active ? 'rgba(120,53,15,0.28)' : 'rgba(15,23,42,0.76)';
    ctx.fill();
    ctx.strokeStyle = active ? '#facc15' : 'rgba(71,85,105,0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = 'bold 12px system-ui'; ctx.fillStyle = active ? '#fef3c7' : '#cbd5e1'; ctx.textAlign = 'center';
    ctx.fillText('Обмен после проверки', x, y - 24);
    ctx.font = '22px system-ui'; ctx.fillText('💰 → 🔑', x, y + 4);
    ctx.font = '9px system-ui'; ctx.fillStyle = active ? '#fde68a' : '#94a3b8';
    ctx.fillText('обмен после оплаты', x, y + 26);
    ctx.restore();
  }

  function drawParticles(ctx, s) {
    if (!s.celebrationParticles.length) return;
    for (const p of s.celebrationParticles) {
      if (p.life <= 0) continue;
      p.x += p.vx * 0.016; p.y += p.vy * 0.016; p.vy += 260 * 0.016; p.life -= p.decay; p.rotation += p.spin;
      ctx.save(); ctx.globalAlpha = Math.max(p.life, 0); ctx.translate(p.x, p.y); ctx.rotate(p.rotation); ctx.fillStyle = p.color; ctx.fillRect(-p.size/2, -p.size/2, p.size, p.size); ctx.restore();
    }
    s.celebrationParticles = s.celebrationParticles.filter(p => p.life > 0);
  }

  function drawCompletedBadge(ctx, s) {
    ctx.save();
    ctx.globalAlpha = s.completedBadgeOpacity;
    const x = POS.house.x, y = POS.house.y - 80;
    ctx.shadowColor = '#22c55e'; ctx.shadowBlur = 18;
    roundRect(ctx, x - 96, y - 24, 192, 48, 999);
    ctx.fillStyle = 'rgba(5,46,22,0.92)'; ctx.fill();
    ctx.strokeStyle = '#22c55e'; ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.font = 'bold 15px system-ui'; ctx.fillStyle = '#bbf7d0'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('✓ Сделка завершена', x, y);
    ctx.restore();
  }

  function getHoverTarget(mx, my) {
    const dist = (a, b, c, d) => Math.hypot(a - c, b - d);
    const s = stateRef.current;
    if (dist(mx, my, s.cert.x, s.cert.y) < 34) return 'cert';
    if (s.money.opacity > 0 && dist(mx, my, s.money.x, s.money.y) < 36) return 'money';
    return null;
  }

  function handleCanvasClick(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    const target = getHoverTarget(mx, my);
    if (target === 'cert') onCertificateClick?.();
    if (target === 'money') onMoneyClick?.();
  }

  function handleMouseMove(e) {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (W / rect.width);
    const my = (e.clientY - rect.top) * (H / rect.height);
    canvas.style.cursor = getHoverTarget(mx, my) ? 'pointer' : 'default';
  }

  return (
    <div className="animated-scene">
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        aria-label="Анимированная сцена сделки"
      />
      {!imagesReady && (
        <div className="scene-loading">
          <span>Загрузка сцены...</span>
        </div>
      )}
    </div>
  );
}

function roundRect(ctx, x, y, w, h, r) {
  let radii;
  if (Array.isArray(r)) radii = r;
  else radii = [r, r, r, r];
  const [tl, tr, br, bl] = radii;
  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  ctx.quadraticCurveTo(x + w, y + h, x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - bl);
  ctx.lineTo(x, y + tl);
  ctx.quadraticCurveTo(x, y, x + tl, y);
  ctx.closePath();
}
