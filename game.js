const tg = window.Telegram?.WebApp;
if (tg) { tg.expand(); tg.setHeaderColor('#060e06'); tg.setBackgroundColor('#060e06'); }

const USER = {
    id: tg?.initDataUnsafe?.user?.id || 'demo',
    name: tg?.initDataUnsafe?.user?.first_name || 'Игрок',
    username: tg?.initDataUnsafe?.user?.username || ''
};
const BOT_USERNAME = 'GiftsTycoonBot';
const API_BASE = '/api';

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
        managers: { miner: false, lift: false, train: false },
        referrals: 0
    };
}

function loadState() {
    try {
        const saved = localStorage.getItem(`gt_v2_${USER.id}`);
        if (saved) return Object.assign({}, defaultState(), JSON.parse(saved));
    } catch(e) {}
    return defaultState();
}

function saveState() {
    try { localStorage.setItem(`gt_v2_${USER.id}`, JSON.stringify(gameState)); } catch(e) {}
}

let gameState = loadState();

const UPGRADE_CONFIG = {
    minerSpeed:    { name: 'Скорость шахтёра', icon: '⚡', speedMult: [1,1.3,1.7,2.2,2.8,3.5,4.3,5.2,6.2,7.3], costs: [100,200,400,800,1600,3200,6400,12800,25600,0] },
    minerCap:      { name: 'Вместимость шахтёра', icon: '🎒', capAdd: [0,3,6,10,15,21,28,36,45,55], costs: [120,250,500,1000,2000,4000,8000,16000,32000,0] },
    liftSpeed:     { name: 'Скорость лифта', icon: '🚡', speedMult: [1,1.3,1.7,2.2,2.8,3.5,4.3,5.2,6.2,7.3], costs: [150,300,600,1200,2400,4800,9600,19200,38400,0] },
    liftCap:       { name: 'Вместимость лифта', icon: '📦', capAdd: [0,5,12,20,30,42,56,72,90,110], costs: [120,250,500,1000,2000,4000,8000,16000,32000,0] },
    mineStorageCap:{ name: 'Объём шахты', icon: '🏗️', capAdd: [0,25,60,110,175,255,350,460,585,725], costs: [80,160,320,640,1280,2560,5120,10240,20480,0] },
    warehouseCap:  { name: 'Объём хранилища', icon: '🏦', capAdd: [0,100,250,450,700,1000,1350,1750,2200,2700], costs: [100,200,400,800,1600,3200,6400,12800,25600,0] }
};
const MANAGER_CONFIG = {
    miner: { name: 'Менеджер шахтёра', icon: '👷', cost: 500, desc: 'Автоматизирует шахтёров' },
    lift:  { name: 'Менеджер лифта',   icon: '🧑‍💼', cost: 750, desc: 'Автоматизирует лифт' },
    train: { name: 'Менеджер поезда',  icon: '🚂', cost: 600, desc: 'Автоматизирует поезд' }
};
const MINE_UNLOCK_COSTS = [0, 2000, 8000, 25000];

const ADMIN_IDS = ['123456789'];
function isAdmin() { return ADMIN_IDS.includes(String(USER.id)); }

function getMinerSpeed() {
    const lvl = gameState.upgradeLevels.minerSpeed;
    let mult = UPGRADE_CONFIG.minerSpeed.speedMult[lvl-1];
    if (isHappyHour()) mult *= 1.5;
    return 180 / mult;
}
function getMinerCap()   { return 5 + UPGRADE_CONFIG.minerCap.capAdd[gameState.upgradeLevels.minerCap-1]; }
function getLiftSpeed()  { return 28 / UPGRADE_CONFIG.liftSpeed.speedMult[gameState.upgradeLevels.liftSpeed-1]; }
function getLiftCap()    { return 15 + UPGRADE_CONFIG.liftCap.capAdd[gameState.upgradeLevels.liftCap-1]; }
function getMineMax()    { return 50 + UPGRADE_CONFIG.mineStorageCap.capAdd[gameState.upgradeLevels.mineStorageCap-1]; }
function getWhMax()      { return 200 + UPGRADE_CONFIG.warehouseCap.capAdd[gameState.upgradeLevels.warehouseCap-1]; }
function isHappyHour()   { return gameState.happyHour.active && Date.now() < gameState.happyHour.endsAt; }
function getActiveMine() { return gameState.mines[gameState.activeMine] || gameState.mines[0]; }
function getTotalMineStorage() { return gameState.mines.reduce((s,m) => s + (m.unlocked ? m.storageCurrent : 0), 0); }
function getAllMinesStorageMax() { return gameState.mines.reduce((s,m) => s + (m.unlocked ? getMineMax() : 0), 0); }
function getTotalWarehouse() {
    const wh = gameState.warehouse.coins;
    return (wh.normal||0) + (wh.silver||0) + (wh.gold||0);
}

function generateCoin() {
    const r = Math.random() * 100;
    let rates = { ...gameState.rates };
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

function resizeCanvas() {
    W = canvas.width  = canvas.parentElement.clientWidth;
    H = canvas.height = canvas.parentElement.clientHeight;
}

const liftAnim = {
    y: 0, phase: 'idle', loadTimer: 0, unloadTimer: 0, carrying: 0,
    coinTypes: { normal:0, silver:0, gold:0 },
    manualTrigger: false
};

const trainAnim = {
    x: 1.0,
    phase: 'idle',
    loadTimer: 0,
    smokeIntensity: 0,
    smokeParticles: [],
    carrying: { normal:0, silver:0, gold:0 },
    manualTrigger: false
};

let minerAnims = [];
function initMinerAnims() {
    while (minerAnims.length < gameState.mines.length) {
        minerAnims.push({ posX: 0.15, phase: 'idle', timer: 0, swingAngle: 0, manualTrigger: false });
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

    const mineMax  = getMineMax();
    const whMax    = getWhMax();
    const minCap   = getMinerCap();
    const minSpd   = getMinerSpeed();
    const liftCap  = getLiftCap();

    initMinerAnims();
    const unlockedMines = gameState.mines.filter(m => m.unlocked);

    unlockedMines.forEach((mine, i) => {
        const anim = minerAnims[i] || (minerAnims[i] = { posX: 0.15, phase: 'idle', timer: 0, swingAngle: 0, manualTrigger: false });
        const hasManager = gameState.managers.miner;

        if (anim.phase === 'idle') {
            if (hasManager || anim.manualTrigger) {
                anim.manualTrigger = false;
                if (mine.storageCurrent < mineMax) {
                    anim.phase = 'goingToWall';
                }
            }
        } else if (anim.phase === 'goingToWall') {
            anim.posX = Math.max(0.02, anim.posX - dt * 0.6);
            if (anim.posX <= 0.05) {
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
            anim.posX = Math.min(0.15, anim.posX + dt * 0.4);
            if (anim.posX >= 0.14) {
                anim.phase = 'idle';
                anim.swingAngle = 0;
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
            const trainY = H * SURFACE_Y_PCT + 4;
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
    const hasManager = gameState.managers.lift;

    switch (liftAnim.phase) {
        case 'idle':
            if ((hasManager || liftAnim.manualTrigger) && mine.storageCurrent > 0 && getTotalWarehouse() < whMax) {
                liftAnim.manualTrigger = false;
                liftAnim.phase = 'descending';
                liftAnim.carrying = 0;
                liftAnim.coinTypes = { normal:0, silver:0, gold:0 };
            }
            break;
        case 'descending':
            liftAnim.y = Math.min(1, liftAnim.y + dt * DESCEND_SPEED);
            if (liftAnim.y >= 1) { liftAnim.phase = 'loading'; liftAnim.loadTimer = LOAD_TIME; }
            break;
        case 'loading': {
            liftAnim.loadTimer -= dt;
            if (liftAnim.loadTimer <= 0) {
                const space = whMax - getTotalWarehouse();
                const take  = Math.min(liftCap, mine.storageCurrent, space);
                mine.storageCurrent -= take;
                liftAnim.carrying = take;
                const r = gameState.rates;
                liftAnim.coinTypes.normal = Math.round(take * r.normal / 100);
                liftAnim.coinTypes.silver = Math.round(take * r.silver / 100);
                liftAnim.coinTypes.gold   = Math.max(0, take - liftAnim.coinTypes.normal - liftAnim.coinTypes.silver);
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
                const wh = gameState.warehouse.coins;
                wh.normal = (wh.normal||0) + liftAnim.coinTypes.normal;
                wh.silver = (wh.silver||0) + liftAnim.coinTypes.silver;
                wh.gold   = (wh.gold||0)   + liftAnim.coinTypes.gold;
                gameState.warehouse.current = getTotalWarehouse();
                if ((gameState.managers.train || trainAnim.manualTrigger) && trainAnim.phase === 'idle') {
                    trainAnim.phase = 'goingToLift';
                }
                liftAnim.carrying = 0;
                liftAnim.coinTypes = { normal:0, silver:0, gold:0 };
                liftAnim.phase = 'idle';
            }
            break;
        }
    }
}

function updateTrain(dt) {
    const TRAIN_SPEED = 0.45;
    const LOAD_TIME   = 1.5;
    const UNLOAD_TIME = 1.2;
    const hasManager = gameState.managers.train;

    switch (trainAnim.phase) {
        case 'idle':
            if ((hasManager || trainAnim.manualTrigger) && getTotalWarehouse() > 0) {
                trainAnim.manualTrigger = false;
                trainAnim.phase = 'goingToLift';
            }
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
                trainAnim.carrying.normal = wh.normal || 0;
                trainAnim.carrying.silver = wh.silver || 0;
                trainAnim.carrying.gold   = wh.gold   || 0;
                gameState.warehouse.coins = { normal:0, silver:0, gold:0 };
                gameState.warehouse.current = 0;
                trainAnim.smokeIntensity = 1.0;
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
                trainAnim.phase = 'idle';
                if ((hasManager || trainAnim.manualTrigger) && getTotalWarehouse() > 0) {
                    trainAnim.phase = 'goingToLift';
                }
            }
            break;
    }
}

const SURFACE_Y_PCT   = 0.52;
const LIFT_X_PCT      = 0.13;
const WAREHOUSE_X_PCT = 0.82;

function drawScene(t) {
    ctx.clearRect(0, 0, W, H);
    const sy = H * SURFACE_Y_PCT;

    const sky = ctx.createLinearGradient(0, 0, 0, sy);
    sky.addColorStop(0, '#0d2a4a'); sky.addColorStop(0.6, '#1a4a6e'); sky.addColorStop(1, '#265a7a');
    ctx.fillStyle = sky; ctx.fillRect(0, 0, W, sy);

    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (let i = 0; i < 25; i++) {
        const sx2 = (i * 137.5 % 1) * W;
        const sy2 = (i * 97.3 % 1) * sy * 0.7;
        const blink = 0.4 + Math.sin(t / 1000 + i) * 0.4;
        ctx.globalAlpha = blink;
        ctx.fillRect(sx2, sy2, 1.5, 1.5);
    }
    ctx.globalAlpha = 1;

    drawMoon(ctx, W * 0.88, H * 0.08, 18, t);
    drawCloud(ctx, W * 0.2 + Math.sin(t/9000)*8, H * 0.1, 40);
    drawCloud(ctx, W * 0.6 + Math.sin(t/7000)*6, H * 0.15, 28);

    ctx.fillStyle = '#1a3a1a';
    ctx.fillRect(0, sy - 14, W, 18);
    ctx.fillStyle = '#2d5a2d';
    ctx.fillRect(0, sy - 16, W, 5);
    drawGrass(ctx, W, sy);

    const ug = ctx.createLinearGradient(0, sy, 0, H);
    ug.addColorStop(0, '#2d1a08'); ug.addColorStop(0.4, '#1f1006'); ug.addColorStop(1, '#100804');
    ctx.fillStyle = ug;
    ctx.fillRect(0, sy, W, H - sy);

    ctx.fillStyle = 'rgba(0,0,0,0.12)';
    for (let i = 0; i < 18; i++) {
        const rx = (i * 137.5 % 1) * W;
        const ry = sy + (i * 97.3 % 1) * (H - sy);
        const rr = 5 + (i * 73.1 % 1) * 14;
        ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI*2); ctx.fill();
    }

    drawGems(ctx, W, sy, H, t);

    const unlockedMines = gameState.mines.filter(m => m.unlocked);
    const mineCount = unlockedMines.length;
    const cabinW = Math.min(110, (W * 0.55) / mineCount - 8);
    const cabinH = Math.min(70, (H - sy) * 0.45);
    const firstMineX = W * 0.34;
    const mineSpacing = mineCount > 1 ? (W * 0.55 - cabinW) / (mineCount - 1) : 0;

    for (let i = 0; i < mineCount; i++) {
        const mine = unlockedMines[i];
        const mx = firstMineX + i * (mineCount > 1 ? (W * 0.54 / (mineCount)) : 0);
        const cabinTop = sy + (H - sy) * 0.18;
        drawMinerCabin(ctx, mx, cabinTop, cabinW, cabinH, mine, i, t);
    }

    for (let i = 0; i < mineCount; i++) {
        const mx = firstMineX + i * (mineCount > 1 ? (W * 0.54 / mineCount) : 0);
        const pct = unlockedMines[i].storageCurrent / getMineMax();
        ctx.fillStyle = 'rgba(0,0,0,0.55)';
        roundRect(ctx, mx - 26, H * 0.72, 52, 10, 4); ctx.fill();
        ctx.fillStyle = pct > 0.8 ? '#f44336' : '#8BC34A';
        roundRect(ctx, mx - 24, H * 0.73, 48 * pct, 7, 3); ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.font = `7px 'Courier New'`; ctx.textAlign = 'center';
        ctx.fillText(`${unlockedMines[i].storageCurrent}/${getMineMax()}`, mx, H * 0.74);
    }

    const liftX = W * LIFT_X_PCT;
    const shaftTop = sy - 28;
    const shaftH = H * 0.72 - shaftTop;
    drawLiftShaft(ctx, liftX, shaftTop, shaftH, liftAnim.y, t);

    const trainTrackY = sy + 6;
    const trackX1 = liftX + 26;
    const trackX2 = W * WAREHOUSE_X_PCT - 28;
    drawTrainTrack(ctx, trackX1, trainTrackY, trackX2);

    const trainDrawX = trackX1 + (trackX2 - trackX1) * trainAnim.x;
    const isLoaded = trainAnim.smokeIntensity > 0.1;
    drawTrain(ctx, trainDrawX, trainTrackY - 20, t, isLoaded, trainAnim.phase);

    if (!gameState.managers.train) {
        drawClickHint(ctx, trainDrawX, trainTrackY - 38, '👆');
    }

    trainAnim.smokeParticles.forEach(p => {
        ctx.save(); ctx.globalAlpha = p.life * 0.6;
        ctx.fillStyle = `rgba(40,30,20,${p.life * 0.7})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI*2); ctx.fill();
        ctx.restore();
    });

    const whX = W * WAREHOUSE_X_PCT;
    drawWarehouse(ctx, whX, sy - 80, t);

    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    roundRect(ctx, liftX - 24, sy - 50, 48, 16, 6); ctx.fill();
    ctx.fillStyle = '#8BC34A'; ctx.font = `bold 8px 'Courier New', monospace`;
    ctx.textAlign = 'center';
    ctx.fillText(`ЛИФТ Lv${gameState.upgradeLevels.liftSpeed}`, liftX, sy - 38);

    if (!gameState.managers.lift) {
        drawClickHint(ctx, liftX, sy - 60, '👆');
    }

    particles.forEach(p => {
        ctx.save(); ctx.globalAlpha = p.alpha;
        ctx.font = '16px serif'; ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
    });
}

function drawClickHint(ctx, x, y, icon) {
    ctx.save();
    ctx.font = '11px serif'; ctx.textAlign = 'center'; ctx.globalAlpha = 0.7;
    ctx.fillText(icon, x, y);
    ctx.restore();
}

function drawMinerCabin(ctx, cx, topY, cw, ch, mine, mineIdx, t) {
    const anim = minerAnims[mineIdx];
    if (!anim) return;

    const x1 = cx - cw / 2;
    const roomH = ch;

    const bg = ctx.createLinearGradient(x1, topY, x1 + cw, topY + roomH);
    bg.addColorStop(0, '#1a0f05');
    bg.addColorStop(1, '#0d0804');
    ctx.fillStyle = bg;
    roundRect(ctx, x1, topY, cw, roomH, 6); ctx.fill();

    ctx.strokeStyle = anim.phase === 'mining' ? 'rgba(139,195,74,0.6)' : 'rgba(80,120,80,0.5)';
    ctx.lineWidth = 2;
    roundRect(ctx, x1, topY, cw, roomH, 6); ctx.stroke();

    ctx.fillStyle = '#332211';
    ctx.fillRect(x1 + 4, topY + roomH - 6, cw - 8, 6);

    const torchGlow = 0.5 + Math.sin(t/600) * 0.15;
    ctx.save(); ctx.globalAlpha = torchGlow;
    ctx.fillStyle = '#FF8C00';
    ctx.beginPath(); ctx.arc(x1 + 10, topY + 10, 5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x1 + cw - 10, topY + 10, 5, 0, Math.PI*2); ctx.fill();
    ctx.restore();

    const minerRelX = anim.posX;
    const minerAbsX = x1 + 10 + minerRelX * (cw - 20);
    const minerY = topY + roomH - 8;

    if (anim.phase === 'mining') {
        ctx.save();
        const dustAlpha = 0.5 + Math.sin(t/100) * 0.3;
        ctx.globalAlpha = dustAlpha * 0.4;
        ctx.fillStyle = '#8a6a3a';
        ctx.beginPath(); ctx.arc(x1 + 8, minerY - 20, 10, 0, Math.PI*2); ctx.fill();
        ctx.restore();
    }

    drawMinerFigure(ctx, minerAbsX, minerY, t, anim, mine.storageCurrent > 0);

    const hasManager = gameState.managers.miner;
    if (hasManager) {
        const mgrX = cx + cw * 0.2;
        const mgrY = minerY;
        ctx.save();
        ctx.font = '16px serif'; ctx.textAlign = 'center';
        ctx.globalAlpha = 0.85;
        ctx.fillText('👔', mgrX, mgrY - 12);
        ctx.globalAlpha = 0.6; ctx.font = `6px 'Courier New'`;
        ctx.fillStyle = '#CE93D8'; ctx.fillText('MGR', mgrX, mgrY - 3);
        ctx.restore();
    } else {
        const btnX = cx + cw * 0.2;
        const btnY = topY + roomH * 0.4;
        ctx.save();
        ctx.fillStyle = 'rgba(74,20,140,0.6)';
        ctx.strokeStyle = 'rgba(206,147,216,0.5)';
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(btnX, btnY, 10, 0, Math.PI*2); ctx.fill(); ctx.stroke();
        ctx.fillStyle = '#CE93D8'; ctx.font = `bold 12px 'Courier New'`;
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText('+', btnX, btnY);
        ctx.textBaseline = 'alphabetic';
        ctx.restore();
    }

    ctx.fillStyle = '#8BC34A'; ctx.font = `bold 7px 'Courier New'`;
    ctx.textAlign = 'center';
    ctx.fillText(`ШАХТА ${mineIdx+1}`, cx, topY - 4);
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
    const sw = 30;
    ctx.fillStyle = '#1a1a1a';
    ctx.fillRect(x - sw/2, topY, sw, height + 50);
    ctx.strokeStyle = '#3a4a3a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x-8,topY); ctx.lineTo(x-8,topY+height+50); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x+8,topY); ctx.lineTo(x+8,topY+height+50); ctx.stroke();
    ctx.lineWidth = 1; ctx.strokeStyle = '#2a3a2a';
    for (let ry = topY; ry < topY+height+50; ry += 18) {
        ctx.beginPath(); ctx.moveTo(x-8,ry); ctx.lineTo(x+8,ry); ctx.stroke();
    }

    const cabinY = topY + 10 + animY * (height - 20);
    const cabinH = 26; const cabinW = 26;

    ctx.strokeStyle = '#555'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x,topY); ctx.lineTo(x,cabinY); ctx.stroke();

    if (liftAnim.phase === 'loading' || liftAnim.phase === 'unloading') {
        ctx.save();
        ctx.shadowBlur = 12; ctx.shadowColor = '#8BC34A';
        ctx.fillStyle = 'rgba(100,200,100,0.2)';
        roundRect(ctx, x-cabinW/2-3, cabinY-3, cabinW+6, cabinH+6, 6);
        ctx.fill(); ctx.restore();
    }

    const cGrad = ctx.createLinearGradient(x-cabinW/2,cabinY,x+cabinW/2,cabinY+cabinH);
    cGrad.addColorStop(0,'#4a6a4a'); cGrad.addColorStop(1,'#2a4a2a');
    ctx.fillStyle = cGrad;
    roundRect(ctx, x-cabinW/2, cabinY, cabinW, cabinH, 4); ctx.fill();
    ctx.strokeStyle = '#6a9a6a'; ctx.lineWidth = 1;
    roundRect(ctx, x-cabinW/2, cabinY, cabinW, cabinH, 4); ctx.stroke();

    if (liftAnim.carrying > 0) {
        ctx.fillStyle = '#FFD700'; ctx.font = `bold 7px 'Courier New'`;
        ctx.textAlign = 'center'; ctx.fillText(`×${liftAnim.carrying}`, x, cabinY + 14);
    } else {
        ctx.font = `12px serif`; ctx.textAlign = 'center';
        ctx.fillText('🧑‍💼', x, cabinY + 16);
    }

    ctx.fillStyle = '#2a4a2a'; ctx.fillRect(x-18, topY-10, 36, 14);
    ctx.fillStyle = '#3a6a3a'; ctx.fillRect(x-14, topY-14, 28, 8);
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
        ctx.fillStyle = `rgba(30,20,15,0.4)`;
        ctx.beginPath(); ctx.arc(x+34, y-31, 4, 0, Math.PI*2); ctx.fill();
    }
    ctx.restore();
}

function drawWarehouse(ctx, x, y, t) {
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    roundRect(ctx, x-32, y+4, 66, 90, 4); ctx.fill();
    const wbg = ctx.createLinearGradient(x-33,y,x+33,y+88);
    wbg.addColorStop(0,'#2a4a2a'); wbg.addColorStop(1,'#1a3a1a');
    ctx.fillStyle = wbg;
    roundRect(ctx, x-33, y, 66, 88, 4); ctx.fill();
    ctx.strokeStyle = '#3a6a3a'; ctx.lineWidth = 1;
    roundRect(ctx, x-33, y, 66, 88, 4); ctx.stroke();
    ctx.fillStyle = '#4a7a4a';
    ctx.beginPath(); ctx.moveTo(x-38,y+4); ctx.lineTo(x,y-18); ctx.lineTo(x+38,y+4); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#5a8a5a'; ctx.lineWidth = 1.5; ctx.stroke();
    ctx.strokeStyle = '#6a9a6a'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x,y-18); ctx.lineTo(x,y); ctx.stroke();
    ctx.fillStyle = '#1a2a1a';
    roundRect(ctx, x-10, y+52, 20, 36, 3); ctx.fill();
    ctx.strokeStyle = '#3a5a3a'; ctx.lineWidth = 1;
    roundRect(ctx, x-10, y+52, 20, 36, 3); ctx.stroke();
    const glowA = 0.3 + Math.sin(t/2000)*0.1;
    ctx.fillStyle = '#1a3a5a'; ctx.fillRect(x-26, y+12, 16, 12); ctx.fillRect(x+10, y+12, 16, 12);
    ctx.fillStyle = `rgba(150,220,150,${glowA})`;
    ctx.fillRect(x-25, y+13, 14, 10); ctx.fillRect(x+11, y+13, 14, 10);
    ctx.fillStyle = '#FFD700'; ctx.font = `bold 7px 'Courier New', monospace`;
    ctx.textAlign = 'center'; ctx.fillText('СКЛАД', x, y+46);
    const fillPct = gameState.warehouse.current / getWhMax();
    const fillH = Math.floor(fillPct * 38);
    if (fillH > 0) {
        ctx.fillStyle = `rgba(76,175,80,${0.3 + fillPct * 0.5})`;
        roundRect(ctx, x-28, y+32+(38-fillH), 56, fillH, 2); ctx.fill();
    }
    ctx.fillStyle = '#CCFF90'; ctx.font = `bold 9px 'Courier New', monospace`;
    ctx.fillText(formatNum(getTotalWarehouse()), x, y+58);
    ctx.restore();
}

let audioCtx = null;
let bgMelodyInterval = null;
let bgGainNode = null;
let musicEnabled = false;

function initAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); } catch(e) {}
}

function playClickSound() {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
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
            const osc = audioCtx.createOscillator();
            const gain = audioCtx.createGain();
            osc.connect(gain); gain.connect(audioCtx.destination);
            osc.frequency.value = freq;
            const start = audioCtx.currentTime + i * 0.1;
            gain.gain.setValueAtTime(0.2, start);
            gain.gain.exponentialRampToValueAtTime(0.001, start + 0.2);
            osc.start(start); osc.stop(start + 0.25);
        });
    } catch(e) {}
}

function playFailSound() {
    if (!audioCtx) return;
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sawtooth';
        osc.connect(gain); gain.connect(audioCtx.destination);
        osc.frequency.setValueAtTime(200, audioCtx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(80, audioCtx.currentTime + 0.3);
        gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
        osc.start(); osc.stop(audioCtx.currentTime + 0.35);
    } catch(e) {}
}

function startBgMelody() {
    if (!audioCtx || bgMelodyInterval) return;
    bgGainNode = audioCtx.createGain();
    bgGainNode.gain.value = 0.06;
    bgGainNode.connect(audioCtx.destination);
    const melody = [523,659,784,659,523,587,523,0,659,784,880,784,659,698,659,0,523,587,659,784,659,587,523,0];
    let noteIdx = 0;
    let time = audioCtx.currentTime;
    function scheduleNotes() {
        while (time < audioCtx.currentTime + 0.5) {
            const freq = melody[noteIdx % melody.length];
            if (freq > 0) {
                const osc = audioCtx.createOscillator();
                osc.type = 'sine'; osc.frequency.value = freq;
                osc.connect(bgGainNode);
                osc.start(time); osc.stop(time + 0.18);
            }
            time += 0.2; noteIdx++;
        }
    }
    bgMelodyInterval = setInterval(scheduleNotes, 300);
    scheduleNotes();
}

function stopBgMelody() {
    if (bgMelodyInterval) { clearInterval(bgMelodyInterval); bgMelodyInterval = null; }
    if (bgGainNode) { try { bgGainNode.gain.value = 0; } catch(e){} bgGainNode = null; }
}

function toggleMusic() {
    initAudio();
    musicEnabled = !musicEnabled;
    const btn = document.getElementById('music-toggle-btn');
    if (musicEnabled) {
        const bgAudio = document.getElementById('bg-music');
        bgAudio.volume = 0.4;
        bgAudio.play().catch(() => startBgMelody());
        btn.textContent = '🔊'; showToast('🎵 Музыка включена');
    } else {
        document.getElementById('bg-music').pause();
        stopBgMelody();
        btn.textContent = '🔇'; showToast('🔇 Музыка выключена');
    }
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
    resultEl.className = filledCount >= 2 ? 'forge-result-cell has-result' : 'forge-result-cell';
    resultEl.textContent = filledCount >= 2 ? FORGE_RECIPES[forgeRecipe].outputIcon : '?';
}

function updateForgeUI() {
    const recipe = FORGE_RECIPES[forgeRecipe];
    const filledCount = forgeSlots.filter(Boolean).length;
    const totalInput = filledCount * recipe.inputPerSlot;
    const balance = gameState.coins[recipe.inputType];
    const chanceMap = {0:0,1:0,2:50,3:70,4:90};
    const chance = chanceMap[filledCount] || 0;
    document.getElementById('forge-chance').textContent = chance > 0 ? `${chance}%` : '—';
    document.getElementById('forge-bal-val').textContent = formatNum(balance);
    document.getElementById('forge-hint').textContent =
        filledCount === 0 ? 'Нажмите + чтобы добавить материалы (2–4 слота)' :
        filledCount === 1 ? 'Добавьте ещё минимум 1 слот' :
        `Нужно: ${totalInput} ${recipe.inputIcon}  |  Есть: ${balance}`;
    const canForge = filledCount >= 2 && balance >= totalInput;
    document.getElementById('forge-btn').disabled = !canForge;
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
    document.getElementById('hud-normal').textContent = formatNum(gameState.coins.normal);
    document.getElementById('hud-silver').textContent = formatNum(gameState.coins.silver);
    document.getElementById('hud-gold').textContent   = formatNum(gameState.coins.gold);

    const total = getTotalWarehouse();
    const max   = getWhMax();
    document.getElementById('hud-cur').textContent = total;
    document.getElementById('hud-max').textContent = max;
    const fillPct = Math.min(100, total / max * 100);
    document.getElementById('hud-sfill').style.width = fillPct + '%';

    document.getElementById('prof-normal').textContent = formatNum(gameState.coins.normal);
    document.getElementById('prof-silver').textContent = formatNum(gameState.coins.silver);
    document.getElementById('prof-gold').textContent   = formatNum(gameState.coins.gold);

    updateForgeUI();
    renderMineUnlockBar();
}

function renderMineUnlockBar() {
    const bar = document.getElementById('mine-unlock-bar');
    if (!bar) return;
    bar.innerHTML = '';
    const maxMines = 4;
    for (let i = 0; i < maxMines; i++) {
        const mine = gameState.mines[i];
        const btn = document.createElement('button');
        btn.className = 'mine-slot-btn';
        if (mine && mine.unlocked) {
            btn.className += ' active';
            btn.innerHTML = '⛏️';
            btn.title = `Шахта ${i+1}`;
            btn.onclick = () => { gameState.activeMine = i; saveState(); showToast(`Шахта ${i+1} выбрана`); };
        } else if (i === gameState.mines.length) {
            const cost = MINE_UNLOCK_COSTS[i] || 99999;
            btn.className += ' can-unlock';
            btn.innerHTML = '+';
            btn.title = `Открыть шахту ${i+1} — ${formatNum(cost)} 🪙`;
            btn.onclick = () => unlockMine(i);
        } else {
            btn.innerHTML = '🔒'; btn.title = `Шахта ${i+1}`;
        }
        bar.appendChild(btn);
    }
}

function unlockMine(idx) {
    const cost = MINE_UNLOCK_COSTS[idx];
    if (!cost) { showToast('Нет такой шахты'); return; }
    if (gameState.coins.normal < cost) { showToast(`Нужно ${formatNum(cost)} 🪙`); return; }
    gameState.coins.normal -= cost;
    gameState.mines.push({ id:idx, unlocked:true, storageCurrent:0, storageMax:50, level:1 });
    minerAnims.push({ posX:0.15, phase:'idle', timer:0, swingAngle:0, manualTrigger:false });
    saveState(); updateHUD();
    showToast(`⛏️ Шахта ${idx+1} открыта!`);
}

function switchScreen(screen, btn) {
    document.querySelectorAll('.screen').forEach(s => { s.classList.remove('active'); s.classList.add('hidden'); });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const target = document.getElementById(screen + '-screen');
    if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
    if (btn) btn.classList.add('active');
    closeUpgradePanel();
    if (screen === 'miners') loadLeaderboard('normal');
    if (screen === 'craft') { updateHUD(); renderForgeSlots(); }
    if (screen === 'profile') updateProfileScreen();
}

canvas.addEventListener('click', (e) => {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (W / rect.width);
    const cy = (e.clientY - rect.top)  * (H / rect.height);
    const sy = H * SURFACE_Y_PCT;
    const liftX = W * LIFT_X_PCT;
    const whX   = W * WAREHOUSE_X_PCT;

    const unlockedMines = gameState.mines.filter(m => m.unlocked);
    const firstMineX = W * 0.34;
    for (let i = 0; i < unlockedMines.length; i++) {
        const mx = firstMineX + i * (unlockedMines.length > 1 ? (W * 0.54 / unlockedMines.length) : 0);
        const cabinTop = sy + (H - sy) * 0.18;
        const cabinW = Math.min(110, (W * 0.55) / unlockedMines.length - 8);
        const cabinH = Math.min(70, (H - sy) * 0.45);

        if (cx >= mx - cabinW/2 && cx <= mx + cabinW/2 && cy >= cabinTop && cy <= cabinTop + cabinH) {
            const mgrBtnX = mx + cabinW * 0.2;
            const mgrBtnY = cabinTop + cabinH * 0.4;
            const distToMgrBtn = Math.hypot(cx - mgrBtnX, cy - mgrBtnY);

            if (!gameState.managers.miner && distToMgrBtn < 16) {
                openUpgradePanel('miner');
            } else if (!gameState.managers.miner) {
                if (minerAnims[i] && minerAnims[i].phase === 'idle') {
                    minerAnims[i].manualTrigger = true;
                    showToast('⛏️ Один цикл добычи!');
                }
            } else {
                openUpgradePanel('miner');
            }
            return;
        }
    }

    if (Math.abs(cx - liftX) < 35 && cy > sy - 60 && cy < sy + H * 0.3) {
        if (!gameState.managers.lift) {
            if (liftAnim.phase === 'idle') {
                liftAnim.manualTrigger = true;
                showToast('🚡 Один цикл лифта!');
            } else {
                openUpgradePanel('lift');
            }
        } else {
            openUpgradePanel('lift');
        }
        return;
    }

    const trackX1 = liftX + 26;
    const trackX2 = whX - 28;
    const trainDrawX = trackX1 + (trackX2 - trackX1) * trainAnim.x;
    if (Math.abs(cx - trainDrawX) < 50 && cy > sy - 20 && cy < sy + 40) {
        if (!gameState.managers.train) {
            if (trainAnim.phase === 'idle' && getTotalWarehouse() > 0) {
                trainAnim.manualTrigger = true;
                showToast('🚂 Один рейс поезда!');
            } else if (trainAnim.phase === 'idle') {
                showToast('Нет груза для перевозки!');
            } else {
                openUpgradePanel('train');
            }
        } else {
            openUpgradePanel('train');
        }
        return;
    }

    if (Math.abs(cx - whX) < 55 && cy < sy + 10) {
        openUpgradePanel('warehouse');
        return;
    }
});

let currentUpgradeTarget = null;

function openUpgradePanel(target) {
    currentUpgradeTarget = target;
    const panel   = document.getElementById('upgrade-panel');
    const content = document.getElementById('upgrade-content');
    const title   = document.getElementById('upgrade-title');
    panel.classList.remove('hidden');
    const mult = isHappyHour() ? 0.95 : 1.0;
    if (target === 'miner') {
        title.textContent = '⛏️ ШАХТЁР';
        content.innerHTML = buildUpgradeHTML(['minerSpeed','minerCap'], mult) + buildManagerHTML('miner');
    } else if (target === 'lift') {
        title.textContent = '🚡 ЛИФТ';
        content.innerHTML = buildUpgradeHTML(['liftSpeed','liftCap'], mult) + buildManagerHTML('lift');
    } else if (target === 'train') {
        title.textContent = '🚂 ПОЕЗД';
        content.innerHTML = buildManagerHTML('train');
    } else if (target === 'warehouse') {
        title.textContent = '🏦 ХРАНИЛИЩЕ';
        content.innerHTML = buildUpgradeHTML(['mineStorageCap','warehouseCap'], mult);
    }
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

function buildManagerHTML(type) {
    const cfg   = MANAGER_CONFIG[type];
    const owned = gameState.managers[type];
    const cost  = Math.ceil(cfg.cost * (isHappyHour() ? 0.95 : 1.0));
    const canAfford = !owned && gameState.coins.normal >= cost;
    return `<div class="upgrade-section">
        <div class="upgrade-section-title">👔 МЕНЕДЖЕР</div>
        <div class="upgrade-item" style="flex-direction:column;align-items:flex-start;gap:7px">
            <div class="upgrade-item-name">${cfg.icon} ${cfg.name}</div>
            <div class="upgrade-item-desc">${cfg.desc}</div>
            <button class="manager-buy-btn ${owned?'owned':''}" onclick="buyManager('${type}')">
                ${owned ? '✅ НАНЯТ' : `НАНЯТЬ — ${formatNum(cost)} 🪙`}
            </button>
        </div>
    </div>`;
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
    saveState(); openUpgradePanel(currentUpgradeTarget); updateHUD();
    showToast(`${cfg.name} → Lv.${gameState.upgradeLevels[key]}!`);
}

function buyManager(type) {
    if (gameState.managers[type]) { showToast('Менеджер уже нанят!'); return; }
    const cfg  = MANAGER_CONFIG[type];
    const cost = Math.ceil(cfg.cost * (isHappyHour() ? 0.95 : 1.0));
    if (gameState.coins.normal < cost) { showToast('Недостаточно монет!'); return; }
    gameState.coins.normal -= cost;
    gameState.managers[type] = true;
    saveState(); openUpgradePanel(currentUpgradeTarget);
    showToast(`${cfg.name} нанят!`);
}

function updateProfileScreen() {
    document.getElementById('profile-name').textContent = USER.name;
    document.getElementById('profile-id').textContent   = `ID: ${USER.id}`;
    document.getElementById('ref-link').textContent = `https://t.me/${BOT_USERNAME}?start=${USER.id}`;
    document.getElementById('ref-count').textContent  = gameState.referrals || 0;
    updateHUD();
    fetch(`${API_BASE}/referrals?user_id=${USER.id}&init_data=${encodeURIComponent(tg?.initData||'')}`)
        .then(r => r.json())
        .then(d => {
            if (d.count !== undefined) {
                gameState.referrals = d.count;
                document.getElementById('ref-count').textContent = d.count;
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
            <div class="modal-label">Баланс: <b style="color:#CCFF90">${formatNum(gameState.coins.silver)}</b> | 1 = ${gameState.exchangeRates.silver} TON</div>
            <input class="modal-input" type="number" id="ex-silver-amt" placeholder="0" min="100">
            <div class="modal-info" id="ex-silver-info">≈ 0 TON</div>
        </div>
        <div class="modal-section">
            <div class="modal-label">🏅 ЗОЛОТЫЕ (мин. 100)</div>
            <div class="modal-label">Баланс: <b style="color:#CCFF90">${formatNum(gameState.coins.gold)}</b> | 1 = ${gameState.exchangeRates.gold} TON</div>
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
            <div class="stars-presets" style="display:flex;gap:7px;margin-bottom:10px">
                <button class="modal-btn blue" style="padding:8px 4px;font-size:11px" onclick="document.getElementById('dep-stars').value=100;updateDepInfo()">100⭐</button>
                <button class="modal-btn blue" style="padding:8px 4px;font-size:11px" onclick="document.getElementById('dep-stars').value=250;updateDepInfo()">250⭐</button>
                <button class="modal-btn blue" style="padding:8px 4px;font-size:11px" onclick="document.getElementById('dep-stars').value=500;updateDepInfo()">500⭐</button>
                <button class="modal-btn blue" style="padding:8px 4px;font-size:11px" onclick="document.getElementById('dep-stars').value=1000;updateDepInfo()">1000⭐</button>
            </div>
            <input class="modal-input" type="number" id="dep-stars" placeholder="100" min="100">
            <div class="modal-info" id="dep-stars-info">100 ⭐ → 1000 🪙 + 100 🥈</div>
        </div>
        <div class="modal-section" style="background:rgba(255,215,0,0.06);border-radius:8px;padding:10px;border:1px solid rgba(255,215,0,0.2)">
            <div style="font-family:var(--font);font-size:11px;color:#FFD700;letter-spacing:1px">КОНВЕРТАЦИЯ</div>
            <div style="font-size:11px;color:rgba(255,255,255,0.5);margin-top:4px;font-family:var(--font);line-height:1.6">
                70% → 🪙 Обычные монеты<br>
                30% → 🥈 Серебряные монеты
            </div>
        </div>
        <button class="modal-btn blue" onclick="confirmDepositStars()">⭐ Оплатить через Telegram</button>
        <button class="modal-cancel" onclick="closeModal()">Отмена</button>`);
    document.getElementById('dep-stars').addEventListener('input', updateDepInfo);
}

function updateDepInfo() {
    const el = document.getElementById('dep-stars');
    if (!el) return;
    const v = +el.value || 0;
    const n = Math.floor(v * 10);
    const s = Math.floor(v);
    const info = document.getElementById('dep-stars-info');
    if (info) info.textContent = `${v} ⭐ → ${n} 🪙 + ${s} 🥈`;
}

async function confirmDepositStars() {
    const amt = parseInt(document.getElementById('dep-stars').value)||0;
    if (amt < 100) { showToast('Минимум 100 Stars!'); return; }
    closeModal();

    if (tg) {
        showToast('⏳ Создание счёта...');
        try {
            const res = await fetch(`${API_BASE}/create-stars-invoice`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ user_id: USER.id, stars: amt, init_data: tg.initData })
            });
            const data = await res.json();
            if (data.invoice_url) {
                tg.openInvoice(data.invoice_url, (status) => {
                    if (status === 'paid') {
                        const normalGain = Math.floor(amt * 10);
                        const silverGain = Math.floor(amt);
                        gameState.coins.normal += normalGain;
                        gameState.coins.silver += silverGain;
                        saveState(); updateHUD();
                        showToast(`✅ +${normalGain}🪙 +${silverGain}🥈 зачислено!`);
                    } else if (status === 'cancelled') {
                        showToast('Оплата отменена');
                    } else if (status === 'failed') {
                        showToast('❌ Ошибка оплаты');
                    }
                });
            } else {
                throw new Error(data.error || 'no url');
            }
        } catch(e) {
            showToast('❌ Ошибка создания счёта. Попробуйте позже.');
        }
    } else {
        const normalGain = Math.floor(amt * 10);
        const silverGain = Math.floor(amt);
        gameState.coins.normal += normalGain;
        gameState.coins.silver += silverGain;
        saveState(); updateHUD();
        showToast(`✅ +${normalGain}🪙 +${silverGain}🥈 (демо режим)`);
    }
}

function openWithdraw() {
    showModal(`<div class="modal-title">📤 ВЫВОД TON</div>
        <div class="modal-section">
            <div class="modal-label">Сначала обменяйте монеты на TON, затем выведите.</div>
            <div class="modal-label" style="margin-top:10px">TON адрес кошелька:</div>
            <input class="modal-input" type="text" id="withdraw-addr" placeholder="EQ... или UQ...">
            <div class="modal-label" style="margin-top:10px">Сумма (мин. 1 TON):</div>
            <input class="modal-input" type="number" id="withdraw-amt" placeholder="1.0" min="1" step="0.1">
        </div>
        <button class="modal-btn orange" onclick="doWithdraw()">Вывести</button>
        <button class="modal-cancel" onclick="closeModal()">Отмена</button>`);
}

function doWithdraw() {
    const addr = document.getElementById('withdraw-addr').value.trim();
    const amt  = parseFloat(document.getElementById('withdraw-amt').value)||0;
    if (!addr || addr.length < 20) { showToast('Введите корректный адрес!'); return; }
    if (amt < 1) { showToast('Минимум 1 TON!'); return; }
    closeModal();
    showToast('📤 Заявка отправлена! Обработка до 24ч.');
    fetch(`${API_BASE}/withdraw`, { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ user_id:USER.id, address:addr, amount:amt, init_data:tg?.initData }) }).catch(()=>{});
}

function adminSaveRates() {
    const n = parseFloat(document.getElementById('adm-normal-pct').value)||70;
    const s = parseFloat(document.getElementById('adm-silver-pct').value)||25;
    const g = parseFloat(document.getElementById('adm-gold-pct').value)||5;
    if (Math.abs(n+s+g-100) > 1) { showToast('Сумма должна = 100%!'); return; }
    gameState.rates = { normal:n, silver:s, gold:g };
    const sr = parseFloat(document.getElementById('adm-silver-rate').value)||0.001;
    const gr = parseFloat(document.getElementById('adm-gold-rate').value)||0.005;
    gameState.exchangeRates = { silver:sr, gold:gr };
    saveState(); showToast('✅ Настройки сохранены!');
}

function adminStartHappyHour() {
    const dur = parseInt(document.getElementById('adm-happy-duration').value)||60;
    gameState.happyHour = { active:true, endsAt: Date.now() + dur*60000 };
    saveState();
    document.getElementById('happy-hour-badge').classList.remove('hidden');
    document.getElementById('happy-status').textContent = `⚡ Активен! Осталось: ${dur} мин`;
    showToast('⚡ Счастливый час запущен!');
}

function adminLookupUser() {
    const uid = document.getElementById('adm-user-id').value.trim();
    if (!uid) { showToast('Введите ID!'); return; }
    document.getElementById('adm-user-info').classList.remove('hidden');
    document.getElementById('adm-user-name').textContent = `Пользователь: ${uid}`;
}

function adminGiveCoins() {
    const n=parseInt(document.getElementById('adm-give-normal').value)||0;
    const s=parseInt(document.getElementById('adm-give-silver').value)||0;
    const g=parseInt(document.getElementById('adm-give-gold').value)||0;
    const uid=document.getElementById('adm-user-id').value.trim();
    fetch(`${API_BASE}/admin/give`, { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ admin_id:USER.id, target_id:uid, normal:n, silver:s, gold:g, init_data:tg?.initData }) }).catch(()=>{});
    showToast(`✅ Начислено: ${n}🪙 ${s}🥈 ${g}🏅`);
}

function adminRemoveCoins() {
    const n=parseInt(document.getElementById('adm-give-normal').value)||0;
    const s=parseInt(document.getElementById('adm-give-silver').value)||0;
    const g=parseInt(document.getElementById('adm-give-gold').value)||0;
    const uid=document.getElementById('adm-user-id').value.trim();
    fetch(`${API_BASE}/admin/remove`, { method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({ admin_id:USER.id, target_id:uid, normal:n, silver:s, gold:g, init_data:tg?.initData }) }).catch(()=>{});
    showToast(`✅ Списано: ${n}🪙 ${s}🥈 ${g}🏅`);
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
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
    if (n >= 1000)    return (n/1000).toFixed(1) + 'K';
    return Math.floor(n).toString();
}

const TUTORIAL_STEPS = [
    { text: 'Привет! Я твой шахтёр! 👷\n\nДобро пожаловать в GIFTS TYCOON!\nЗдесь ты строишь собственную шахту и добываешь монеты!' },
    { text: '⛏️ Нажимай на кабину шахтёра чтобы добывать монеты!\n\nКаждый клик — один цикл добычи.\nМонеты копятся в шахте!' },
    { text: '🚡 Лифт поднимает монеты наверх!\n\nНажимай на лифт для ручного управления.\nИли купи менеджера (значок +) для автоматизации!' },
    { text: '🚂 Поезд везёт монеты на склад!\n\nОн стоит у склада справа.\nНажимай на него чтобы отправить рейс!' },
    { text: '⚗️ В Кузнице можно плавить монеты!\n\n🪙 × 8 → 🥈 × 1\n🥈 × 4 → 🏅 × 1\n\nЖелаю удачи в шахте! ⛏️' }
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
    stepsEl.innerHTML = TUTORIAL_STEPS.map((_, i) =>
        `<div class="tut-dot ${i === tutStep ? 'active' : ''}"></div>`
    ).join('');
    nextBtn.textContent = tutStep >= TUTORIAL_STEPS.length - 1 ? '🎮 Начать!' : 'Далее →';
}

function tutNext() {
    tutStep++;
    if (tutStep >= TUTORIAL_STEPS.length) {
        document.getElementById('tutorial-overlay').classList.add('hidden');
        tutStep = 0;
        return;
    }
    renderTutStep();
}

function init() {
    if (gameState.warehouse && !gameState.warehouse.coins) {
        gameState.warehouse.coins = { normal:0, silver:0, gold:0 };
    }
    if (!gameState.managers.train) gameState.managers.train = false;

    initMinerAnims();

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
                adminBtn.onclick = function() { switchScreen('admin', adminBtn); playClickSound(); };
                nav.appendChild(adminBtn);
            }

            if (isHappyHour()) {
                document.getElementById('happy-hour-badge').classList.remove('hidden');
            }

            requestAnimationFrame(gameTick);

            const isNew = !localStorage.getItem(`gt_v2_visited_${USER.id}`);
            if (isNew) {
                localStorage.setItem(`gt_v2_visited_${USER.id}`, '1');
                setTimeout(() => showTutorial(), 800);
            }
        }, 500);
    }, 1800);
}

init();
