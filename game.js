const tg = window.Telegram?.WebApp;
if (tg) { tg.expand(); tg.setHeaderColor('#060e06'); tg.setBackgroundColor('#060e06'); }

const USER = {
    id: tg?.initDataUnsafe?.user?.id || 'demo',
    name: tg?.initDataUnsafe?.user?.first_name || 'Игрок',
    username: tg?.initDataUnsafe?.user?.username || ''
};
const BOT_USERNAME = 'GiftsTycoonBot';
// API_BASE: читается из <meta name="api-base"> или window.API_BASE, иначе '/api'
const API_BASE = (document.querySelector('meta[name="api-base"]')?.content)
    || window.API_BASE
    || '/api';

const MAX_MINES = 10;

function calcMineUnlockCost(idx) {
    if (idx === 0) return 0;
    const adminCosts = getAdminSettings().mineCosts;
    if (adminCosts && adminCosts[idx]) return adminCosts[idx];
    const BASE_COSTS = [0, 500, 1200, 2500, 5000, 9000, 15000, 24000, 38000, 60000];
    return BASE_COSTS[idx] || Math.ceil(500 * Math.pow(2, idx));
}

function getAdminSettings() {
    try {
        const s = localStorage.getItem('gt_admin_settings');
        if (s) return JSON.parse(s);
    } catch(e) {}
    return {
        mineCosts: null,
        refReward: { type: 'silver', amount: 1 },
        upgradeMultiplier: 1.0,
        liftUpgradeCosts: null,
        minerUpgradeCosts: null,
        trainUpgradeCosts: null
    };
}

function saveAdminSettings(obj) {
    try { localStorage.setItem('gt_admin_settings', JSON.stringify(obj)); } catch(e) {}
}

function defaultState() {
    return {
        coins: { normal: 50, silver: 5, gold: 1 },
        warehouse: { current: 0, max: 200, coins: { normal: 0, silver: 0, gold: 0 } },
        mines: [{ id: 0, unlocked: true, storageCurrent: 0, storageMax: 50, level: 1 }],
        activeMine: 0,
        lift: { level: 1, capacity: 15 },
        train: { level: 1 },
        rates: { normal: 70, silver: 25, gold: 5 },
        exchangeRates: { silver: 0.001, gold: 0.005 },
        happyHour: { active: false, endsAt: 0 },
        stats: { totalNormal: 0, totalSilver: 0, totalGold: 0, tonEarned: 0 },
        upgradeLevels: { minerSpeed: 1, minerCap: 1, liftSpeed: 1, liftCap: 1, mineStorageCap: 1, warehouseCap: 1 },
        referrals: 0,
        warehouseBonusSlots: 0,
        dailyStreak: { streak: 0, lastClaim: 0, goldDropBonus: 0, incomeBonus: 0 },
        activeBoosts: [],
        incomeBoostExpiry: 0
    };
}

function loadState() {
    try {
        const saved = localStorage.getItem(`gt_v4_${USER.id}`);
        if (saved) {
            const parsed = JSON.parse(saved);
            const def = defaultState();
            const merged = Object.assign({}, def, parsed);
            if (!merged.warehouseBonusSlots) merged.warehouseBonusSlots = 0;
            if (!merged.dailyStreak) merged.dailyStreak = def.dailyStreak;
            if (!merged.activeBoosts) merged.activeBoosts = [];
            if (!merged.incomeBoostExpiry) merged.incomeBoostExpiry = 0;
            merged.mines = merged.mines.map(m => {
                const nm = Object.assign({}, m);
                delete nm.hasManager;
                return nm;
            });
            return merged;
        }
    } catch(e) {}
    return defaultState();
}

function saveState() {
    try { localStorage.setItem(`gt_v4_${USER.id}`, JSON.stringify(gameState)); } catch(e) {}
}

let gameState = loadState();

const WAREHOUSE_UPGRADE_CONFIG = {
    levels: [200,350,550,800,1150,1650,2400,3500,5200,7800,12000,18000,27000,40000,60000,90000,135000,200000,300000,450000,700000,1000000],
    costs:  [0,100,200,400,800,1600,3200,6400,12800,25600,51200,102400,204800,409600,819200,1638400,3276800,6553600,13107200,26214400,52428800,104857600]
};

const UPGRADE_CONFIG = {
    minerSpeed:    { name: 'Скорость шахтёра', icon: '⚡', speedMult: [1,1.3,1.7,2.2,2.8,3.5,4.3,5.2,6.2,7.3], costs: [100,200,400,800,1600,3200,6400,12800,25600,0] },
    minerCap:      { name: 'Вместимость шахтёра', icon: '🎒', capAdd: [0,3,6,10,15,21,28,36,45,55], costs: [120,250,500,1000,2000,4000,8000,16000,32000,0] },
    liftSpeed:     { name: 'Скорость лифта', icon: '🚡', speedMult: [1,1.3,1.7,2.2,2.8,3.5,4.3,5.2,6.2,7.3], costs: [150,300,600,1200,2400,4800,9600,19200,38400,0] },
    liftCap:       { name: 'Вместимость лифта', icon: '📦', capAdd: [0,5,12,20,30,42,56,72,90,110], costs: [120,250,500,1000,2000,4000,8000,16000,32000,0] },
    mineStorageCap:{ name: 'Объём шахты', icon: '🏗️', capAdd: [0,25,60,110,175,255,350,460,585,725], costs: [80,160,320,640,1280,2560,5120,10240,20480,0] }
};

const ADMIN_IDS = ['1027715401', 'demo'];
function isAdmin() { return ADMIN_IDS.includes(String(USER.id)); }

function getIncomeMultiplier() {
    let mult = 1.0;
    if (isHappyHour()) mult *= 1.5;
    if (gameState.incomeBoostExpiry && Date.now() < gameState.incomeBoostExpiry) {
        mult *= (gameState.incomeBoostValue || 1.1);
    }
    const streak = gameState.dailyStreak;
    if (streak && streak.incomeBonus > 0) mult *= (1 + streak.incomeBonus / 100);
    return mult;
}

function getMinerSpeed() {
    const lvl = gameState.upgradeLevels.minerSpeed;
    let mult = UPGRADE_CONFIG.minerSpeed.speedMult[lvl-1];
    mult *= getIncomeMultiplier();
    return 180 / mult;
}
function getMinerCap()   { return 5 + UPGRADE_CONFIG.minerCap.capAdd[gameState.upgradeLevels.minerCap-1]; }
function getLiftSpeed()  { return 28 / UPGRADE_CONFIG.liftSpeed.speedMult[gameState.upgradeLevels.liftSpeed-1]; }
function getLiftCap()    { return 15 + UPGRADE_CONFIG.liftCap.capAdd[gameState.upgradeLevels.liftCap-1]; }
function getMineMax()    { return 50 + UPGRADE_CONFIG.mineStorageCap.capAdd[gameState.upgradeLevels.mineStorageCap-1]; }
function getWhMax() {
    const lvl = gameState.upgradeLevels.warehouseCap || 1;
    const base = WAREHOUSE_UPGRADE_CONFIG.levels[Math.min(lvl-1, WAREHOUSE_UPGRADE_CONFIG.levels.length-1)];
    const refBonus = Math.min(gameState.referrals || 0, 10) * 20;
    return base + (gameState.warehouseBonusSlots || 0) + refBonus;
}
function getWhUpgradeCost() {
    const lvl = gameState.upgradeLevels.warehouseCap || 1;
    if (lvl >= WAREHOUSE_UPGRADE_CONFIG.levels.length) return 0;
    return WAREHOUSE_UPGRADE_CONFIG.costs[lvl];
}
function isHappyHour() { return gameState.happyHour.active && Date.now() < gameState.happyHour.endsAt; }
function getActiveMine() { return gameState.mines[gameState.activeMine] || gameState.mines[0]; }
function getTotalMineStorage() { return gameState.mines.reduce((s,m) => s + (m.unlocked ? m.storageCurrent : 0), 0); }
function getTotalWarehouse() {
    const wh = gameState.warehouse.coins;
    return (wh.normal||0) + (wh.silver||0) + (wh.gold||0);
}

function getGoldDropRate() {
    let base = gameState.rates.gold;
    const streak = gameState.dailyStreak;
    if (streak && streak.goldDropBonus > 0) base = Math.min(base + streak.goldDropBonus, 50);
    return base;
}

function generateCoin() {
    const r = Math.random() * 100;
    let rates = { ...gameState.rates };
    rates.gold = getGoldDropRate();
    if (isHappyHour()) {
        rates.silver = Math.min(rates.silver + 15, 60);
        rates.gold   = Math.min(rates.gold + 10, 30);
        rates.normal = 100 - rates.silver - rates.gold;
    }
    if (r < rates.gold) return 'gold';
    if (r < rates.gold + rates.silver) return 'silver';
    return 'normal';
}

const canvas = document.getElementById('game-canvas');
const ctx    = canvas.getContext('2d');
let W = 0, H = 0;
let TOTAL_H = 0;
const SKY_H = 220;
const UNDERGROUND_H = 600;

function resizeCanvas() {
    const parent = canvas.parentElement;
    W = canvas.width = parent.clientWidth;
    TOTAL_H = SKY_H + UNDERGROUND_H;
    H = TOTAL_H;
    canvas.height = TOTAL_H;
    canvas.style.width = '100%';
    canvas.style.height = TOTAL_H + 'px';
    canvas.style.display = 'block';
}

const liftAnim = {
    y: 0, phase: 'descending', loadTimer: 0, unloadTimer: 0, carrying: 0,
    coinTypes: { normal:0, silver:0, gold:0 }
};

const trainAnim = {
    x: 1.0, phase: 'goingToLift', loadTimer: 0,
    smokeIntensity: 0, smokeParticles: [],
    carrying: { normal:0, silver:0, gold:0 }
};

let minerAnims = [];
function initMinerAnims() {
    while (minerAnims.length < gameState.mines.length) {
        minerAnims.push({ posX: 0.95, phase: 'goingToWall', timer: 0, swingAngle: 0 });
    }
}

const particles = [];
function spawnParticle(x, y, text, vx, vy) {
    particles.push({ x, y, text, vx: vx||(Math.random()-0.5)*2, vy: vy||(-2-Math.random()), life: 1, alpha: 1 });
}

let lastTime = 0;
let autoSaveTimer = 0;

function gameTick(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;

    if (gameState.happyHour.active && Date.now() > gameState.happyHour.endsAt) {
        gameState.happyHour.active = false;
        document.getElementById('happy-hour-badge').classList.add('hidden');
    }

    if (gameState.incomeBoostExpiry && Date.now() > gameState.incomeBoostExpiry) {
        gameState.incomeBoostExpiry = 0;
        gameState.incomeBoostValue = 1.0;
    }

    const mineMax  = getMineMax();
    const whMax    = getWhMax();
    const minCap   = getMinerCap();
    const minSpd   = getMinerSpeed();
    const liftCap  = getLiftCap();

    initMinerAnims();
    const unlockedMines = gameState.mines.filter(m => m.unlocked);

    unlockedMines.forEach((mine, i) => {
        const anim = minerAnims[i] || (minerAnims[i] = { posX: 0.95, phase: 'goingToWall', timer: 0, swingAngle: 0 });

        if (anim.phase === 'idle') {
            if (mine.storageCurrent < mineMax) {
                anim.phase = 'goingToWall';
            }
        } else if (anim.phase === 'goingToWall') {
            anim.posX = Math.max(0.05, anim.posX - dt * 0.6);
            if (anim.posX <= 0.08) {
                anim.phase = 'mining';
                anim.timer = minSpd * 0.4;
            }
        } else if (anim.phase === 'mining') {
            anim.swingAngle = Math.sin(timestamp / 200) * 0.8;
            anim.timer -= dt;
            if (anim.timer <= 0) {
                const add = Math.min(minCap, mineMax - mine.storageCurrent);
                if (add > 0) {
                    for (let k = 0; k < add; k++) {
                        const type = generateCoin();
                        gameState.coins[type] += 1;
                        gameState.stats['total' + type[0].toUpperCase() + type.slice(1)] = (gameState.stats['total' + type[0].toUpperCase() + type.slice(1)] || 0) + 1;
                    }
                    mine.storageCurrent = Math.min(mine.storageCurrent + add, mineMax);
                }
                anim.phase = 'returning';
            }
        } else if (anim.phase === 'returning') {
            anim.posX = Math.min(0.95, anim.posX + dt * 0.4);
            if (anim.posX >= 0.9) {
                anim.swingAngle = 0;
                if (mine.storageCurrent >= mineMax) {
                    anim.phase = 'idle';
                } else {
                    anim.phase = 'goingToWall';
                }
            }
        }
    });

    const activeMine = getActiveMine();
    updateLift(dt, activeMine, liftCap, getLiftSpeed(), whMax);
    updateTrain(dt);

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.x += p.vx; p.y += p.vy; p.vy += 0.06;
        p.life -= dt; p.alpha = p.life;
        if (p.life <= 0) particles.splice(i, 1);
    }

    if (trainAnim.smokeParticles) {
        trainAnim.smokeParticles = trainAnim.smokeParticles.filter(p => {
            p.x += p.vx; p.y += p.vy; p.life -= dt; p.r += 0.5;
            return p.life > 0;
        });
        if (trainAnim.smokeIntensity > 0.1 && Math.random() < trainAnim.smokeIntensity * 0.4) {
            const tx = W * (WAREHOUSE_X_PCT - 0.05 - trainAnim.x * (WAREHOUSE_X_PCT - LIFT_X_PCT - 0.05));
            const trainY = getSY() + 4;
            trainAnim.smokeParticles.push({ x: tx + 8, y: trainY - 22, vx: (Math.random()-0.5)*0.4, vy: -0.8-Math.random(), life: 1+Math.random(), r: 4 });
        }
    }

    autoSaveTimer += dt;
    if (autoSaveTimer >= 15) { autoSaveTimer = 0; saveState(); }

    updateHUD();
    if (W && H) drawScene(timestamp);
    requestAnimationFrame(gameTick);
}

function updateLift(dt, mine, liftCap, liftSpd, whMax) {
    const DESCEND_SPEED = 1.2;
    const ASCEND_SPEED  = 1.4;
    const LOAD_TIME     = 1.2;
    const UNLOAD_TIME   = 0.8;

    switch (liftAnim.phase) {
        case 'idle':
            liftAnim.phase = 'descending';
            liftAnim.carrying = 0;
            liftAnim.coinTypes = { normal:0, silver:0, gold:0 };
            break;
        case 'descending':
            liftAnim.y = Math.min(1, liftAnim.y + dt * DESCEND_SPEED);
            if (liftAnim.y >= 1) { liftAnim.phase = 'loading'; liftAnim.loadTimer = LOAD_TIME; }
            break;
        case 'loading': {
            liftAnim.loadTimer -= dt;
            if (liftAnim.loadTimer <= 0) {
                if (mine.storageCurrent > 0 && getTotalWarehouse() < whMax) {
                    const space = whMax - getTotalWarehouse();
                    const take  = Math.min(liftCap, mine.storageCurrent, space);
                    mine.storageCurrent -= take;
                    liftAnim.carrying = take;
                    const r = gameState.rates;
                    liftAnim.coinTypes.normal = Math.round(take * r.normal / 100);
                    liftAnim.coinTypes.silver = Math.round(take * r.silver / 100);
                    liftAnim.coinTypes.gold   = Math.max(0, take - liftAnim.coinTypes.normal - liftAnim.coinTypes.silver);
                }
                liftAnim.phase = 'ascending';
            }
            break;
        }
        case 'ascending':
            liftAnim.y = Math.max(0, liftAnim.y - dt * ASCEND_SPEED);
            if (liftAnim.y <= 0) { liftAnim.phase = 'unloading'; liftAnim.unloadTimer = UNLOAD_TIME; }
            break;
        case 'unloading': {
            liftAnim.unloadTimer -= dt;
            if (liftAnim.unloadTimer <= 0) {
                if (liftAnim.carrying > 0) {
                    const wh = gameState.warehouse.coins;
                    wh.normal = (wh.normal||0) + liftAnim.coinTypes.normal;
                    wh.silver = (wh.silver||0) + liftAnim.coinTypes.silver;
                    wh.gold   = (wh.gold||0)   + liftAnim.coinTypes.gold;
                    gameState.warehouse.current = getTotalWarehouse();
                }
                liftAnim.carrying = 0;
                liftAnim.coinTypes = { normal:0, silver:0, gold:0 };
                liftAnim.phase = 'descending';
            }
            break;
        }
    }
}

function updateTrain(dt) {
    const TRAIN_SPEED = 0.45;
    const LOAD_TIME   = 1.5;
    const UNLOAD_TIME = 1.2;

    switch (trainAnim.phase) {
        case 'idle':
            trainAnim.phase = 'goingToLift';
            break;
        case 'goingToLift':
            trainAnim.x = Math.max(0, trainAnim.x - dt * TRAIN_SPEED);
            trainAnim.smokeIntensity = Math.max(0, trainAnim.smokeIntensity - dt * 0.3);
            if (trainAnim.x <= 0) { trainAnim.phase = 'loadingAtLift'; trainAnim.loadTimer = LOAD_TIME; }
            break;
        case 'loadingAtLift':
            trainAnim.loadTimer -= dt;
            if (trainAnim.loadTimer <= 0) {
                const wh = gameState.warehouse.coins;
                if ((wh.normal||0) + (wh.silver||0) + (wh.gold||0) > 0) {
                    trainAnim.carrying.normal = wh.normal || 0;
                    trainAnim.carrying.silver = wh.silver || 0;
                    trainAnim.carrying.gold   = wh.gold   || 0;
                    gameState.warehouse.coins = { normal:0, silver:0, gold:0 };
                    gameState.warehouse.current = 0;
                    trainAnim.smokeIntensity = 1.0;
                }
                trainAnim.phase = 'goingToWarehouse';
            }
            break;
        case 'goingToWarehouse':
            trainAnim.x = Math.min(1, trainAnim.x + dt * TRAIN_SPEED * 0.8);
            if (trainAnim.x >= 1) { trainAnim.phase = 'unloadingAtWarehouse'; trainAnim.loadTimer = UNLOAD_TIME; }
            break;
        case 'unloadingAtWarehouse':
            trainAnim.loadTimer -= dt;
            if (trainAnim.loadTimer <= 0) {
                trainAnim.smokeIntensity = 0;
                trainAnim.carrying = { normal:0, silver:0, gold:0 };
                trainAnim.phase = 'goingToLift';
            }
            break;
    }
}

const SURFACE_Y_PCT   = 0.38;
const LIFT_X_PCT      = 0.10;
const WAREHOUSE_X_PCT = 0.88;
function getSY() { return SKY_H; }

function drawScene(t) {
    ctx.clearRect(0, 0, W, H);
    const sy = getSY();

    const skyGrad = ctx.createLinearGradient(0, 0, 0, sy);
    skyGrad.addColorStop(0, '#020812'); skyGrad.addColorStop(0.5, '#04112a'); skyGrad.addColorStop(1, '#071c20');
    ctx.fillStyle = skyGrad; ctx.fillRect(0, 0, W, sy);

    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    for (let i = 0; i < 60; i++) {
        const sx2 = (i * 137.5 % 1) * W;
        const sy2 = (i * 97.3 % 1) * (sy - 40);
        const blink = 0.3 + Math.sin(t / 1200 + i) * 0.4;
        ctx.globalAlpha = blink;
        ctx.fillRect(sx2, sy2, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;

    drawMoon(ctx, W * 0.85, 40, 22, t);
    drawCloud(ctx, W * 0.18 + Math.sin(t/9000)*10, sy * 0.25, 45);
    drawCloud(ctx, W * 0.55 + Math.sin(t/7000)*8, sy * 0.38, 32);
    drawCloud(ctx, W * 0.72 + Math.sin(t/11000)*6, sy * 0.15, 26);

    ctx.fillStyle = '#1a3a1a'; ctx.fillRect(0, sy - 16, W, 22);
    ctx.fillStyle = '#2d5a2d'; ctx.fillRect(0, sy - 18, W, 6);
    drawGrass(ctx, W, sy);

    const ugGrad = ctx.createLinearGradient(0, sy, 0, H);
    ugGrad.addColorStop(0, '#2d1a08'); ugGrad.addColorStop(0.3, '#1f1006'); ugGrad.addColorStop(1, '#0a0504');
    ctx.fillStyle = ugGrad; ctx.fillRect(0, sy, W, H - sy);

    ctx.fillStyle = 'rgba(0,0,0,0.1)';
    for (let i = 0; i < 20; i++) {
        const rx = (i * 137.5 % 1) * W;
        const ry = sy + (i * 97.3 % 1) * (H - sy);
        const rr = 6 + (i * 73.1 % 1) * 18;
        ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI*2); ctx.fill();
    }

    drawGems(ctx, W, sy, H, t);

    const liftX = W * LIFT_X_PCT;
    const whX   = W * WAREHOUSE_X_PCT;
    const liftTopY = sy - 90;
    const liftHeight = H - sy - 20;

    drawLiftShaft(ctx, liftX, liftTopY, liftHeight, liftAnim.y, t);

    const trackX1 = liftX + 24;
    const trackX2 = whX - 50;
    drawTrainTrack(ctx, trackX1, sy + 12, trackX2);

    const trainDrawX = trackX1 + (trackX2 - trackX1) * (1 - trainAnim.x);
    const loaded = (trainAnim.carrying.normal + trainAnim.carrying.silver + trainAnim.carrying.gold) > 0;
    drawTrain(ctx, trainDrawX, sy - 12, t, loaded, trainAnim.phase);

    if (trainAnim.smokeParticles) {
        ctx.save();
        trainAnim.smokeParticles.forEach(p => {
            ctx.globalAlpha = p.life * 0.4;
            ctx.fillStyle = '#888';
            ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
        });
        ctx.restore();
    }

    drawWarehouse(ctx, whX, sy - 100, t);
    drawLiftUpgradeButton(ctx, liftX, liftTopY, t);
    drawTrainUpgradeButton(ctx, trainDrawX, sy, t);
    drawWarehouseUpgradeButton(ctx, whX, sy - 100);

    const unlockedMines = gameState.mines.filter(m => m.unlocked);
    const mineCount = unlockedMines.length;
    const liftRightEdge = liftX + 22;
    const whLeftEdge = whX - 52;
    const mineZoneStart = liftRightEdge + 10;
    const mineZoneEnd = whLeftEdge - 10;
    const mineZoneW = mineZoneEnd - mineZoneStart;
    const rawCabinW = Math.floor(mineZoneW / mineCount) - 10;
    const cabinW = Math.max(50, Math.min(rawCabinW, 180));
    const cabinH = H - sy - 60;
    const mineStep = mineCount > 1 ? mineZoneW / mineCount : 0;
    const firstMineX = mineZoneStart + (mineCount > 1 ? mineStep / 2 : mineZoneW / 2);

    for (let i = 0; i < mineCount; i++) {
        const mine = unlockedMines[i];
        const mx = firstMineX + i * mineStep;
        const anim = minerAnims[i] || { posX: 0.95, phase: 'goingToWall', timer: 0, swingAngle: 0 };
        drawMineShaft(ctx, mx - cabinW/2, cabinW, cabinH, sy, H, mine, anim, i, t);
    }

    if (mineCount < MAX_MINES) {
        const nextIdx = mineCount;
        const cost = calcMineUnlockCost(nextIdx);
        const btnX = firstMineX + mineCount * mineStep;
        const btnY = sy + cabinH / 2 + 30;
        if (btnX + 90 < W) drawAddMineButton(ctx, btnX, btnY, nextIdx + 1, cost, t);
    }

    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        ctx.save(); ctx.globalAlpha = p.alpha;
        ctx.font = '14px serif'; ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
    }

    const scrollPulse = 0.5 + Math.sin(t / 500) * 0.4;
    ctx.save();
    ctx.globalAlpha = scrollPulse;
    ctx.fillStyle = 'rgba(255,215,0,0.9)';
    ctx.font = `bold 11px 'Courier New'`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('▼ ПРОКРУТИ ВНИЗ ▼', W / 2, getSY() + 8);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
}

function drawAddMineButton(ctx, x, y, nextNum, cost, t) {
    const pulse = 0.85 + Math.sin(t / 600) * 0.15;
    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = 'rgba(27,94,32,0.85)';
    ctx.strokeStyle = 'rgba(255,215,0,0.7)';
    ctx.lineWidth = 2;
    roundRect(ctx, x - 80, y - 18, 160, 36, 8);
    ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFD700';
    ctx.font = `bold 11px 'Courier New'`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`+ ШАХТА ${nextNum} — ${formatNum(cost)} 🪙`, x, y);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
}

function drawLiftUpgradeButton(ctx, liftX, liftTopY, t) {
    const btnX = liftX;
    const btnY = liftTopY - 28;
    ctx.save();
    const pulse = 0.9 + Math.sin(t / 700) * 0.1;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = 'rgba(21,101,192,0.95)';
    ctx.strokeStyle = 'rgba(144,202,249,0.9)';
    ctx.lineWidth = 2;
    roundRect(ctx, btnX - 38, btnY - 13, 76, 26, 7);
    ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#90CAF9';
    ctx.font = `bold 10px 'Courier New'`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🔧 УЛУЧШИТЬ', btnX, btnY);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
}

function drawTrainUpgradeButton(ctx, trainX, sy, t) {
    const btnX = trainX;
    const btnY = sy - 40;
    ctx.save();
    const pulse = 0.9 + Math.sin(t / 800) * 0.1;
    ctx.globalAlpha = pulse;
    ctx.fillStyle = 'rgba(130,60,10,0.95)';
    ctx.strokeStyle = 'rgba(255,180,100,0.9)';
    ctx.lineWidth = 2;
    roundRect(ctx, btnX - 38, btnY - 13, 76, 26, 7);
    ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#FFCC80';
    ctx.font = `bold 10px 'Courier New'`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🔧 УЛУЧШИТЬ', btnX, btnY);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
}

function drawWarehouseUpgradeButton(ctx, x, y) {
    const btnX = x;
    const btnY = y - 18;
    ctx.save();
    ctx.fillStyle = 'rgba(21,101,192,0.95)';
    ctx.strokeStyle = 'rgba(144,202,249,0.9)';
    ctx.lineWidth = 2;
    roundRect(ctx, btnX - 38, btnY - 13, 76, 26, 7);
    ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#90CAF9';
    ctx.font = `bold 10px 'Courier New'`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🔧 УЛУЧШИТЬ', btnX, btnY);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();
}

function drawMineShaft(ctx, x1, cw, roomH, sy, H, mine, anim, mineIdx, t) {
    const topY = sy + 16;
    const cx = x1 + cw / 2;

    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(ctx, x1 + 4, topY + 4, cw, roomH, 8);
    ctx.fill();

    const bg = ctx.createLinearGradient(x1, topY, x1+cw, topY+roomH);
    bg.addColorStop(0, '#1e341e'); bg.addColorStop(1, '#0c180c');
    ctx.fillStyle = bg;
    roundRect(ctx, x1, topY, cw, roomH, 8);
    ctx.fill();
    ctx.strokeStyle = '#3a6a3a'; ctx.lineWidth = 2;
    roundRect(ctx, x1, topY, cw, roomH, 8); ctx.stroke();

    const fillPct = getMineMax() > 0 ? mine.storageCurrent / getMineMax() : 0;
    if (fillPct > 0) {
        const fillH = Math.floor(fillPct * (roomH - 12));
        const fillGrad = ctx.createLinearGradient(0, topY+roomH-fillH-6, 0, topY+roomH-6);
        fillGrad.addColorStop(0, `rgba(76,175,80,${0.1 + fillPct * 0.2})`);
        fillGrad.addColorStop(1, `rgba(139,195,74,${0.3 + fillPct * 0.4})`);
        ctx.fillStyle = fillGrad;
        roundRect(ctx, x1+4, topY + roomH - fillH - 6, cw-8, fillH, 4);
        ctx.fill();
    }

    ctx.strokeStyle = 'rgba(40,70,40,0.6)'; ctx.lineWidth = 1;
    for (let ty = topY + 20; ty < topY + roomH - 10; ty += 18) {
        ctx.beginPath(); ctx.moveTo(x1+4, ty); ctx.lineTo(x1+cw-4, ty); ctx.stroke();
    }

    ctx.fillStyle = '#4a3a1e';
    roundRect(ctx, x1, topY - 20, cw, 22, 5); ctx.fill();
    ctx.strokeStyle = '#7a6a3a'; ctx.lineWidth = 1.5;
    roundRect(ctx, x1, topY - 20, cw, 22, 5); ctx.stroke();
    ctx.fillStyle = '#6a5a2a';
    ctx.fillRect(cx - 8, topY - 20, 3, 20); ctx.fillRect(cx + 5, topY - 20, 3, 20);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = '#FFD700'; ctx.font = `bold 10px 'Courier New'`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(`⛏️ ${mineIdx+1}`, cx, topY - 8);
    ctx.textBaseline = 'alphabetic';

    ctx.fillStyle = fillPct > 0.8 ? '#FF7043' : '#8BC34A';
    ctx.font = `bold 9px 'Courier New'`;
    const storageText = `${mine.storageCurrent}/${getMineMax()}`;
    ctx.fillText(storageText, cx, topY + roomH + 14);
    ctx.restore();

    const managerX = x1 + cw * 0.15;
    const managerY = topY + 30;
    drawManagerFigure(ctx, managerX, managerY, t);

    const upgBtnX = cx;
    const upgBtnY = topY + roomH + 32;
    ctx.save();
    const btnPulse = 0.9 + Math.sin(t/600 + mineIdx)*0.1;
    ctx.globalAlpha = btnPulse;
    ctx.fillStyle = 'rgba(21,101,192,0.95)';
    ctx.strokeStyle = 'rgba(144,202,249,0.9)';
    ctx.lineWidth = 2;
    roundRect(ctx, upgBtnX - 40, upgBtnY - 13, 80, 26, 7);
    ctx.fill(); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#B3E5FC';
    ctx.font = `bold 10px 'Courier New'`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('🔧 УЛУЧШИТЬ', upgBtnX, upgBtnY);
    ctx.textBaseline = 'alphabetic';
    ctx.restore();

    if (anim.phase === 'mining') {
        ctx.save();
        const dustAlpha = 0.5 + Math.sin(t/100) * 0.3;
        ctx.globalAlpha = dustAlpha * 0.5;
        ctx.fillStyle = '#8a6a3a';
        const minerAbsX = x1 + 12 + anim.posX * (cw - 24);
        ctx.beginPath(); ctx.arc(minerAbsX, topY + roomH - 22, 12, 0, Math.PI*2); ctx.fill();
        ctx.restore();
    }

    const minerAbsX = x1 + cw * anim.posX;
    const minerY = topY + roomH - 10;
    drawMinerFigure(ctx, minerAbsX, minerY, t, anim, mine.storageCurrent > 0);
}

function drawManagerFigure(ctx, x, y, t) {
    ctx.save();
    const bob = Math.sin(t / 1200) * 1;

    ctx.fillStyle = '#2a1a4a';
    ctx.fillRect(x - 5, y - bob, 4, 10);
    ctx.fillRect(x + 1, y - bob, 4, 10);

    ctx.fillStyle = '#1a3068';
    ctx.fillRect(x - 8, y - 18 - bob, 16, 16);

    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 5, y - 16 - bob, 10, 8);

    ctx.fillStyle = '#cc0000';
    ctx.fillRect(x - 1, y - 16 - bob, 2, 6);

    ctx.fillStyle = '#e8c090';
    ctx.beginPath(); ctx.arc(x, y - 24 - bob, 6, 0, Math.PI*2); ctx.fill();

    ctx.fillStyle = '#2a1a4a';
    ctx.beginPath(); ctx.ellipse(x, y - 29 - bob, 7, 3, 0, Math.PI, 0); ctx.fill();

    ctx.restore();
}

function drawMinerFigure(ctx, x, y, t, anim, active) {
    ctx.save();
    const walking = anim.phase === 'goingToWall' || anim.phase === 'returning';
    const mining  = anim.phase === 'mining';
    const legSwing = walking ? Math.sin(t / 150) * 5 : 0;

    ctx.fillStyle = '#2a3a2a';
    ctx.fillRect(x - 5, y - 6, 4, 10 + Math.max(0, legSwing));
    ctx.fillRect(x + 1, y - 6, 4, 10 + Math.max(0, -legSwing));

    ctx.fillStyle = active ? '#3a7e3a' : '#2a5a2a';
    ctx.fillRect(x - 8, y - 22, 16, 16);

    ctx.fillStyle = '#d4a06a';
    ctx.beginPath(); ctx.arc(x, y - 28, 7, 0, Math.PI*2); ctx.fill();

    ctx.fillStyle = '#FFD700';
    ctx.beginPath(); ctx.ellipse(x, y - 33, 9, 5, 0, Math.PI, 0); ctx.fill();

    const lampGlow = 0.6 + Math.sin(t/400) * 0.3;
    ctx.save(); ctx.globalAlpha = lampGlow;
    ctx.fillStyle = '#FFFF00';
    ctx.beginPath(); ctx.arc(x - 3, y - 36, 3, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    if (mining) {
        const swing = anim.swingAngle || Math.sin(t/200) * 0.8;
        ctx.save(); ctx.translate(x - 10, y - 14); ctx.rotate(-0.5 + swing);
        ctx.fillStyle = '#4a3a2a'; ctx.fillRect(-2, -14, 3, 16);
        ctx.fillStyle = '#aaa'; ctx.fillRect(-8, -16, 10, 5);
        ctx.fillStyle = '#666'; ctx.fillRect(-5, -13, 6, 3);
        ctx.restore();
    } else {
        ctx.save(); ctx.translate(x + 10, y - 14); ctx.rotate(0.3);
        ctx.fillStyle = '#4a3a2a'; ctx.fillRect(-2, -10, 3, 14);
        ctx.fillStyle = '#aaa'; ctx.fillRect(-2, -14, 8, 5);
        ctx.restore();
    }
    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.lineTo(x+w-r,y);
    ctx.arcTo(x+w,y,x+w,y+r,r); ctx.lineTo(x+w,y+h-r);
    ctx.arcTo(x+w,y+h,x+w-r,y+h,r); ctx.lineTo(x+r,y+h);
    ctx.arcTo(x,y+h,x,y+h-r,r); ctx.lineTo(x,y+r);
    ctx.arcTo(x,y,x+r,y,r); ctx.closePath();
}

function drawCloud(ctx, x, y, r) {
    ctx.save(); ctx.fillStyle = 'rgba(180,210,255,0.12)';
    ctx.beginPath();
    ctx.arc(x,y,r,0,Math.PI*2); ctx.arc(x+r*0.8,y+r*0.1,r*0.7,0,Math.PI*2); ctx.arc(x-r*0.7,y+r*0.1,r*0.6,0,Math.PI*2);
    ctx.fill(); ctx.restore();
}

function drawMoon(ctx, x, y, r, t) {
    ctx.save();
    const g = ctx.createRadialGradient(x-2,y-2,1,x,y,r);
    g.addColorStop(0,'#fffde0'); g.addColorStop(1,'#d4c060');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    [[x-4,y-3,3],[x+5,y+4,2],[x-1,y+6,2.5]].forEach(([cx,cy,cr]) => {
        ctx.beginPath(); ctx.arc(cx,cy,cr,0,Math.PI*2); ctx.fill();
    });
    ctx.restore();
}

function drawGrass(ctx, W, sy) {
    ctx.save(); ctx.fillStyle = '#3a6e3a';
    for (let i = 0; i < W; i += 12) {
        const h = 3 + Math.sin(i * 0.35) * 2;
        ctx.fillRect(i, sy-16-h, 7, h+3);
    }
    ctx.restore();
}

function drawGems(ctx, W, sy, H, t) {
    const gems = [
        {x:0.38,y:0.62,type:'normal'},{x:0.62,y:0.72,type:'silver'},
        {x:0.3,y:0.8,type:'gold'},{x:0.72,y:0.68,type:'normal'},{x:0.5,y:0.85,type:'silver'}
    ];
    gems.forEach((g, i) => {
        const gx = W * g.x;
        const gy = sy + (H - sy) * (g.y - SURFACE_Y_PCT) * 2.4;
        const glow = 0.4 + Math.sin(t/900 + i*1.3) * 0.3;
        const colors = { normal:'#FFD700', silver:'#B0C4DE', gold:'#FF8C00' };
        ctx.save(); ctx.globalAlpha = glow;
        ctx.fillStyle = colors[g.type];
        ctx.beginPath();
        for (let j = 0; j < 6; j++) {
            const a = (j/6)*Math.PI*2 - Math.PI/2;
            const rr = j%2===0 ? 5 : 2.5;
            j===0 ? ctx.moveTo(gx+Math.cos(a)*rr,gy+Math.sin(a)*rr) : ctx.lineTo(gx+Math.cos(a)*rr,gy+Math.sin(a)*rr);
        }
        ctx.closePath(); ctx.fill(); ctx.restore();
    });
}

function drawLiftShaft(ctx, x, topY, height, animY, t) {
    ctx.save();
    const sw = 40;
    ctx.fillStyle = '#0d0d0d';
    ctx.fillRect(x - sw/2, topY, sw, height + 60);
    ctx.strokeStyle = '#5a7a5a'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x-12,topY); ctx.lineTo(x-12,topY+height+60); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x+12,topY); ctx.lineTo(x+12,topY+height+60); ctx.stroke();
    ctx.lineWidth = 1.5; ctx.strokeStyle = '#3a5a3a';
    for (let ry = topY; ry < topY+height+60; ry += 20) {
        ctx.beginPath(); ctx.moveTo(x-12,ry); ctx.lineTo(x+12,ry); ctx.stroke();
    }

    ctx.fillStyle = '#3a3a3a';
    roundRect(ctx, x-22, topY-22, 44, 24, 5); ctx.fill();
    ctx.strokeStyle = '#6a6a6a'; ctx.lineWidth = 2;
    roundRect(ctx, x-22, topY-22, 44, 24, 5); ctx.stroke();
    ctx.fillStyle = '#FFD700'; ctx.font = `bold 9px 'Courier New'`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('ЛИФТ', x, topY-10);
    ctx.textBaseline = 'alphabetic';

    const cabinY = topY + 10 + animY * (height - 20);
    const cabinH = 36; const cabinW = 36;

    ctx.strokeStyle = '#888'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x,topY); ctx.lineTo(x,cabinY); ctx.stroke();

    if (liftAnim.phase === 'loading' || liftAnim.phase === 'unloading') {
        ctx.save();
        ctx.shadowBlur = 20; ctx.shadowColor = '#8BC34A';
        ctx.fillStyle = 'rgba(100,200,100,0.3)';
        roundRect(ctx, x-cabinW/2-5, cabinY-5, cabinW+10, cabinH+10, 8);
        ctx.fill(); ctx.restore();
    }

    const cGrad = ctx.createLinearGradient(x-cabinW/2,cabinY,x+cabinW/2,cabinY+cabinH);
    cGrad.addColorStop(0,'#5a8a5a'); cGrad.addColorStop(1,'#3a6a3a');
    ctx.fillStyle = cGrad;
    roundRect(ctx, x-cabinW/2, cabinY, cabinW, cabinH, 6); ctx.fill();
    ctx.strokeStyle = '#8aba8a'; ctx.lineWidth = 2;
    roundRect(ctx, x-cabinW/2, cabinY, cabinW, cabinH, 6); ctx.stroke();

    if (liftAnim.carrying > 0) {
        ctx.fillStyle = '#FFD700'; ctx.font = `bold 10px 'Courier New'`;
        ctx.textAlign = 'center'; ctx.fillText(`×${liftAnim.carrying}`, x, cabinY + 22);
    } else {
        ctx.font = `14px serif`; ctx.textAlign = 'center';
        ctx.fillText('📦', x, cabinY + 22);
    }
    ctx.restore();
}

function drawTrainTrack(ctx, x1, y, x2) {
    ctx.save();
    ctx.fillStyle = '#2a1a0a';
    for (let tx = x1; tx < x2; tx += 16) { ctx.fillRect(tx, y-1, 10, 5); }
    ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x1,y+1); ctx.lineTo(x2,y+1); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1,y+4); ctx.lineTo(x2,y+4); ctx.stroke();
    ctx.restore();
}

function drawTrain(ctx, x, y, t, loaded, phase) {
    ctx.save();
    const stopped = phase === 'loadingAtLift' || phase === 'unloadingAtWarehouse';
    const wheelRot = stopped ? 0 : t / 200;
    [-14, 10, 30].forEach(wx => {
        ctx.fillStyle = '#1a1a1a';
        ctx.beginPath(); ctx.arc(x+wx, y+14, 6, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#555'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(x+wx, y+14, 6, 0, Math.PI*2); ctx.stroke();
        if (!stopped) {
            ctx.save(); ctx.translate(x+wx, y+14); ctx.rotate(wheelRot);
            ctx.strokeStyle = '#444'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(-4,0); ctx.lineTo(4,0); ctx.stroke();
            ctx.beginPath(); ctx.moveTo(0,-4); ctx.lineTo(0,4); ctx.stroke();
            ctx.restore();
        }
    });
    const bGrad = ctx.createLinearGradient(x-22,y-8,x+48,y+8);
    bGrad.addColorStop(0, loaded?'#7f0000':'#8b3a0a');
    bGrad.addColorStop(0.5, loaded?'#c62828':'#bf6314');
    bGrad.addColorStop(1, loaded?'#7f0000':'#8b3a0a');
    ctx.fillStyle = bGrad;
    roundRect(ctx, x-22, y-8, 72, 22, 5); ctx.fill();
    ctx.fillStyle = '#333';
    [x-16,x-5,x+6,x+20,x+38].forEach(rx => {
        ctx.beginPath(); ctx.arc(rx, y+3, 2, 0, Math.PI*2); ctx.fill();
    });
    ctx.fillStyle = loaded?'#ff8080':'#a0d4ff';
    roundRect(ctx, x-16, y-5, 14, 10, 2); ctx.fill();
    roundRect(ctx, x+4, y-5, 14, 10, 2); ctx.fill();
    ctx.fillStyle = '#1a1a1a'; ctx.fillRect(x+28, y-18, 8, 12);
    ctx.fillStyle = '#333'; ctx.fillRect(x+26, y-20, 12, 4);
    if (loaded) {
        const smokeOff = Math.sin(t/250)*2;
        ctx.fillStyle = `rgba(20,15,10,0.7)`;
        ctx.beginPath(); ctx.arc(x+32+smokeOff, y-24, 5, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
}

function drawWarehouse(ctx, x, y, t) {
    ctx.save();
    const bw = 80; const bh = 110;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(ctx, x-bw/2+4, y+6, bw, bh, 6); ctx.fill();
    const wbg = ctx.createLinearGradient(x-bw/2, y, x+bw/2, y+bh);
    wbg.addColorStop(0,'#3a5a3a'); wbg.addColorStop(1,'#1e3a1e');
    ctx.fillStyle = wbg;
    roundRect(ctx, x-bw/2, y, bw, bh, 6); ctx.fill();
    ctx.strokeStyle = '#5a9a5a'; ctx.lineWidth = 2;
    roundRect(ctx, x-bw/2, y, bw, bh, 6); ctx.stroke();
    ctx.fillStyle = '#4a7a4a';
    ctx.beginPath(); ctx.moveTo(x-bw/2-8,y+6); ctx.lineTo(x,y-28); ctx.lineTo(x+bw/2+8,y+6); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#6a9a6a'; ctx.lineWidth = 2; ctx.stroke();
    ctx.strokeStyle = '#8aba8a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x,y-28); ctx.lineTo(x,y); ctx.stroke();
    ctx.fillStyle = '#1a2a1a';
    roundRect(ctx, x-14, y+62, 28, 48, 4); ctx.fill();
    ctx.strokeStyle = '#3a5a3a'; ctx.lineWidth = 1;
    roundRect(ctx, x-14, y+62, 28, 48, 4); ctx.stroke();
    const glowA = 0.4 + Math.sin(t/2000)*0.15;
    ctx.fillStyle = '#1a3a5a';
    ctx.fillRect(x-bw/2+6, y+16, 20, 16); ctx.fillRect(x+bw/2-26, y+16, 20, 16);
    ctx.fillStyle = `rgba(150,230,150,${glowA})`;
    ctx.fillRect(x-bw/2+7, y+17, 18, 14); ctx.fillRect(x+bw/2-25, y+17, 18, 14);
    ctx.fillStyle = '#FFD700'; ctx.font = `bold 11px 'Courier New', monospace`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText('СКЛАД', x, y+48);
    ctx.textBaseline = 'alphabetic';
    const fillPct = gameState.warehouse.current / getWhMax();
    const barH = 30; const barY = y+58;
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(ctx, x-bw/2+8, barY, bw-16, barH, 3); ctx.fill();
    if (fillPct > 0) {
        const fh = Math.floor(fillPct * barH);
        ctx.fillStyle = `rgba(76,175,80,${0.4 + fillPct * 0.5})`;
        roundRect(ctx, x-bw/2+8, barY+(barH-fh), bw-16, fh, 3); ctx.fill();
    }
    ctx.fillStyle = '#CCFF90'; ctx.font = `bold 11px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(formatNum(getTotalWarehouse()), x, barY+barH+16);
    ctx.restore();
}

let audioCtx = null;
function initAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
}
function playClickSound() {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(880, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(440, audioCtx.currentTime + 0.08);
        gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
        osc.start(); osc.stop(audioCtx.currentTime + 0.1);
    } catch(e) {}
}
function playSuccessSound() {
    if (!audioCtx) return;
    try {
        [523,659,784,1047].forEach((freq,i) => {
            const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.frequency.value = freq;
            const start = audioCtx.currentTime + i * 0.1;
            gain.gain.setValueAtTime(0.2, start); gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
            osc.start(start); osc.stop(start + 0.25);
        });
    } catch(e) {}
}
function playFailSound() {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator(); const gain = audioCtx.createGain();
        osc.type = 'sawtooth'; osc.connect(gain); gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(200, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        osc.start(); osc.stop(audioCtx.currentTime + 0.35);
    } catch(e) {}
}

document.addEventListener('click', (e) => {
    if (e.target.matches('button, .forge-slot, .nav-btn, .lb-tab, .recipe-tab')) {
        initAudio(); playClickSound();
    }
}, true);

let forgeRecipe = 'normal';
let forgeSlots  = [false,false,false,false];
const FORGE_RECIPES = {
    normal: { inputType:'normal', inputPerSlot:2, outputType:'silver', outputIcon:'🥈', inputIcon:'🪙' },
    silver: { inputType:'silver', inputPerSlot:1, outputType:'gold',   outputIcon:'🏅', inputIcon:'🥈' }
};

function selectRecipe(type, btn) {
    forgeRecipe = type; forgeSlots = [false,false,false,false];
    document.querySelectorAll('.recipe-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    renderForgeSlots(); updateForgeUI();
}

function toggleSlot(idx) { forgeSlots[idx] = !forgeSlots[idx]; renderForgeSlots(); updateForgeUI(); }

function renderForgeSlots() {
    const recipe = FORGE_RECIPES[forgeRecipe];
    for (let i = 0; i < 4; i++) {
        const slot = document.getElementById(`slot-${i}`);
        if (!slot) continue;
        if (forgeSlots[i]) {
            slot.className = 'forge-slot filled';
            slot.innerHTML = `<span class="slot-icon">${recipe.inputIcon}</span><span class="slot-count">×${recipe.inputPerSlot}</span>`;
        } else {
            slot.className = 'forge-slot';
            slot.innerHTML = `<span class="plus-icon">+</span>`;
        }
    }
    const filledCount = forgeSlots.filter(Boolean).length;
    const resultEl = document.getElementById('forge-result');
    if (resultEl) {
        resultEl.className = filledCount >= 2 ? 'forge-result-cell has-result' : 'forge-result-cell';
        resultEl.textContent = filledCount >= 2 ? FORGE_RECIPES[forgeRecipe].outputIcon : '?';
    }
}

function updateForgeUI() {
    const recipe = FORGE_RECIPES[forgeRecipe];
    const filledCount = forgeSlots.filter(Boolean).length;
    const totalInput = filledCount * recipe.inputPerSlot;
    const balance = gameState.coins[recipe.inputType];
    const chanceMap = {0:0,1:0,2:50,3:70,4:90};
    const chance = chanceMap[filledCount] || 0;
    const el1 = document.getElementById('forge-chance');
    const el2 = document.getElementById('forge-bal-val');
    const el3 = document.getElementById('forge-hint');
    const el4 = document.getElementById('forge-btn');
    if (el1) el1.textContent = chance > 0 ? `${chance}%` : '—';
    if (el2) el2.textContent = formatNum(balance);
    if (el3) el3.textContent =
        filledCount === 0 ? 'Нажмите + чтобы добавить материалы (2–4 слота)' :
        filledCount === 1 ? 'Добавьте ещё минимум 1 слот' :
        `Нужно: ${totalInput} ${recipe.inputIcon}  |  Есть: ${balance}`;
    const canForge = filledCount >= 2 && balance >= totalInput;
    if (el4) el4.disabled = !canForge;
}

function doForge() {
    initAudio();
    const recipe = FORGE_RECIPES[forgeRecipe];
    const filledCount = forgeSlots.filter(Boolean).length;
    if (filledCount < 2) { showToast('Заполните минимум 2 слота!'); return; }
    const totalInput = filledCount * recipe.inputPerSlot;
    if (gameState.coins[recipe.inputType] < totalInput) { showToast(`Недостаточно монет! Нужно: ${totalInput}`); return; }
    gameState.coins[recipe.inputType] -= totalInput;
    const chanceMap = {2:50,3:70,4:90};
    const chance = chanceMap[filledCount] || 50;
    const success = Math.random() * 100 < chance;
    if (success) {
        gameState.coins[recipe.outputType] += 1;
        gameState.stats['total' + recipe.outputType[0].toUpperCase() + recipe.outputType.slice(1)] =
            (gameState.stats['total' + recipe.outputType[0].toUpperCase() + recipe.outputType.slice(1)] || 0) + 1;
        playSuccessSound();
    } else { playFailSound(); }
    saveState(); updateHUD();
    forgeSlots = [false,false,false,false];
    renderForgeSlots(); updateForgeUI();
    showForgeResult(success, recipe.outputIcon, recipe.outputType);
}

function showForgeResult(success, icon, coinType) {
    const overlay = document.createElement('div');
    overlay.className = 'forge-overlay';
    let particlesHTML = '';
    if (success) {
        particlesHTML = '<div class="forge-particles">';
        for (let i = 0; i < 16; i++) {
            const tx = (Math.random()-0.5)*300;
            const ty = -100 - Math.random()*200;
            const dur = 0.8 + Math.random()*0.6;
            particlesHTML += `<div class="particle" style="left:50%;top:50%;transform:translate(-50%,-50%);--tx:${tx}px;--ty:${ty}px;--dur:${dur}s;animation-delay:${Math.random()*0.3}s;">${icon}</div>`;
        }
        particlesHTML += '</div>';
    }
    overlay.innerHTML = `${particlesHTML}
        <div class="forge-result-icon ${success?'win-anim':'fail-anim'}">${success?icon:'💨'}</div>
        <div class="forge-result-msg ${success?'win':'fail'}">${success?'✅ УСПЕХ!':'❌ НЕУДАЧА'}</div>
        <div class="forge-result-sub">${success?`+1 ${coinType==='silver'?'Серебряная монета!':'Золотая монета!'}`:' Материалы использованы...'}</div>
        <div class="forge-tap-close">Нажмите чтобы закрыть</div>`;
    overlay.onclick = () => overlay.remove();
    document.body.appendChild(overlay);
    setTimeout(() => overlay.remove(), 3000);
}

function updateHUD() {
    const n1 = document.getElementById('hud-normal');
    const n2 = document.getElementById('hud-silver');
    const n3 = document.getElementById('hud-gold');
    if (n1) n1.textContent = formatNum(gameState.coins.normal);
    if (n2) n2.textContent = formatNum(gameState.coins.silver);
    if (n3) n3.textContent = formatNum(gameState.coins.gold);
    const total = getTotalWarehouse();
    const max   = getWhMax();
    const c1 = document.getElementById('hud-cur');
    const c2 = document.getElementById('hud-max');
    const sf = document.getElementById('hud-sfill');
    if (c1) c1.textContent = total;
    if (c2) c2.textContent = max;
    const fillPct = Math.min(100, total / max * 100);
    if (sf) sf.style.width = fillPct + '%';
    const p1 = document.getElementById('prof-normal');
    const p2 = document.getElementById('prof-silver');
    const p3 = document.getElementById('prof-gold');
    if (p1) p1.textContent = formatNum(gameState.coins.normal);
    if (p2) p2.textContent = formatNum(gameState.coins.silver);
    if (p3) p3.textContent = formatNum(gameState.coins.gold);
    updateForgeUI();
    updateBoostTimer();
}

function updateBoostTimer() {
    const el = document.getElementById('boost-timer');
    if (!el) return;
    if (gameState.incomeBoostExpiry && Date.now() < gameState.incomeBoostExpiry) {
        const rem = Math.ceil((gameState.incomeBoostExpiry - Date.now()) / 1000);
        const m = Math.floor(rem/60); const s = rem % 60;
        el.textContent = `⚡ Буст ${Math.round((gameState.incomeBoostValue||1)*100-100)}% — ${m}:${String(s).padStart(2,'0')}`;
        el.style.display = 'block';
    } else {
        el.style.display = 'none';
    }
}

function switchScreen(screen, btn) {
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const target = document.getElementById(screen + '-screen');
    if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
    if (btn) btn.classList.add('active');
    closeUpgradePanel();
    if (screen === 'miners') loadLeaderboard('normal');
    if (screen === 'craft') { updateHUD(); renderForgeSlots(); renderDailyReward(); }
    if (screen === 'profile') updateProfileScreen();
}

canvas.addEventListener('click', (e) => {
    initAudio();
    const rect = canvas.getBoundingClientRect();
    const scaleX = W / rect.width;
    const scrollTop = canvas.parentElement.scrollTop || 0;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleX + scrollTop;
    const sy = getSY();
    const liftX = W * LIFT_X_PCT;
    const whX   = W * WAREHOUSE_X_PCT;
    const liftTopY = sy - 90;

    if (Math.abs(cx - liftX) < 44 && cy > liftTopY - 46 && cy < liftTopY - 5) {
        openUpgradePanel('lift'); return;
    }

    if (Math.abs(cx - liftX) < 50 && cy > liftTopY && cy < H) {
        openUpgradePanel('lift'); return;
    }

    const trackX1 = liftX + 26;
    const trackX2 = whX - 28;
    const trainDrawX = trackX1 + (trackX2 - trackX1) * (1 - trainAnim.x);
    if (Math.abs(cx - trainDrawX) < 50 && cy > sy - 55 && cy < sy + 30) {
        openUpgradePanel('train'); return;
    }

    if (Math.abs(cx - whX) < 70 && cy < sy + 30) {
        if (cy < sy - 5 && Math.abs(cx - whX) < 44) {
            openUpgradePanel('warehouse');
        } else {
            openUpgradePanel('warehouse');
        }
        return;
    }

    const unlockedMines = gameState.mines.filter(m => m.unlocked);
    const mineCount = unlockedMines.length;
    const liftRightEdge2 = liftX + 22;
    const whLeftEdge2 = whX - 52;
    const mineZoneStartC = liftRightEdge2 + 10;
    const mineZoneEndC = whLeftEdge2 - 10;
    const mineZoneWC = mineZoneEndC - mineZoneStartC;
    const mineStep = mineCount > 1 ? mineZoneWC / mineCount : 0;
    const firstMineX = mineZoneStartC + (mineCount > 1 ? mineStep / 2 : mineZoneWC / 2);
    const rawCabinWC = Math.floor(mineZoneWC / Math.max(mineCount,1)) - 10;
    const cabinW = Math.max(50, Math.min(rawCabinWC, 180));
    const cabinH = H - sy - 60;

    for (let i = 0; i < unlockedMines.length; i++) {
        const mx = firstMineX + i * mineStep;
        const cabinTop = sy + 16;
        const upgBtnY = cabinTop + cabinH + 32;

        if (cx >= mx - 44 && cx <= mx + 44 && cy >= upgBtnY - 14 && cy <= upgBtnY + 14) {
            openUpgradePanel('miner', i); return;
        }

        if (cx >= mx - cabinW/2 - 10 && cx <= mx + cabinW/2 + 10 && cy >= cabinTop - 10 && cy <= cabinTop + cabinH + 15) {
            openUpgradePanel('miner', i); return;
        }
    }

    if (mineCount < MAX_MINES) {
        const mZS3 = liftRightEdge2 + 10;
        const mZW3 = (whLeftEdge2 - 10) - mZS3;
        const mStep3 = mineCount > 1 ? mZW3 / mineCount : 0;
        const firstMX3 = mZS3 + (mineCount > 1 ? mStep3 / 2 : mZW3 / 2);
        const btnX3 = firstMX3 + mineCount * mStep3;
        const btnY3 = sy + (H - sy - 60) / 2 + 30;
        if (Math.abs(cx - btnX3) < 90 && Math.abs(cy - btnY3) < 22) {
            unlockMine(mineCount); return;
        }
    }
});

let currentUpgradeTarget = null;
let currentUpgradeMineIdx = 0;

function openUpgradePanel(target, mineIdx) {
    currentUpgradeTarget = target;
    if (mineIdx !== undefined) currentUpgradeMineIdx = mineIdx;
    const panel   = document.getElementById('upgrade-panel');
    const content = document.getElementById('upgrade-content');
    const title   = document.getElementById('upgrade-title');
    panel.classList.remove('hidden');
    const mult = isHappyHour() ? 0.95 : 1.0;
    if (target === 'miner') {
        title.textContent = `⛏️ ШАХТА ${(currentUpgradeMineIdx||0)+1}`;
        content.innerHTML = buildUpgradeHTML(['minerSpeed','minerCap','mineStorageCap'], mult);
    } else if (target === 'lift') {
        title.textContent = '🚡 ЛИФТ';
        content.innerHTML = buildUpgradeHTML(['liftSpeed','liftCap'], mult);
    } else if (target === 'train') {
        title.textContent = '🚂 ПОЕЗД';
        content.innerHTML = buildTrainUpgradeHTML();
    } else if (target === 'warehouse') {
        title.textContent = '🏦 ХРАНИЛИЩЕ';
        content.innerHTML = buildWarehouseUpgradeHTML();
    }
}

function buildWarehouseUpgradeHTML() {
    const lvl = gameState.upgradeLevels.warehouseCap || 1;
    const maxLvl = WAREHOUSE_UPGRADE_CONFIG.levels.length;
    const isMax = lvl >= maxLvl;
    const currentCap = getWhMax();
    const nextCap = isMax ? currentCap : WAREHOUSE_UPGRADE_CONFIG.levels[lvl];
    const cost = isMax ? 0 : getWhUpgradeCost();
    const canAfford = !isMax && gameState.coins.normal >= cost;
    const btnClass = isMax ? 'maxed' : (canAfford ? '' : 'insufficient');
    const refBonus = Math.min(gameState.referrals || 0, 10) * 20;
    return `<div class="upgrade-section">
        <div class="upgrade-section-title">🏦 ХРАНИЛИЩЕ</div>
        <div class="upgrade-item" style="flex-direction:column;align-items:flex-start;gap:6px">
            <div class="upgrade-item-name">📦 Вместимость склада</div>
            <div class="upgrade-item-desc">Текущая: ${formatNum(currentCap)} мест</div>
            ${!isMax ? `<div class="upgrade-item-desc">После: ${formatNum(nextCap + refBonus)} мест</div>` : ''}
            <div class="upgrade-item-desc">👥 Бонус рефералов: +${refBonus}</div>
            <div style="display:flex;align-items:center;gap:8px;width:100%">
                <div class="upgrade-item-level">Lv.${lvl}</div>
                <button class="upgrade-cost-btn ${btnClass}" style="flex:1" onclick="doWarehouseUpgrade()">
                    ${isMax ? 'МАКС' : `${formatNum(cost)} 🪙`}
                </button>
            </div>
        </div>
    </div>`;
}

function buildTrainUpgradeHTML() {
    return `<div class="upgrade-section">
        <div class="upgrade-section-title">🚂 ПОЕЗД</div>
        <div class="upgrade-item" style="flex-direction:column;align-items:flex-start;gap:6px">
            <div class="upgrade-item-name">🚂 Поезд автоматический</div>
            <div class="upgrade-item-desc">Поезд всегда работает автоматически — перевозит монеты со склада</div>
            <div class="upgrade-item-desc" style="color:#66BB6A">✅ Уровень поезда: ${gameState.train?.level || 1}</div>
        </div>
    </div>`;
}

function doWarehouseUpgrade() {
    const lvl = gameState.upgradeLevels.warehouseCap || 1;
    const maxLvl = WAREHOUSE_UPGRADE_CONFIG.levels.length;
    if (lvl >= maxLvl) { showToast('Максимальный уровень!'); return; }
    const cost = getWhUpgradeCost();
    if (gameState.coins.normal < cost) { showToast('Недостаточно монет!'); return; }
    gameState.coins.normal -= cost;
    gameState.upgradeLevels.warehouseCap = lvl + 1;
    saveState(); openUpgradePanel('warehouse'); updateHUD();
    showToast(`🏦 Хранилище до ${formatNum(getWhMax())}!`);
}

function buildUpgradeHTML(keys, costMult) {
    return keys.map(key => {
        const cfg   = UPGRADE_CONFIG[key];
        const lvl   = gameState.upgradeLevels[key];
        const isMax = lvl >= 10;
        const cost  = isMax ? 0 : Math.ceil(cfg.costs[lvl-1] * costMult);
        const canAfford = !isMax && gameState.coins.normal >= cost;
        const btnClass  = isMax ? 'maxed' : (canAfford ? '' : 'insufficient');
        const btnText   = isMax ? 'МАКС' : `${formatNum(cost)} 🪙`;
        const desc = cfg.speedMult ? `Скорость: ×${cfg.speedMult[lvl-1].toFixed(1)}` : `Бонус: +${cfg.capAdd[lvl-1]}`;
        return `<div class="upgrade-section">
            <div class="upgrade-section-title">${cfg.icon} ${cfg.name}</div>
            <div class="upgrade-item">
                <div class="upgrade-item-info">
                    <div class="upgrade-item-name">${cfg.name}</div>
                    <div class="upgrade-item-desc">${desc}</div>
                </div>
                <div class="upgrade-item-level">Lv.${lvl}</div>
                <button class="upgrade-cost-btn ${btnClass}" onclick="doUpgrade('${key}')">${btnText}</button>
            </div>
        </div>`;
    }).join('');
}

function closeUpgradePanel() { document.getElementById('upgrade-panel').classList.add('hidden'); }

function doUpgrade(key) {
    const cfg = UPGRADE_CONFIG[key];
    const lvl = gameState.upgradeLevels[key];
    if (lvl >= 10) { showToast('Максимальный уровень!'); return; }
    const cost = Math.ceil(cfg.costs[lvl-1] * (isHappyHour() ? 0.95 : 1.0));
    if (gameState.coins.normal < cost) { showToast('Недостаточно монет!'); return; }
    gameState.coins.normal -= cost;
    gameState.upgradeLevels[key]++;
    saveState(); openUpgradePanel(currentUpgradeTarget, currentUpgradeMineIdx); updateHUD();
    showToast(`${cfg.name} → Lv.${gameState.upgradeLevels[key]}!`);
}

function unlockMine(idx) {
    if (idx >= MAX_MINES) { showToast('Максимум шахт!'); return; }
    const cost = calcMineUnlockCost(idx);
    if (gameState.coins.normal < cost) { showToast(`Нужно ${formatNum(cost)} 🪙`); return; }
    gameState.coins.normal -= cost;
    gameState.mines.push({ id: idx, unlocked: true, storageCurrent: 0, storageMax: 50, level: 1 });
    minerAnims.push({ posX: 0.95, phase: 'goingToWall', timer: 0, swingAngle: 0 });
    saveState(); updateHUD();
    showToast(`⛏️ Шахта ${idx+1} открыта!`);
    playSuccessSound();
}

function updateProfileScreen() {
    const pn = document.getElementById('profile-name');
    const pi = document.getElementById('profile-id');
    const rl = document.getElementById('ref-link');
    const rc = document.getElementById('ref-count');
    const tonEl = document.getElementById('prof-ton');
    if (pn) pn.textContent = USER.name;
    if (pi) pi.textContent = `ID: ${USER.id}`;
    if (rl) rl.textContent = `https://t.me/${BOT_USERNAME}?start=${USER.id}`;
    if (rc) rc.textContent = gameState.referrals || 0;
    if (tonEl) tonEl.textContent = (gameState.stats.tonEarned || 0).toFixed(4);
    updateHUD();
    fetch(`${API_BASE}/referrals?user_id=${USER.id}&init_data=${encodeURIComponent(tg?.initData||'')}`)
        .then(r => r.json()).then(d => {
            if (d.count !== undefined) {
                gameState.referrals = d.count;
                if (rc) rc.textContent = d.count;
                const old = gameState.warehouseBonusSlots || 0;
                gameState.warehouseBonusSlots = Math.min(d.count, 10) * 20;
                if (gameState.warehouseBonusSlots !== old) saveState();
            }
        }).catch(() => {});
}

function copyRefLink() {
    const link = document.getElementById('ref-link').textContent;
    if (navigator.clipboard) navigator.clipboard.writeText(link).then(() => showToast('Ссылка скопирована!'));
    else showToast('Скопируй ссылку вручную');
}

let lbCurrentTab = 'normal';
function switchLbTab(type, btn) {
    lbCurrentTab = type;
    document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    loadLeaderboard(type);
}

async function loadLeaderboard(type) {
    const list = document.getElementById('lb-list');
    list.innerHTML = '<div class="lb-loading">ЗАГРУЗКА...</div>';
    try {
        const res  = await fetch(`${API_BASE}/leaderboard/${type}`);
        if (!res.ok) throw new Error('err');
        const data = await res.json();
        renderLeaderboard(data.players || data, type);
    } catch(e) {
        const myCoins = type === 'normal' ? gameState.coins.normal : type === 'silver' ? gameState.coins.silver : gameState.coins.gold;
        renderLeaderboard([{ name: USER.name, amount: myCoins, isMe: true }], type);
    }
}

function renderLeaderboard(data, type) {
    const list = document.getElementById('lb-list');
    const icon = { normal:'🪙', silver:'🥈', gold:'🏅' }[type];
    list.innerHTML = data.slice(0, 100).map((item, i) => {
        const rankClass = i===0?'gold-rank':i===1?'silver-rank':i===2?'bronze-rank':'';
        const rankEmoji = i===0?'🥇':i===1?'🥈':i===2?'🥉':`${i+1}`;
        return `<div class="lb-item ${rankClass} ${item.isMe?'my-rank':''}">
            <div class="lb-rank">${rankEmoji}</div>
            <div class="lb-name">${item.name}${item.isMe?' (Вы)':''}</div>
            <div class="lb-amount">${formatNum(item.amount)} ${icon}</div>
        </div>`;
    }).join('');
}

function openExchange() {
    showModal(`<div class="modal-title">💱 ОБМЕН НА TON</div>
        <div class="modal-section">
            <div class="modal-label">🥈 СЕРЕБРЯНЫЕ (мин. 100)</div>
            <div class="modal-label">Баланс: <b>${formatNum(gameState.coins.silver)}</b> | 1 = ${gameState.exchangeRates.silver} TON</div>
            <input class="modal-input" type="number" id="ex-silver-amt" placeholder="0" min="100">
            <div class="modal-info" id="ex-silver-info">≈ 0 TON</div>
        </div>
        <div class="modal-section">
            <div class="modal-label">🏅 ЗОЛОТЫЕ (мин. 100)</div>
            <div class="modal-label">Баланс: <b>${formatNum(gameState.coins.gold)}</b> | 1 = ${gameState.exchangeRates.gold} TON</div>
            <input class="modal-input" type="number" id="ex-gold-amt" placeholder="0" min="100">
            <div class="modal-info" id="ex-gold-info">≈ 0 TON</div>
        </div>
        <button class="modal-btn blue" onclick="doExchange()">Обменять</button>
        <button class="modal-cancel" onclick="closeModal()">Отмена</button>`);
    document.getElementById('ex-silver-amt').addEventListener('input', function() {
        document.getElementById('ex-silver-info').textContent = `≈ ${(+this.value * gameState.exchangeRates.silver).toFixed(4)} TON`;
    });
    document.getElementById('ex-gold-amt').addEventListener('input', function() {
        document.getElementById('ex-gold-info').textContent = `≈ ${(+this.value * gameState.exchangeRates.gold).toFixed(4)} TON`;
    });
}

function doExchange() {
    const sAmt = parseInt(document.getElementById('ex-silver-amt').value)||0;
    const gAmt = parseInt(document.getElementById('ex-gold-amt').value)||0;
    let totalTon = 0; let ok = true;
    if (sAmt > 0) {
        if (sAmt < 100) { showToast('Мин. 100 серебряных!'); ok=false; }
        else if (gameState.coins.silver < sAmt) { showToast('Недостаточно серебра!'); ok=false; }
        else { gameState.coins.silver -= sAmt; totalTon += sAmt * gameState.exchangeRates.silver; }
    }
    if (!ok) return;
    if (gAmt > 0) {
        if (gAmt < 100) { showToast('Мин. 100 золотых!'); ok=false; }
        else if (gameState.coins.gold < gAmt) { showToast('Недостаточно золота!'); ok=false; }
        else { gameState.coins.gold -= gAmt; totalTon += gAmt * gameState.exchangeRates.gold; }
    }
    if (!ok) return;
    if (totalTon === 0) { showToast('Укажите количество!'); return; }
    gameState.stats.tonEarned = (gameState.stats.tonEarned||0) + totalTon;
    saveState(); updateHUD(); closeModal();
    showToast(`✅ ${totalTon.toFixed(4)} TON будет зачислено!`);
    fetch(`${API_BASE}/exchange`, { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ user_id:USER.id, silver:sAmt, gold:gAmt, ton:totalTon, init_data:tg?.initData }) }).catch(()=>{});
}

function openDeposit() {
    showModal(`<div class="modal-title">⭐ ПОПОЛНИТЬ STARS</div>
        <div class="modal-section">
            <div class="modal-label">КОЛИЧЕСТВО STARS (МИН. 100)</div>
            <div style="display:flex;gap:7px;margin-bottom:10px;flex-wrap:wrap">
                <button class="modal-btn blue" style="padding:8px 4px;font-size:11px;flex:1" onclick="document.getElementById('dep-stars').value=100;updateDepInfo()">100⭐</button>
                <button class="modal-btn blue" style="padding:8px 4px;font-size:11px;flex:1" onclick="document.getElementById('dep-stars').value=250;updateDepInfo()">250⭐</button>
                <button class="modal-btn blue" style="padding:8px 4px;font-size:11px;flex:1" onclick="document.getElementById('dep-stars').value=500;updateDepInfo()">500⭐</button>
                <button class="modal-btn blue" style="padding:8px 4px;font-size:11px;flex:1" onclick="document.getElementById('dep-stars').value=1000;updateDepInfo()">1000⭐</button>
            </div>
            <input class="modal-input" type="number" id="dep-stars" placeholder="100" min="100">
            <div class="modal-info" id="dep-stars-info">100 ⭐ → 1000 🪙 + 100 🥈</div>
        </div>
        <div style="font-family:var(--font);font-size:10px;color:rgba(255,255,255,0.3);text-align:center;margin-bottom:8px;letter-spacing:1px">
            🔒 Оплата через Telegram Stars. Монеты зачисляются только после подтверждения Telegram.
        </div>
        <button class="modal-btn blue" onclick="confirmDepositStars()">⭐ Оплатить через Telegram</button>
        <button class="modal-cancel" onclick="closeModal()">Отмена</button>`);
    document.getElementById('dep-stars').addEventListener('input', updateDepInfo);
}

function updateDepInfo() {
    const el = document.getElementById('dep-stars'); if (!el) return;
    const v = +el.value || 0;
    const info = document.getElementById('dep-stars-info');
    if (info) info.textContent = `${v} ⭐ → ${Math.floor(v*10)} 🪙 + ${Math.floor(v)} 🥈`;
}

async function confirmDepositStars() {
    const amt = parseInt(document.getElementById('dep-stars').value)||0;
    if (amt < 100) { showToast('Минимум 100 Stars!'); return; }
    closeModal();

    if (!tg || !tg.initData) {
        showToast('❌ Только в Telegram Mini App');
        return;
    }

    showToast('⏳ Создаю счёт...');
    try {
        const res = await fetch(`${API_BASE}/create-stars-invoice`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: USER.id, stars: amt, init_data: tg.initData })
        });
        const data = await res.json();
        if (!res.ok) { showToast(`❌ ${data.detail || 'Ошибка сервера'}`); return; }

        const invoiceLink = data.invoice_url;
        const invoiceId   = data.invoice_id;

        if (!invoiceLink) {
            showToast('❌ Нет ссылки на оплату. Проверьте BOT_TOKEN.');
            return;
        }

        tg.openInvoice(invoiceLink, async (status) => {
            if (status === 'paid') {
                showToast('⏳ Проверяю оплату...');
                // Verify with server — server checks Telegram webhook confirmation
                try {
                    const vRes = await fetch(`${API_BASE}/check-invoice`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ invoice_id: invoiceId, user_id: USER.id, init_data: tg.initData })
                    });
                    const vData = await vRes.json();
                    if (vRes.ok && vData.status === 'ok') {
                        gameState.coins.normal = (gameState.coins.normal || 0) + (vData.normal || 0);
                        gameState.coins.silver = (gameState.coins.silver || 0) + (vData.silver || 0);
                        saveState(); updateHUD(); playSuccessSound();
                        showToast(`✅ +${vData.normal}🪙 +${vData.silver}🥈 зачислено!`);
                    } else if (vRes.status === 402) {
                        showToast('⏳ Ожидание подтверждения Telegram (обычно < 5 сек). Попробуй снова через момент.');
                        // Retry after 3s
                        setTimeout(() => verifyInvoiceRetry(invoiceId, amt), 3000);
                    } else {
                        showToast(`❌ ${vData.detail || 'Ошибка верификации'}`);
                    }
                } catch(e) {
                    showToast('❌ Нет связи с сервером при верификации');
                }
            } else if (status === 'cancelled') {
                showToast('Оплата отменена');
            } else if (status === 'failed') {
                showToast('❌ Оплата не прошла');
            }
        });
    } catch(e) {
        showToast('❌ Нет связи с сервером');
    }
}

async function verifyInvoiceRetry(invoiceId, stars, attempt = 1) {
    if (attempt > 5) { showToast('❌ Не удалось подтвердить оплату. Обратитесь в поддержку.'); return; }
    try {
        const vRes  = await fetch(`${API_BASE}/check-invoice`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoice_id: invoiceId, user_id: USER.id, init_data: tg?.initData || '' })
        });
        const vData = await vRes.json();
        if (vRes.ok && vData.status === 'ok') {
            gameState.coins.normal = (gameState.coins.normal || 0) + (vData.normal || 0);
            gameState.coins.silver = (gameState.coins.silver || 0) + (vData.silver || 0);
            saveState(); updateHUD(); playSuccessSound();
            showToast(`✅ +${vData.normal}🪙 +${vData.silver}🥈 подтверждено!`);
        } else if (vRes.status === 402) {
            setTimeout(() => verifyInvoiceRetry(invoiceId, stars, attempt + 1), 3000);
        } else {
            showToast(`❌ ${vData.detail || 'Ошибка'}`);
        }
    } catch(e) {
        setTimeout(() => verifyInvoiceRetry(invoiceId, stars, attempt + 1), 3000);
    }
}

function openWithdraw() {
    showModal(`<div class="modal-title">📤 ВЫВОД TON</div>
        <div class="modal-section">
            <div class="modal-label">TON адрес кошелька:</div>
            <input class="modal-input" type="text" id="withdraw-addr" placeholder="EQ...">
            <div class="modal-label" style="margin-top:10px">Сумма (мин. 1 TON):</div>
            <input class="modal-input" type="number" id="withdraw-amt" placeholder="1.0" min="1" step="0.1">
        </div>
        <button class="modal-btn orange" onclick="doWithdraw()">Вывести</button>
        <button class="modal-cancel" onclick="closeModal()">Отмена</button>`);
}

function doWithdraw() {
    const addr = document.getElementById('withdraw-addr').value.trim();
    const amt  = parseFloat(document.getElementById('withdraw-amt').value)||0;
    if (!addr || addr.length < 20) { showToast('Некорректный адрес!'); return; }
    if (amt < 1) { showToast('Минимум 1 TON!'); return; }
    closeModal(); showToast('📤 Заявка отправлена!');
    fetch(`${API_BASE}/withdraw`, { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ user_id:USER.id, address:addr, amount:amt, init_data:tg?.initData }) }).catch(()=>{});
}

function openShop() {
    showModal(`<div class="modal-title">🛒 МАГАЗИН</div>
        <div style="margin-bottom:14px">
            <div style="font-family:var(--font);font-size:11px;color:#81D4FA;letter-spacing:2px;margin-bottom:10px;text-transform:uppercase">⚡ Буст дохода</div>
            <button class="shop-boost-btn" onclick="buyBoost(0.1, 1, 100)">
                <span class="shop-boost-info">+10% дохода на 1 час</span>
                <span class="shop-boost-price">100 ⭐</span>
            </button>
            <button class="shop-boost-btn" onclick="buyBoost(0.2, 1, 150)">
                <span class="shop-boost-info">+20% дохода на 1 час</span>
                <span class="shop-boost-price">150 ⭐</span>
            </button>
            <button class="shop-boost-btn" onclick="buyBoost(0.35, 1, 225)">
                <span class="shop-boost-info">+35% дохода на 1 час</span>
                <span class="shop-boost-price">225 ⭐</span>
            </button>
        </div>
        <div style="margin-bottom:14px">
            <div style="font-family:var(--font);font-size:11px;color:#FFD700;letter-spacing:2px;margin-bottom:10px;text-transform:uppercase">🎫 Промокод</div>
            <input class="modal-input" type="text" id="promo-input" placeholder="Введите промокод" style="text-transform:uppercase">
            <button class="modal-btn green" style="margin-top:8px" onclick="activatePromo()">Активировать</button>
        </div>
        <button class="modal-cancel" onclick="closeModal()">Закрыть</button>`);
}

async function buyBoost(pct, hours, stars) {
    closeModal();

    if (!tg || !tg.initData) {
        showToast('❌ Только в Telegram Mini App');
        return;
    }

    showToast('⏳ Создаю счёт...');
    try {
        const res = await fetch(`${API_BASE}/create-boost-invoice`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: USER.id, stars, boost_pct: pct, boost_hours: hours, init_data: tg.initData })
        });
        const data = await res.json();
        if (!res.ok) { showToast(`❌ ${data.detail || 'Ошибка сервера'}`); return; }

        const link      = data.invoice_url;
        const invoiceId = data.invoice_id;

        if (!link) { showToast('❌ Нет ссылки на оплату. Проверьте BOT_TOKEN.'); return; }

        tg.openInvoice(link, async (status) => {
            if (status === 'paid') {
                showToast('⏳ Верифицирую оплату...');
                try {
                    const vRes  = await fetch(`${API_BASE}/check-invoice`, {
                        method: 'POST', headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ invoice_id: invoiceId, user_id: USER.id, init_data: tg.initData })
                    });
                    const vData = await vRes.json();
                    if (vRes.ok && vData.status === 'ok') {
                        // Server confirmed payment → apply boost
                        const expiry = vData.expiry_ms || (Date.now() + hours * 3600000);
                        gameState.incomeBoostExpiry = expiry;
                        gameState.incomeBoostValue  = 1 + pct;
                        saveState(); updateHUD(); playSuccessSound();
                        showToast(`⚡ Буст +${Math.round(pct*100)}% на ${hours}ч активирован!`);
                    } else if (vRes.status === 402) {
                        // Webhook not yet received — retry
                        showToast('⏳ Ожидание подтверждения...');
                        setTimeout(() => verifyBoostRetry(invoiceId, pct, hours, 1), 3000);
                    } else {
                        showToast(`❌ ${vData.detail || 'Ошибка верификации'}`);
                    }
                } catch(e) {
                    showToast('❌ Нет связи с сервером');
                }
            } else if (status === 'cancelled') {
                showToast('Оплата отменена');
            } else {
                showToast('❌ Ошибка оплаты');
            }
        });
    } catch(e) {
        showToast('❌ Нет связи с сервером');
    }
}

async function verifyBoostRetry(invoiceId, pct, hours, attempt) {
    if (attempt > 5) { showToast('❌ Не удалось подтвердить. Напишите в поддержку.'); return; }
    try {
        const vRes  = await fetch(`${API_BASE}/check-invoice`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invoice_id: invoiceId, user_id: USER.id, init_data: tg?.initData || '' })
        });
        const vData = await vRes.json();
        if (vRes.ok && vData.status === 'ok') {
            const expiry = vData.expiry_ms || (Date.now() + hours * 3600000);
            gameState.incomeBoostExpiry = expiry;
            gameState.incomeBoostValue  = 1 + pct;
            saveState(); updateHUD(); playSuccessSound();
            showToast(`⚡ Буст +${Math.round(pct*100)}% подтверждён!`);
        } else if (vRes.status === 402) {
            setTimeout(() => verifyBoostRetry(invoiceId, pct, hours, attempt + 1), 3000);
        }
    } catch(e) {
        setTimeout(() => verifyBoostRetry(invoiceId, pct, hours, attempt + 1), 3000);
    }
}

function applyBoost(pct, hours) {
    gameState.incomeBoostExpiry = Date.now() + hours * 3600000;
    gameState.incomeBoostValue = 1 + pct;
    saveState(); updateHUD(); playSuccessSound();
    showToast(`⚡ Буст +${Math.round(pct*100)}% активирован на ${hours}ч!`);
}

async function activatePromo() {
    const code = (document.getElementById('promo-input').value || '').trim().toUpperCase();
    if (!code) { showToast('Введите промокод!'); return; }
    try {
        const res = await fetch(`${API_BASE}/promo/activate`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: USER.id, code, init_data: tg?.initData })
        });
        const data = await res.json();
        if (res.ok) {
            if (data.normal) gameState.coins.normal += data.normal;
            if (data.silver) gameState.coins.silver += data.silver;
            if (data.gold) gameState.coins.gold += data.gold;
            saveState(); updateHUD(); closeModal();
            const parts = [];
            if (data.normal) parts.push(`+${data.normal}🪙`);
            if (data.silver) parts.push(`+${data.silver}🥈`);
            if (data.gold) parts.push(`+${data.gold}🏅`);
            showToast(`🎉 Промокод активирован! ${parts.join(' ')}`);
        } else {
            showToast(`❌ ${data.detail || 'Промокод не найден'}`);
        }
    } catch(e) {
        showToast('❌ Нет связи с сервером');
    }
}

function renderDailyReward() {
    const container = document.getElementById('daily-reward-container');
    if (!container) return;
    const streak = gameState.dailyStreak || { streak: 0, lastClaim: 0, goldDropBonus: 0, incomeBonus: 0 };
    const now = Date.now();
    const lastClaim = streak.lastClaim || 0;
    const msIn24h = 24 * 60 * 60 * 1000;
    const canClaim = now - lastClaim >= msIn24h;
    const nextClaimIn = canClaim ? 0 : Math.ceil((lastClaim + msIn24h - now) / 1000);
    const streakDays = streak.streak || 0;
    const goldBonus = streak.goldDropBonus || 0;
    const incomeBonus = streak.incomeBonus || 0;
    const rewards = generateDailyRewardPreview(streakDays + 1);

    let timeStr = '';
    if (!canClaim && nextClaimIn > 0) {
        const h = Math.floor(nextClaimIn / 3600);
        const m = Math.floor((nextClaimIn % 3600) / 60);
        const s = nextClaimIn % 60;
        timeStr = `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    }

    container.innerHTML = `
    <div class="daily-reward-card">
        <div class="daily-streak-wrap">
            <div class="daily-streak-fire">🔥</div>
            <div class="daily-streak-num">${streakDays}</div>
            <div class="daily-streak-label">ДНЕЙ ПОДРЯД</div>
        </div>
        <div class="daily-bonuses">
            ${goldBonus > 0 ? `<div class="daily-bonus-chip">🏅 +${goldBonus}% золота</div>` : ''}
            ${incomeBonus > 0 ? `<div class="daily-bonus-chip">📈 +${incomeBonus}% дохода</div>` : ''}
        </div>
        <div class="daily-next-reward">
            <div style="font-family:var(--font);font-size:11px;color:rgba(255,255,255,0.4);margin-bottom:6px;letter-spacing:1px">СЛЕДУЮЩАЯ НАГРАДА</div>
            <div style="display:flex;gap:8px;justify-content:center;margin-bottom:12px;flex-wrap:wrap">
                ${rewards.map(r => `<div class="daily-reward-preview">${r.icon}<span>${r.label}</span></div>`).join('')}
            </div>
        </div>
        ${canClaim
            ? `<button class="daily-claim-btn" onclick="claimDailyReward()">🎁 ЗАБРАТЬ НАГРАДУ</button>`
            : `<div class="daily-timer">⏰ Следующая через: <span id="daily-countdown">${timeStr}</span></div>`
        }
    </div>`;

    if (!canClaim) {
        clearInterval(window._dailyCountdownTimer);
        window._dailyCountdownTimer = setInterval(() => {
            const el = document.getElementById('daily-countdown');
            if (!el) { clearInterval(window._dailyCountdownTimer); return; }
            const rem = Math.max(0, Math.ceil((streak.lastClaim + msIn24h - Date.now()) / 1000));
            if (rem === 0) { clearInterval(window._dailyCountdownTimer); renderDailyReward(); return; }
            const h2 = Math.floor(rem / 3600);
            const m2 = Math.floor((rem % 3600) / 60);
            const s2 = rem % 60;
            el.textContent = `${String(h2).padStart(2,'0')}:${String(m2).padStart(2,'0')}:${String(s2).padStart(2,'0')}`;
        }, 1000);
    }
}

function generateDailyRewardPreview(day) {
    const rng = mulberry32(day * 12345);
    const rewards = [];
    const roll = rng() * 100;
    if (roll < 15) rewards.push({ icon: '🏅', label: `+${Math.ceil(rng()*20)} золота` });
    else if (roll < 45) rewards.push({ icon: '🥈', label: `+${Math.ceil(rng()*50+10)} серебра` });
    else rewards.push({ icon: '🪙', label: `+${Math.ceil(rng()*80+20)} монет` });
    if (rng() < 0.25) rewards.push({ icon: '📈', label: '+20% дохода' });
    if (rng() < 0.15 && day > 3) rewards.push({ icon: '🆙', label: 'Улучшение' });
    return rewards;
}

function mulberry32(a) {
    return function() {
        a |= 0; a = a + 0x6D2B79F5 | 0;
        let t = Math.imul(a ^ a >>> 15, 1 | a);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

function claimDailyReward() {
    const streak = gameState.dailyStreak || { streak: 0, lastClaim: 0, goldDropBonus: 0, incomeBonus: 0 };
    const now = Date.now();
    const msIn24h = 24 * 60 * 60 * 1000;
    if (now - (streak.lastClaim || 0) < msIn24h) { showToast('Уже получено!'); return; }

    const msIn48h = 48 * 60 * 60 * 1000;
    if (streak.lastClaim && now - streak.lastClaim >= msIn48h) {
        streak.streak = 1;
        streak.goldDropBonus = Math.max(0, (streak.goldDropBonus || 0) - 2);
        streak.incomeBonus = Math.max(0, (streak.incomeBonus || 0) - 5);
    } else {
        streak.streak = (streak.streak || 0) + 1;
        if (streak.streak % 7 === 0) streak.goldDropBonus = Math.min(15, (streak.goldDropBonus || 0) + 1);
        if (streak.streak % 5 === 0) streak.incomeBonus = Math.min(30, (streak.incomeBonus || 0) + 5);
    }
    streak.lastClaim = now;

    const rng = mulberry32(streak.streak * 12345 + now % 1000);
    const gained = { normal: 0, silver: 0, gold: 0 };
    const roll = rng() * 100;
    if (roll < 15) gained.gold = Math.ceil(rng()*20);
    else if (roll < 45) gained.silver = Math.ceil(rng()*50+10);
    else gained.normal = Math.ceil(rng()*80+20);

    let bonusMsg = '';
    if (rng() < 0.25) {
        streak.incomeBonus = Math.min(30, (streak.incomeBonus || 0) + 5);
        bonusMsg += ' +20% доход';
    }
    if (rng() < 0.15 && streak.streak > 3) {
        const keys = ['minerSpeed','minerCap','liftSpeed'];
        const k = keys[Math.floor(rng() * keys.length)];
        if (gameState.upgradeLevels[k] < 10) {
            gameState.upgradeLevels[k]++;
            bonusMsg += ` +1 уровень ${UPGRADE_CONFIG[k].name}`;
        }
    }

    if (gained.normal) gameState.coins.normal += gained.normal;
    if (gained.silver) gameState.coins.silver += gained.silver;
    if (gained.gold) gameState.coins.gold += gained.gold;
    gameState.dailyStreak = streak;
    saveState(); updateHUD(); playSuccessSound();
    renderDailyReward();

    const parts = [];
    if (gained.normal) parts.push(`+${gained.normal}🪙`);
    if (gained.silver) parts.push(`+${gained.silver}🥈`);
    if (gained.gold) parts.push(`+${gained.gold}🏅`);
    showToast(`🎁 ${parts.join(' ')}${bonusMsg}  🔥 Страйк: ${streak.streak}`);
}

function showModal(html) {
    document.getElementById('modal-content').innerHTML = html;
    document.getElementById('modal-overlay').classList.remove('hidden');
}
function closeModal() { document.getElementById('modal-overlay').classList.add('hidden'); }

let toastTimeout;
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 2600);
}

function formatNum(n) {
    if (n >= 1000000000) return (n/1000000000).toFixed(1) + 'B';
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n/1000).toFixed(1) + 'K';
    return Math.floor(n).toString();
}

function adminSaveRates() {
    const n = parseFloat(document.getElementById('adm-normal-pct').value)||70;
    const s = parseFloat(document.getElementById('adm-silver-pct').value)||25;
    const g = parseFloat(document.getElementById('adm-gold-pct').value)||5;
    if (Math.abs(n+s+g-100) > 1) { showToast('Сумма = 100%!'); return; }
    gameState.rates = { normal:n, silver:s, gold:g };
    const sr = parseFloat(document.getElementById('adm-silver-rate').value)||0.001;
    const gr = parseFloat(document.getElementById('adm-gold-rate').value)||0.005;
    gameState.exchangeRates = { silver:sr, gold:gr };
    saveState();
    fetch(`${API_BASE}/admin/settings`, { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ admin_id:USER.id, normal_rate:n, silver_rate:s, gold_rate:g,
            silver_ton_rate:sr, gold_ton_rate:gr, init_data:tg?.initData }) }).catch(()=>{});
    showToast('✅ Настройки сохранены!');
}

function adminSaveEconomy() {
    const refAmt = parseInt(document.getElementById('adm-ref-amount').value)||1;
    const refType = document.getElementById('adm-ref-type').value || 'silver';
    const upgMult = parseFloat(document.getElementById('adm-upg-mult').value)||1.0;

    const mineCosts = {};
    for (let i = 1; i < MAX_MINES; i++) {
        const el = document.getElementById(`adm-mine-cost-${i}`);
        if (el && el.value) mineCosts[i] = parseInt(el.value);
    }

    const cfg = getAdminSettings();
    cfg.refReward = { type: refType, amount: refAmt };
    cfg.upgradeMultiplier = upgMult;
    cfg.mineCosts = Object.keys(mineCosts).length > 0 ? mineCosts : null;
    saveAdminSettings(cfg);

    fetch(`${API_BASE}/admin/economy`, { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ admin_id:USER.id, ref_reward_type:refType, ref_reward_amount:refAmt,
            upgrade_mult:upgMult, mine_costs:mineCosts, init_data:tg?.initData }) }).catch(()=>{});
    showToast('✅ Экономика сохранена!');
}

function adminStartHappyHour() {
    const dur = parseInt(document.getElementById('adm-happy-duration').value)||60;
    gameState.happyHour = { active:true, endsAt: Date.now() + dur*60000 };
    saveState();
    document.getElementById('happy-hour-badge').classList.remove('hidden');
    document.getElementById('happy-status').textContent = `⚡ Активен! Осталось: ${dur} мин`;
    showToast('⚡ Счастливый час запущен!');
}

function adminLoadStats() {
    const statsDiv = document.getElementById('adm-global-stats');
    if (!statsDiv) return;
    statsDiv.innerHTML = '<div style="color:rgba(255,255,255,0.4);font-size:11px;font-family:var(--font)">Загрузка...</div>';
    fetch(`${API_BASE}/admin/stats?admin_id=${USER.id}&init_data=${encodeURIComponent(tg?.initData||'')}`)
        .then(r => r.json()).then(d => {
            statsDiv.innerHTML = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:10px;text-align:center">
                    <div style="font-size:22px;font-weight:900;color:#8BC34A;font-family:var(--font)">${d.total_users || 0}</div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.4);font-family:var(--font)">ВСЕГО ИГРОКОВ</div>
                </div>
                <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:10px;text-align:center">
                    <div style="font-size:22px;font-weight:900;color:#FFD700;font-family:var(--font)">${d.new_24h || 0}</div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.4);font-family:var(--font)">ЗА 24 ЧАСА</div>
                </div>
                <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:10px;text-align:center">
                    <div style="font-size:22px;font-weight:900;color:#81D4FA;font-family:var(--font)">${d.active_24h || 0}</div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.4);font-family:var(--font)">АКТИВНЫХ DAU</div>
                </div>
                <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:10px;text-align:center">
                    <div style="font-size:22px;font-weight:900;color:#FFD700;font-family:var(--font)">⭐${d.stars_revenue || 0}</div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.4);font-family:var(--font)">STARS ВЫРУЧКА</div>
                </div>
                <div style="background:rgba(0,0,0,0.3);border-radius:8px;padding:10px;text-align:center;grid-column:1/-1">
                    <div style="font-size:18px;font-weight:900;color:#FF8A65;font-family:var(--font)">${d.pending_withdrawals || 0} заявок</div>
                    <div style="font-size:10px;color:rgba(255,255,255,0.4);font-family:var(--font)">ВЫВОД PENDING</div>
                </div>
            </div>`;
        }).catch(() => {
            statsDiv.innerHTML = '<div style="color:rgba(255,100,100,0.6);font-size:11px;font-family:var(--font)">Нет связи с сервером</div>';
        });
}

function adminLoadPromoList() {
    const el = document.getElementById('adm-promo-list');
    if (!el) return;
    el.innerHTML = '<div style="color:rgba(255,255,255,0.3);font-size:10px;font-family:var(--font)">Загрузка...</div>';
    fetch(`${API_BASE}/admin/promo/list?admin_id=${USER.id}`)
        .then(r => r.json()).then(d => {
            if (!d.codes || d.codes.length === 0) {
                el.innerHTML = '<div style="color:rgba(255,255,255,0.2);font-size:10px;font-family:var(--font)">Промокодов нет</div>';
                return;
            }
            el.innerHTML = d.codes.map(c => `
                <div style="background:rgba(255,255,255,0.05);border-radius:7px;padding:8px 10px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center">
                    <div>
                        <div style="font-family:var(--font);font-size:12px;color:#FFD700;letter-spacing:1px">${c.code}</div>
                        <div style="font-family:var(--font);font-size:10px;color:rgba(255,255,255,0.4)">
                            🪙${c.normal} 🥈${c.silver} 🏅${c.gold} · ${c.uses_current}/${c.uses_max} исп.
                        </div>
                    </div>
                    <div style="font-family:var(--font);font-size:10px;color:${c.uses_current>=c.uses_max ? '#f44336' : '#8BC34A'}">
                        ${c.uses_current >= c.uses_max ? '❌ Исчерп.' : '✅ Акт.'}
                    </div>
                </div>`).join('');
        }).catch(() => {
            el.innerHTML = '<div style="color:rgba(255,100,100,0.5);font-size:10px;font-family:var(--font)">Нет связи</div>';
        });
}

function adminLookupUser() {
    const uid = document.getElementById('adm-user-id').value.trim();
    if (!uid) { showToast('Введите ID!'); return; }
    const infoEl = document.getElementById('adm-user-info');
    infoEl.classList.remove('hidden');
    document.getElementById('adm-user-name').textContent = `Пользователь: ${uid}...`;
    fetch(`${API_BASE}/user/${uid}?admin_id=${USER.id}`).then(r => r.json()).then(d => {
        if (d.user_id) {
            document.getElementById('adm-user-name').textContent = `${d.first_name || d.username || uid} (ID: ${d.user_id})`;
            const balEl = document.getElementById('adm-user-balance');
            if (balEl) balEl.innerHTML = `<span style="color:#FFD700">🪙 ${formatNum(d.coins_normal)}</span>  <span style="color:#C0C0C0">🥈 ${formatNum(d.coins_silver)}</span>  <span style="color:#FFB400">🏅 ${formatNum(d.coins_gold)}</span>`;
        } else {
            document.getElementById('adm-user-name').textContent = `ID: ${uid} (не найден)`;
        }
    }).catch(() => { document.getElementById('adm-user-name').textContent = `ID: ${uid} (сервер недоступен)`; });
}

async function adminGiveCoins() {
    const n = parseInt(document.getElementById('adm-give-normal').value)||0;
    const s = parseInt(document.getElementById('adm-give-silver').value)||0;
    const g = parseInt(document.getElementById('adm-give-gold').value)||0;
    const uid = document.getElementById('adm-user-id').value.trim();
    if (!uid) { showToast('Введите ID!'); return; }
    if (String(uid) === String(USER.id)) {
        gameState.coins.normal += n; gameState.coins.silver += s; gameState.coins.gold += g;
        saveState(); updateHUD(); showToast(`✅ Начислено: ${n}🪙 ${s}🥈 ${g}🏅`); return;
    }
    try {
        const res = await fetch(`${API_BASE}/admin/give`, { method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ admin_id:USER.id, target_id:uid, normal:n, silver:s, gold:g, init_data:tg?.initData }) });
        const data = await res.json();
        res.ok ? showToast(`✅ Начислено`) : showToast(`❌ ${data.detail}`);
    } catch(e) { showToast('❌ Нет связи'); }
}

async function adminRemoveCoins() {
    const n = parseInt(document.getElementById('adm-give-normal').value)||0;
    const s = parseInt(document.getElementById('adm-give-silver').value)||0;
    const g = parseInt(document.getElementById('adm-give-gold').value)||0;
    const uid = document.getElementById('adm-user-id').value.trim();
    if (!uid) { showToast('Введите ID!'); return; }
    if (String(uid) === String(USER.id)) {
        gameState.coins.normal = Math.max(0, gameState.coins.normal - n);
        gameState.coins.silver = Math.max(0, gameState.coins.silver - s);
        gameState.coins.gold   = Math.max(0, gameState.coins.gold - g);
        saveState(); updateHUD(); showToast(`✅ Списано`); return;
    }
    try {
        const res = await fetch(`${API_BASE}/admin/remove`, { method:'POST', headers:{'Content-Type':'application/json'},
            body:JSON.stringify({ admin_id:USER.id, target_id:uid, normal:n, silver:s, gold:g, init_data:tg?.initData }) });
        const data = await res.json();
        res.ok ? showToast(`✅ Списано`) : showToast(`❌ ${data.detail}`);
    } catch(e) { showToast('❌ Нет связи'); }
}

async function adminCreatePromo() {
    const code = (document.getElementById('adm-promo-code').value||'').trim().toUpperCase();
    const uses  = parseInt(document.getElementById('adm-promo-uses').value)||1;
    const nn    = parseInt(document.getElementById('adm-promo-normal').value)||0;
    const ss    = parseInt(document.getElementById('adm-promo-silver').value)||0;
    const gg    = parseInt(document.getElementById('adm-promo-gold').value)||0;
    if (!code) { showToast('Введите код!'); return; }
    try {
        const res = await fetch(`${API_BASE}/admin/promo/create`, { method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ admin_id:USER.id, code, uses, normal:nn, silver:ss, gold:gg, init_data:tg?.initData }) });
        const data = await res.json();
        res.ok ? showToast(`✅ Промокод ${code} создан!`) : showToast(`❌ ${data.detail}`);
    } catch(e) { showToast('❌ Нет связи'); }
}

const TUTORIAL_STEPS = [
    { text: 'Привет! Добро пожаловать в GIFTS TYCOON!\nЗдесь ты строишь собственную шахту!' },
    { text: '⛏️ Шахтёр сам копает монеты! Справа он добывает, слева стоит менеджер.\nНажми 🔧 УЛУЧШИТЬ рядом с шахтой для апгрейдов!' },
    { text: '🚡 Лифт автоматически поднимает монеты наверх!\nНажми УЛУЧШИТЬ над лифтом для улучшений!' },
    { text: '🚂 Поезд сам возит монеты на склад!\nОн всегда работает, ничего не нужно нажимать!' },
    { text: '🎁 В Кузнице есть ежедневная награда!\nЗаходи каждый день — страйк дает бонусы!' },
    { text: '🛒 Магазин — кнопка рядом с полоской склада!\nКупи буст дохода или введи промокод!' },
    { text: '⚗️ Плавь монеты в Кузнице!\n🪙×8 → 🥈×1\n🥈×4 → 🏅×1\nУдачи! ⛏️' }
];
let tutStep = 0;

function showTutorial() {
    const overlay = document.getElementById('tutorial-overlay');
    overlay.classList.remove('hidden');
    renderTutStep();
}
function renderTutStep() {
    const step = TUTORIAL_STEPS[tutStep];
    const bubble = document.getElementById('tut-bubble');
    const stepsEl = document.getElementById('tut-steps');
    const nextBtn = document.getElementById('tut-next-btn');
    bubble.innerHTML = step.text.replace(/\n/g, '<br>');
    stepsEl.innerHTML = TUTORIAL_STEPS.map((_, i) => `<div class="tut-dot ${i===tutStep?'active':''}"></div>`).join('');
    nextBtn.textContent = tutStep >= TUTORIAL_STEPS.length - 1 ? '🎮 Начать!' : 'Далее →';
}
function tutNext() {
    tutStep++;
    if (tutStep >= TUTORIAL_STEPS.length) {
        document.getElementById('tutorial-overlay').classList.add('hidden');
        tutStep = 0; return;
    }
    renderTutStep();
}

function calcOfflineProgress() {
    const lastSeen = parseInt(localStorage.getItem(`gt_lastseen_${USER.id}`) || '0');
    if (!lastSeen) return;
    const now = Date.now();
    const elapsedSec = Math.min((now - lastSeen) / 1000, 8 * 3600);
    if (elapsedSec < 30) return;

    const mineMax = getMineMax();
    const whMax = getWhMax();
    const minCap = getMinerCap();
    const minSpd = getMinerSpeed();
    const liftCap = getLiftCap();
    let gained = { normal: 0, silver: 0, gold: 0 };
    let offlineMinutes = Math.floor(elapsedSec / 60);

    gameState.mines.forEach(mine => {
        if (!mine.unlocked) return;
        const cycles = Math.floor(elapsedSec / minSpd);
        for (let c = 0; c < cycles; c++) {
            const add = Math.min(minCap, mineMax - mine.storageCurrent);
            if (add <= 0) break;
            for (let k = 0; k < add; k++) {
                const t2 = generateCoin(); gained[t2]++;
                gameState.coins[t2]++;
            }
            mine.storageCurrent = Math.min(mine.storageCurrent + add, mineMax);
        }
    });

    const liftCycles = Math.floor(elapsedSec / 6);
    for (let c = 0; c < liftCycles; c++) {
        const mine = getActiveMine();
        const space = whMax - getTotalWarehouse();
        const take = Math.min(liftCap, mine.storageCurrent, space);
        if (take <= 0) break;
        mine.storageCurrent -= take;
        const r = gameState.rates;
        gameState.warehouse.coins.normal = (gameState.warehouse.coins.normal||0) + Math.round(take * r.normal / 100);
        gameState.warehouse.coins.silver = (gameState.warehouse.coins.silver||0) + Math.round(take * r.silver / 100);
        gameState.warehouse.coins.gold   = (gameState.warehouse.coins.gold||0) + Math.max(0, take - Math.round(take * r.normal/100) - Math.round(take * r.silver/100));
        gameState.warehouse.current = getTotalWarehouse();
    }

    const totalGained = gained.normal + gained.silver + gained.gold;
    saveState();
    if (totalGained > 0 || offlineMinutes > 1) {
        setTimeout(() => {
            showModal(`<div class="modal-title">💤 ПОКА ВАС НЕ БЫЛО</div>
                <div class="modal-section" style="text-align:center">
                    <div style="font-size:40px;margin-bottom:10px">⛏️</div>
                    <div style="font-family:var(--font);color:rgba(255,255,255,0.5);font-size:12px;margin-bottom:14px">Прошло: ${offlineMinutes} мин</div>
                    ${totalGained > 0 ? `<div style="display:flex;justify-content:center;gap:18px;font-size:18px;font-weight:900;font-family:var(--font)">
                        ${gained.normal > 0 ? `<span>🪙 +${gained.normal}</span>` : ''}
                        ${gained.silver > 0 ? `<span>🥈 +${gained.silver}</span>` : ''}
                        ${gained.gold > 0 ? `<span>🏅 +${gained.gold}</span>` : ''}
                    </div>` : `<div style="font-family:var(--font);color:rgba(255,255,255,0.3);font-size:12px">Шахтёры работали!</div>`}
                </div>
                <button class="modal-btn green" onclick="closeModal()">Забрать!</button>`);
        }, 1200);
    }
}

function saveLastSeen() {
    localStorage.setItem(`gt_lastseen_${USER.id}`, Date.now().toString());
    saveState();
}

function buildAdminEconomySection() {
    const cfg      = getAdminSettings();
    const refReward = cfg.refReward || { type:'silver', amount:1 };
    const upgMult   = cfg.upgradeMultiplier || 1.0;
    const COSTS     = [0,500,1200,2500,5000,9000,15000,24000,38000,60000];
    let mineCostRows = '';
    for (let i = 1; i < MAX_MINES; i++) {
        const cur = (cfg.mineCosts && cfg.mineCosts[i]) || COSTS[i];
        mineCostRows += `<div class="admin-row"><label>Шахта ${i+1}:</label><input type="number" id="adm-mine-cost-${i}" value="${cur}"></div>`;
    }
    return `
    <div class="admin-section">
        <h3 style="display:flex;justify-content:space-between;align-items:center">
            📊 Статистика сервера
            <button class="admin-btn" style="padding:4px 10px;font-size:10px;margin:0" onclick="adminLoadStats()">🔄</button>
        </h3>
        <div id="adm-global-stats" style="margin-top:8px">
            <div style="color:rgba(255,255,255,0.2);font-size:10px;font-family:var(--font)">Нажми 🔄 для загрузки</div>
        </div>
    </div>
    <div class="admin-section">
        <h3>👥 Награда за реферала</h3>
        <div class="admin-row"><label>Тип монеты:</label>
            <select id="adm-ref-type" style="background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;padding:7px;color:#fff;font-family:var(--font)">
                <option value="normal" ${refReward.type==='normal'?'selected':''}>🪙 Обычная</option>
                <option value="silver" ${refReward.type==='silver'?'selected':''}>🥈 Серебро</option>
                <option value="gold"   ${refReward.type==='gold'  ?'selected':''}>🏅 Золото</option>
            </select>
        </div>
        <div class="admin-row"><label>Количество:</label><input type="number" id="adm-ref-amount" value="${refReward.amount}"></div>
        <button class="admin-btn" onclick="adminSaveEconomy()">💾 Сохранить</button>
    </div>
    <div class="admin-section">
        <h3>🔧 Множитель цен улучшений</h3>
        <div class="admin-row"><label>Множитель ×:</label><input type="number" id="adm-upg-mult" value="${upgMult}" step="0.1" min="0.1" max="10"></div>
        <button class="admin-btn" onclick="adminSaveEconomy()">💾 Применить</button>
    </div>
    <div class="admin-section">
        <h3>💰 Цены на шахты</h3>
        ${mineCostRows}
        <button class="admin-btn" onclick="adminSaveEconomy()">💾 Сохранить цены</button>
    </div>
    <div class="admin-section">
        <h3>🎫 Создать промокод</h3>
        <div class="admin-row"><label>Код:</label><input type="text" id="adm-promo-code" placeholder="PROMO2025" style="text-transform:uppercase;width:140px"></div>
        <div class="admin-row"><label>Активаций:</label><input type="number" id="adm-promo-uses" value="1" min="1"></div>
        <div class="admin-row"><label>🪙 Монеты:</label><input type="number" id="adm-promo-normal" value="0" min="0"></div>
        <div class="admin-row"><label>🥈 Серебро:</label><input type="number" id="adm-promo-silver" value="0" min="0"></div>
        <div class="admin-row"><label>🏅 Золото:</label><input type="number" id="adm-promo-gold" value="0" min="0"></div>
        <button class="admin-btn" onclick="adminCreatePromo()">➕ Создать промокод</button>
    </div>
    <div class="admin-section">
        <h3 style="display:flex;justify-content:space-between;align-items:center">
            📋 Список промокодов
            <button class="admin-btn" style="padding:4px 10px;font-size:10px;margin:0" onclick="adminLoadPromoList()">🔄</button>
        </h3>
        <div id="adm-promo-list" style="margin-top:8px">
            <div style="color:rgba(255,255,255,0.2);font-size:10px;font-family:var(--font)">Нажми 🔄 для загрузки</div>
        </div>
    </div>`;
}

function init() {
    if (gameState.warehouse && !gameState.warehouse.coins) {
        gameState.warehouse.coins = { normal: 0, silver: 0, gold: 0 };
    }
    if (!gameState.upgradeLevels.warehouseCap) gameState.upgradeLevels.warehouseCap = 1;
    if (!gameState.dailyStreak) gameState.dailyStreak = { streak: 0, lastClaim: 0, goldDropBonus: 0, incomeBonus: 0 };

    gameState.mines = gameState.mines.map(m => {
        const nm = Object.assign({}, m);
        delete nm.hasManager;
        return nm;
    });

    initMinerAnims();
    calcOfflineProgress();

    window.addEventListener('beforeunload', saveLastSeen);
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) saveLastSeen();
        else calcOfflineProgress();
    });

    const bar = document.getElementById('load-bar');
    let progress = 0;
    const loadInterval = setInterval(() => {
        progress += Math.random() * 22;
        bar.style.width = Math.min(progress, 95) + '%';
        if (progress >= 95) clearInterval(loadInterval);
    }, 120);

    window.addEventListener('resize', resizeCanvas);

    setTimeout(() => {
        bar.style.width = '100%';
        setTimeout(() => {
            document.getElementById('loading-screen').style.display = 'none';
            document.getElementById('app').classList.remove('hidden');
            resizeCanvas();
            updateHUD();
            updateProfileScreen();
            renderForgeSlots();

            if (isAdmin()) {
                const nav = document.getElementById('bottom-nav');
                const adminBtn = document.createElement('button');
                adminBtn.className = 'nav-btn';
                adminBtn.innerHTML = '<span class="nav-icon">🔐</span><span class="nav-label">АДМИН</span>';
                adminBtn.onclick = function() {
                    switchScreen('admin', adminBtn); playClickSound();
                    const placeholder = document.getElementById('adm-economy-section');
                    if (placeholder) {
                        placeholder.innerHTML = buildAdminEconomySection();
                    } else {
                        const adminWrap = document.querySelector('.admin-wrap');
                        if (adminWrap) {
                            const el = document.createElement('div');
                            el.id = 'adm-economy-section';
                            el.innerHTML = buildAdminEconomySection();
                            adminWrap.appendChild(el);
                        }
                    }
                    setTimeout(function(){ adminLoadStats(); adminLoadPromoList(); }, 300);
                };
                nav.appendChild(adminBtn);
            }

            if (isHappyHour()) {
                document.getElementById('happy-hour-badge').classList.remove('hidden');
            }

            requestAnimationFrame(gameTick);

            const isNew = !localStorage.getItem(`gt_v4_visited_${USER.id}`);
            if (isNew) {
                localStorage.setItem(`gt_v4_visited_${USER.id}`, '1');
                setTimeout(() => showTutorial(), 800);
            }
        }, 500);
    }, 1800);
}

init();
