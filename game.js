const tg = window.Telegram?.WebApp;
if (tg) {
    tg.expand();
    tg.setHeaderColor('#1b5e20');
    tg.setBackgroundColor('#1b5e20');
}

const USER = {
    id: tg?.initDataUnsafe?.user?.id || 'demo',
    name: tg?.initDataUnsafe?.user?.first_name || 'Игрок',
    username: tg?.initDataUnsafe?.user?.username || ''
};

const BOT_USERNAME = 'GiftsTycoonBot';
const API_BASE = '/api';

let gameState = loadState();

function defaultState() {
    return {
        coins: { normal: 50, silver: 5, gold: 1 },
        warehouse: { current: 0, max: 200, level: 1 },
        miners: [
            { id: 0, level: 1, speed: 180, capacity: 5, x: 0.25, busy: false, carrying: 0, progress: 0, walking: false, walkDir: 1, walkX: 0 }
        ],
        lift: { level: 1, speed: 30, capacity: 15, busy: false, carrying: 0, progress: 0, going: 'up', position: 0 },
        train: { level: 1, speed: 20, busy: false, x: 0, progress: 0 },
        mineStorage: { current: 0, max: 50, level: 1 },
        managers: { miner: false, lift: false, warehouse: false },
        rates: { normal: 70, silver: 25, gold: 5 },
        exchangeRates: { silver: 0.001, gold: 0.005 },
        happyHour: { active: false, endsAt: 0 },
        stats: { totalNormal: 0, totalSilver: 0, totalGold: 0, tonEarned: 0 },
        upgradeLevels: { minerSpeed: 1, minerCap: 1, liftSpeed: 1, liftCap: 1, mineStorageCap: 1, warehouseCap: 1 }
    };
}

function loadState() {
    try {
        const saved = localStorage.getItem(`gt_state_${USER.id}`);
        if (saved) {
            const s = JSON.parse(saved);
            return Object.assign({}, defaultState(), s);
        }
    } catch(e) {}
    return defaultState();
}

function saveState() {
    try {
        localStorage.setItem(`gt_state_${USER.id}`, JSON.stringify(gameState));
    } catch(e) {}
}

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');
let W, H;

function resizeCanvas() {
    const parent = canvas.parentElement;
    W = canvas.width = parent.clientWidth;
    H = canvas.height = parent.clientHeight;
}

const MINE_ZONE_HEIGHT = 0.45;
const SURFACE_Y_PCT = 0.55;
const LIFT_X_PCT = 0.15;
const TRAIN_Y_PCT = 0.52;
const WAREHOUSE_X_PCT = 0.72;

const UPGRADE_CONFIG = {
    minerSpeed:    { name: 'Скорость шахтёра', icon: '⚡', levels: [1,2,3,4,5,6,7,8,9,10], speedMult: [1,1.3,1.7,2.2,2.8,3.5,4.3,5.2,6.2,7.3], costs: [100,200,400,800,1600,3200,6400,12800,25600,0] },
    minerCap:      { name: 'Вместимость шахтёра', icon: '🎒', levels: [1,2,3,4,5,6,7,8,9,10], capAdd: [0,3,6,10,15,21,28,36,45,55], costs: [120,250,500,1000,2000,4000,8000,16000,32000,0] },
    liftSpeed:     { name: 'Скорость лифта', icon: '🚡', levels: [1,2,3,4,5,6,7,8,9,10], speedMult: [1,1.3,1.7,2.2,2.8,3.5,4.3,5.2,6.2,7.3], costs: [150,300,600,1200,2400,4800,9600,19200,38400,0] },
    liftCap:       { name: 'Вместимость лифта', icon: '📦', levels: [1,2,3,4,5,6,7,8,9,10], capAdd: [0,5,12,20,30,42,56,72,90,110], costs: [120,250,500,1000,2000,4000,8000,16000,32000,0] },
    mineStorageCap:{ name: 'Объём склада шахты', icon: '🏗️', levels: [1,2,3,4,5,6,7,8,9,10], capAdd: [0,25,60,110,175,255,350,460,585,725], costs: [80,160,320,640,1280,2560,5120,10240,20480,0] },
    warehouseCap:  { name: 'Объём хранилища', icon: '🏦', levels: [1,2,3,4,5,6,7,8,9,10], capAdd: [0,100,250,450,700,1000,1350,1750,2200,2700], costs: [100,200,400,800,1600,3200,6400,12800,25600,0] }
};

const MANAGER_CONFIG = {
    miner:     { name: 'Менеджер шахтёра', icon: '👷', cost: 500, desc: 'Автоматизирует всех шахтёров' },
    lift:      { name: 'Менеджер лифта', icon: '🧑‍💼', cost: 750, desc: 'Автоматизирует лифт' },
    warehouse: { name: 'Менеджер склада', icon: '🧑‍', cost: 600, desc: 'Автоматизирует продажу монет' }
};

function getMinerSpeed() {
    const lvl = gameState.upgradeLevels.minerSpeed;
    let mult = UPGRADE_CONFIG.minerSpeed.speedMult[lvl-1];
    if (gameState.happyHour.active && Date.now() < gameState.happyHour.endsAt) mult *= 1.15;
    return 180 / mult;
}

function getMinerCapacity() {
    const lvl = gameState.upgradeLevels.minerCap;
    return 5 + UPGRADE_CONFIG.minerCap.capAdd[lvl-1];
}

function getLiftSpeed() {
    const lvl = gameState.upgradeLevels.liftSpeed;
    return 30 / UPGRADE_CONFIG.liftSpeed.speedMult[lvl-1];
}

function getLiftCapacity() {
    const lvl = gameState.upgradeLevels.liftCap;
    return 15 + UPGRADE_CONFIG.liftCap.capAdd[lvl-1];
}

function getMineStorageMax() {
    const lvl = gameState.upgradeLevels.mineStorageCap;
    return 50 + UPGRADE_CONFIG.mineStorageCap.capAdd[lvl-1];
}

function getWarehouseMax() {
    const lvl = gameState.upgradeLevels.warehouseCap;
    return 200 + UPGRADE_CONFIG.warehouseCap.capAdd[lvl-1];
}

function getUpgradeCostMultiplier() {
    if (gameState.happyHour.active && Date.now() < gameState.happyHour.endsAt) return 0.95;
    return 1.0;
}

function generateCoin() {
    const r = Math.random() * 100;
    let rates = { ...gameState.rates };
    if (gameState.happyHour.active && Date.now() < gameState.happyHour.endsAt) {
        rates.silver = Math.min(rates.silver + 10, 60);
        rates.gold = Math.min(rates.gold + 10, 30);
        rates.normal = 100 - rates.silver - rates.gold;
    }
    if (r < rates.gold) return 'gold';
    if (r < rates.gold + rates.silver) return 'silver';
    return 'normal';
}

const entities = {
    miners: [],
    lift: { x: 0, y: 0, carrying: 0 },
    train: { x: 0, y: 0, moving: false },
    particles: []
};

function spawnParticle(x, y, text) {
    entities.particles.push({ x, y, text, vx: (Math.random()-0.5)*2, vy: -2-Math.random(), life: 1, alpha: 1 });
}

let lastTime = 0;
let minerTimer = 0;
let liftTimer = 0;
let trainTimer = 0;
let autoSellTimer = 0;

function gameTick(timestamp) {
    const dt = Math.min((timestamp - lastTime) / 1000, 0.1);
    lastTime = timestamp;
    
    if (gameState.happyHour.active && Date.now() > gameState.happyHour.endsAt) {
        gameState.happyHour.active = false;
        document.getElementById('happy-hour-badge').classList.add('hidden');
    }
    
    const minerSpd = getMinerSpeed();
    const minerCap = getMinerCapacity();
    const mineMax = getMineStorageMax();
    const liftCap = getLiftCapacity();
    const liftSpd = getLiftSpeed();
    const whMax = getWarehouseMax();
    
    minerTimer += dt;
    const coinsPerCycle = minerCap;
    if (minerTimer >= minerSpd) {
        minerTimer -= minerSpd;
        if (gameState.mineStorage.current < mineMax) {
            const add = Math.min(coinsPerCycle, mineMax - gameState.mineStorage.current);
            for (let i=0; i<add; i++) {
                const type = generateCoin();
                gameState.coins[type] += 1;
                gameState.stats['total'+type.charAt(0).toUpperCase()+type.slice(1)] = (gameState.stats['total'+type.charAt(0).toUpperCase()+type.slice(1)]||0) + 1;
            }
            gameState.mineStorage.current = Math.min(gameState.mineStorage.current + add, mineMax);
            if (W && H) {
                const mx = W * 0.4 + Math.random()*W*0.3;
                const my = H * 0.8;
                spawnParticle(mx, my, '⛏️');
            }
        }
    }
    
    liftTimer += dt;
    if (liftTimer >= liftSpd) {
        liftTimer -= liftSpd;
        if (gameState.mineStorage.current > 0 && gameState.warehouse.current < whMax) {
            const move = Math.min(liftCap, gameState.mineStorage.current, whMax - gameState.warehouse.current);
            gameState.mineStorage.current -= move;
            gameState.warehouse.current += move;
            if (W && H) {
                spawnParticle(W * LIFT_X_PCT, H * 0.5, '📦');
            }
        }
    }
    
    if (gameState.managers.warehouse) {
        autoSellTimer += dt;
        if (autoSellTimer >= 60) {
            autoSellTimer = 0;
            if (gameState.warehouse.current >= 50) sellCoins(true);
        }
    }
    
    entities.particles = entities.particles.filter(p => {
        p.x += p.vx; p.y += p.vy; p.vy += 0.05;
        p.life -= dt; p.alpha = p.life;
        return p.life > 0;
    });
    
    updateHUD();
    
    if (Math.floor(timestamp/10000) !== Math.floor((timestamp-dt*1000)/10000)) {
        saveState();
    }
    
    if (W && H) drawScene(timestamp);
    requestAnimationFrame(gameTick);
}

function drawScene(t) {
    ctx.clearRect(0, 0, W, H);
    const surfaceY = H * SURFACE_Y_PCT;
    
    const sky = ctx.createLinearGradient(0, 0, 0, surfaceY);
    sky.addColorStop(0, '#64B5F6');
    sky.addColorStop(0.5, '#B3E5FC');
    sky.addColorStop(1, '#E1F5FE');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, W, surfaceY);
    
    drawCloud(ctx, W*0.2 + Math.sin(t/8000)*10, H*0.08, 50);
    drawCloud(ctx, W*0.7 + Math.sin(t/6000+1)*8, H*0.12, 35);
    drawCloud(ctx, W*0.5, H*0.05, 40);
    
    drawSun(ctx, W*0.85, H*0.07, 28, t);
    drawMountains(ctx, W, surfaceY);
    
    ctx.fillStyle = '#5DA845';
    ctx.fillRect(0, surfaceY - 16, W, 20);
    ctx.fillStyle = '#4CAF50';
    ctx.fillRect(0, surfaceY - 18, W, 6);
    
    drawGrass(ctx, W, surfaceY);
    
    const underGrad = ctx.createLinearGradient(0, surfaceY, 0, H);
    underGrad.addColorStop(0, '#8B6914');
    underGrad.addColorStop(0.4, '#6B4C10');
    underGrad.addColorStop(1, '#3E2208');
    ctx.fillStyle = underGrad;
    ctx.fillRect(0, surfaceY, W, H - surfaceY);
    
    ctx.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i=0; i<20; i++) {
        const rx = (i * 137.5 % 1) * W;
        const ry = surfaceY + (i * 97.3 % 1) * (H-surfaceY);
        const rr = 4 + (i * 73.1 % 1) * 12;
        ctx.beginPath(); ctx.arc(rx, ry, rr, 0, Math.PI*2); ctx.fill();
    }
    
    drawGems(ctx, W, surfaceY, H, t);
    
    const liftX = W * LIFT_X_PCT;
    drawLiftShaft(ctx, liftX, surfaceY - 30, H * 0.85 - surfaceY + 30, t);
    
    const numMiners = gameState.miners.length;
    for (let i=0; i<numMiners; i++) {
        const mx = W * (0.35 + i * 0.2);
        const my = H * 0.88;
        drawMiner(ctx, mx, my, t + i*500, gameState.mineStorage.current > 0);
    }
    
    if (gameState.mineStorage.current > 0) {
        const px = W * 0.5;
        const py = H * 0.78;
        drawMineActivity(ctx, px, py, t);
    }
    
    const trainY = surfaceY + 5;
    drawTrainTrack(ctx, liftX + 30, trainY, W * WAREHOUSE_X_PCT - 20);
    const trainProgress = (t / 3000) % 1;
    const trainX = liftX + 40 + (W * WAREHOUSE_X_PCT - liftX - 80) * trainProgress;
    drawTrain(ctx, trainX, trainY - 22, t);
    
    const whX = W * WAREHOUSE_X_PCT;
    drawWarehouse(ctx, whX, surfaceY - 80, t);
    
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, W*0.3, H*0.91, 120, 22, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold 11px Nunito`;
    ctx.textAlign = 'center';
    ctx.fillText(`Склад: ${gameState.mineStorage.current}/${getMineStorageMax()}`, W*0.39, H*0.923);
    
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    roundRect(ctx, liftX - 24, surfaceY - 50, 50, 18, 8);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = `bold 10px Nunito`;
    ctx.fillText(`Лифт Lv.${gameState.upgradeLevels.liftSpeed}`, liftX, surfaceY - 39);
    
    entities.particles.forEach(p => {
        ctx.save();
        ctx.globalAlpha = p.alpha;
        ctx.font = '18px serif';
        ctx.textAlign = 'center';
        ctx.fillText(p.text, p.x, p.y);
        ctx.restore();
    });
}

function drawCloud(ctx, x, y, r) {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI*2);
    ctx.arc(x+r*0.8, y+r*0.1, r*0.75, 0, Math.PI*2);
    ctx.arc(x-r*0.7, y+r*0.1, r*0.65, 0, Math.PI*2);
    ctx.fill();
    ctx.restore();
}

function drawSun(ctx, x, y, r, t) {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,230,50,0.5)';
    ctx.lineWidth = 3;
    const rayCount = 8;
    for (let i=0; i<rayCount; i++) {
        const angle = (i/rayCount)*Math.PI*2 + t/3000;
        const r1 = r + 8;
        const r2 = r + 18;
        ctx.beginPath();
        ctx.moveTo(x + Math.cos(angle)*r1, y + Math.sin(angle)*r1);
        ctx.lineTo(x + Math.cos(angle)*r2, y + Math.sin(angle)*r2);
        ctx.stroke();
    }
    const sg = ctx.createRadialGradient(x-5, y-5, 2, x, y, r);
    sg.addColorStop(0, '#FFF176');
    sg.addColorStop(1, '#FFA000');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI*2); ctx.fill();
    ctx.restore();
}

function drawMountains(ctx, W, surfaceY) {
    ctx.save();
    ctx.fillStyle = '#90A4AE';
    ctx.beginPath(); ctx.moveTo(0, surfaceY);
    ctx.lineTo(W*0.1, surfaceY*0.3);
    ctx.lineTo(W*0.25, surfaceY*0.6);
    ctx.lineTo(W*0.4, surfaceY*0.15);
    ctx.lineTo(W*0.6, surfaceY*0.5);
    ctx.lineTo(W*0.75, surfaceY*0.08);
    ctx.lineTo(W*0.9, surfaceY*0.45);
    ctx.lineTo(W, surfaceY);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#A5D6A7';
    ctx.beginPath(); ctx.moveTo(0, surfaceY);
    ctx.lineTo(W*0.05, surfaceY*0.7);
    ctx.lineTo(W*0.2, surfaceY*0.85);
    ctx.lineTo(W*0.35, surfaceY*0.55);
    ctx.lineTo(W*0.55, surfaceY*0.78);
    ctx.lineTo(W*0.7, surfaceY*0.48);
    ctx.lineTo(W*0.85, surfaceY*0.75);
    ctx.lineTo(W, surfaceY);
    ctx.closePath(); ctx.fill();
    ctx.restore();
}

function drawGrass(ctx, W, surfaceY) {
    ctx.save();
    ctx.fillStyle = '#81C784';
    for (let i=0; i<W; i+=15) {
        const h = 4 + Math.sin(i*0.3)*3;
        ctx.fillRect(i, surfaceY-18-h, 8, h+4);
    }
    const flowerPositions = [0.12, 0.28, 0.45, 0.6, 0.75, 0.88];
    flowerPositions.forEach(fx => {
        drawFlower(ctx, W*fx, surfaceY - 22);
    });
    ctx.restore();
}

function drawFlower(ctx, x, y) {
    ctx.save();
    ctx.fillStyle = '#4CAF50';
    ctx.fillRect(x-1, y, 2, 10);
    const colors = ['#FF6B9D', '#FFD700', '#FF8A65', '#AB47BC'];
    const c = colors[Math.floor(x/50) % colors.length];
    ctx.fillStyle = c;
    for (let i=0; i<5; i++) {
        const a = (i/5)*Math.PI*2;
        ctx.beginPath();
        ctx.ellipse(x+Math.cos(a)*5, y+Math.sin(a)*5, 4, 3, a, 0, Math.PI*2);
        ctx.fill();
    }
    ctx.fillStyle = '#FFF176';
    ctx.beginPath(); ctx.arc(x, y, 3, 0, Math.PI*2); ctx.fill();
    ctx.restore();
}

function drawGems(ctx, W, surfaceY, H, t) {
    const gemPositions = [
        {x:0.42, y:0.65, type:'normal'}, {x:0.6, y:0.75, type:'silver'},
        {x:0.35, y:0.82, type:'gold'}, {x:0.72, y:0.7, type:'normal'},
        {x:0.55, y:0.88, type:'silver'}
    ];
    gemPositions.forEach((g, i) => {
        const gx = W * g.x;
        const gy = surfaceY + (H - surfaceY) * (g.y - SURFACE_Y_PCT) * 2;
        const glow = 0.5 + Math.sin(t/1000 + i) * 0.3;
        const colors = { normal: '#FFD700', silver: '#E0E0E0', gold: '#FFA000' };
        ctx.save();
        ctx.globalAlpha = glow;
        ctx.fillStyle = colors[g.type];
        ctx.beginPath();
        for (let j=0; j<5; j++) {
            const a = (j/5)*Math.PI*2 - Math.PI/2;
            const r = j%2===0 ? 6 : 3;
            j===0 ? ctx.moveTo(gx+Math.cos(a)*r, gy+Math.sin(a)*r) : ctx.lineTo(gx+Math.cos(a)*r, gy+Math.sin(a)*r);
        }
        ctx.closePath(); ctx.fill();
        ctx.restore();
    });
}

function drawLiftShaft(ctx, x, topY, height, t) {
    ctx.save();
    const shaftW = 32;
    ctx.fillStyle = '#37474F';
    ctx.fillRect(x - shaftW/2, topY, shaftW, height + 60);
    ctx.strokeStyle = '#607D8B';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x - 8, topY); ctx.lineTo(x - 8, topY + height + 60); ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x + 8, topY); ctx.lineTo(x + 8, topY + height + 60); ctx.stroke();
    const liftBob = Math.sin(t/600) * 4;
    const liftY = topY + 30 + liftBob;
    ctx.fillStyle = '#546E7A';
    roundRect(ctx, x-13, liftY, 26, 20, 4); ctx.fill();
    ctx.strokeStyle = '#90A4AE'; ctx.lineWidth = 2;
    roundRect(ctx, x-13, liftY, 26, 20, 4); ctx.stroke();
    drawCharacter(ctx, x, liftY + 10, '#E91E63', 12);
    ctx.fillStyle = '#455A64';
    ctx.fillRect(x-20, topY-8, 40, 20);
    ctx.fillStyle = '#78909C';
    ctx.fillRect(x-16, topY-12, 32, 8);
    ctx.restore();
}

function drawMiner(ctx, x, y, t, active) {
    ctx.save();
    drawCharacter(ctx, x, y, active ? '#FF8F00' : '#FFA726', 18);
    ctx.fillStyle = '#FFD54F';
    ctx.beginPath();
    ctx.ellipse(x, y-26, 12, 8, 0, Math.PI, 0);
    ctx.fill();
    const swing = Math.sin(t/300) * 0.4;
    ctx.save();
    ctx.translate(x + 12, y - 8);
    ctx.rotate(swing);
    ctx.fillStyle = '#795548';
    ctx.fillRect(-2, -12, 4, 16);
    ctx.fillStyle = '#9E9E9E';
    ctx.fillRect(-4, -16, 10, 6);
    ctx.restore();
    ctx.restore();
}

function drawCharacter(ctx, x, y, color, size) {
    ctx.fillStyle = '#FFCC80';
    ctx.beginPath(); ctx.arc(x, y - size*1.5, size*0.7, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = '#333';
    ctx.beginPath(); ctx.arc(x-size*0.25, y-size*1.6, size*0.1, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x+size*0.25, y-size*1.6, size*0.1, 0, Math.PI*2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(x-size*0.6, y-size*0.8);
    ctx.lineTo(x+size*0.6, y-size*0.8);
    ctx.lineTo(x+size*0.5, y);
    ctx.lineTo(x-size*0.5, y);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#455A64';
    ctx.fillRect(x-size*0.45, y, size*0.35, size*0.7);
    ctx.fillRect(x+size*0.1, y, size*0.35, size*0.7);
    ctx.fillStyle = '#FFCC80';
    ctx.fillRect(x-size*0.9, y-size*0.7, size*0.4, size*0.2);
    ctx.fillRect(x+size*0.5, y-size*0.7, size*0.4, size*0.2);
}

function drawMineActivity(ctx, x, y, t) {
    const spark = Math.sin(t/150);
    ctx.save();
    ctx.globalAlpha = 0.7 + spark * 0.3;
    ctx.font = '22px serif';
    ctx.textAlign = 'center';
    ctx.fillText('💎', x, y);
    ctx.restore();
}

function drawTrainTrack(ctx, x1, y, x2) {
    ctx.save();
    ctx.fillStyle = '#5D4037';
    for (let tx=x1; tx<x2; tx+=18) {
        ctx.fillRect(tx, y, 12, 6);
    }
    ctx.strokeStyle = '#8D6E63';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(x1, y+2); ctx.lineTo(x2, y+2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(x1, y+5); ctx.lineTo(x2, y+5); ctx.stroke();
    ctx.restore();
}

function drawTrain(ctx, x, y, t) {
    ctx.save();
    ctx.fillStyle = '#616161';
    [-16, 16, 36].forEach(wx => {
        ctx.beginPath(); ctx.arc(x+wx, y+16, 7, 0, Math.PI*2); ctx.fill();
        ctx.strokeStyle = '#9E9E9E'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(x+wx, y+16, 7, 0, Math.PI*2); ctx.stroke();
    });
    ctx.fillStyle = '#E53935';
    roundRect(ctx, x-25, y-8, 68, 24, 6); ctx.fill();
    ctx.fillStyle = '#EF9A9A';
    roundRect(ctx, x-20, y-4, 20, 12, 3); ctx.fill();
    roundRect(ctx, x+5, y-4, 20, 12, 3); ctx.fill();
    ctx.fillStyle = '#424242';
    ctx.fillRect(x+30, y-16, 8, 10);
    const smokeOff = Math.sin(t/300)*3;
    ctx.fillStyle = 'rgba(200,200,200,0.5)';
    ctx.beginPath(); ctx.arc(x+34+smokeOff, y-22, 5, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x+37+smokeOff*0.5, y-30, 4, 0, Math.PI*2); ctx.fill();
    ctx.restore();
}

function drawWarehouse(ctx, x, y, t) {
    ctx.save();
    ctx.fillStyle = '#546E7A';
    roundRect(ctx, x-35, y, 70, 90, 6); ctx.fill();
    ctx.fillStyle = '#8D6E63';
    ctx.beginPath();
    ctx.moveTo(x-40, y+4); ctx.lineTo(x, y-20); ctx.lineTo(x+40, y+4);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#37474F';
    roundRect(ctx, x-12, y+55, 24, 35, 3); ctx.fill();
    ctx.fillStyle = '#80DEEA';
    ctx.fillRect(x-28, y+15, 18, 14);
    ctx.fillRect(x+10, y+15, 18, 14);
    ctx.fillStyle = '#FFD700';
    roundRect(ctx, x-30, y-5, 60, 18, 4); ctx.fill();
    ctx.fillStyle = '#333';
    ctx.font = 'bold 9px Nunito';
    ctx.textAlign = 'center';
    ctx.fillText('ХРАНИЛИЩЕ', x, y+7);
    const fillPct = gameState.warehouse.current / getWarehouseMax();
    ctx.fillStyle = `rgba(76,175,80,${fillPct*0.6+0.2})`;
    roundRect(ctx, x-28, y+35, 56, 40, 3); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 11px Nunito';
    ctx.fillText(`${gameState.warehouse.current}`, x, y+58);
    ctx.restore();
}

function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.arcTo(x+w, y, x+w, y+r, r);
    ctx.lineTo(x+w, y+h-r);
    ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
    ctx.lineTo(x+r, y+h);
    ctx.arcTo(x, y+h, x, y+h-r, r);
    ctx.lineTo(x, y+r);
    ctx.arcTo(x, y, x+r, y, r);
    ctx.closePath();
}

canvas.addEventListener('click', function(e) {
    const rect = canvas.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (W / rect.width);
    const cy = (e.clientY - rect.top) * (H / rect.height);
    const surfaceY = H * SURFACE_Y_PCT;
    const liftX = W * LIFT_X_PCT;
    const whX = W * WAREHOUSE_X_PCT;
    if (cy > surfaceY + H*0.15 && cx > W*0.3 && cx < W*0.85) {
        openUpgradePanel('miner');
        return;
    }
    if (Math.abs(cx - liftX) < 40 && cy > surfaceY - 50 && cy < surfaceY + H*0.25) {
        openUpgradePanel('lift');
        return;
    }
    if (Math.abs(cx - whX) < 50 && cy < surfaceY) {
        openUpgradePanel('warehouse');
        return;
    }
});

let currentUpgradeTarget = null;

function openUpgradePanel(target) {
    currentUpgradeTarget = target;
    const panel = document.getElementById('upgrade-panel');
    const content = document.getElementById('upgrade-content');
    const title = document.getElementById('upgrade-title');
    panel.classList.remove('hidden');
    const mult = getUpgradeCostMultiplier();
    if (target === 'miner') {
        title.textContent = '⛏️ Улучшить шахтёра';
        content.innerHTML = buildUpgradeHTML(['minerSpeed', 'minerCap'], mult) + buildManagerHTML('miner');
    } else if (target === 'lift') {
        title.textContent = '🚡 Улучшить лифт';
        content.innerHTML = buildUpgradeHTML(['liftSpeed', 'liftCap'], mult) + buildManagerHTML('lift');
    } else if (target === 'warehouse') {
        title.textContent = '🏦 Улучшить хранилище';
        content.innerHTML = buildUpgradeHTML(['mineStorageCap', 'warehouseCap'], mult) + buildManagerHTML('warehouse');
    }
}

function buildUpgradeHTML(keys, costMult) {
    return keys.map(key => {
        const cfg = UPGRADE_CONFIG[key];
        const lvl = gameState.upgradeLevels[key];
        const isMax = lvl >= cfg.levels.length;
        const rawCost = cfg.costs[lvl-1];
        const cost = isMax ? 0 : Math.ceil(rawCost * costMult);
        const canAfford = !isMax && gameState.coins.normal >= cost;
        const btnClass = isMax ? 'maxed' : (canAfford ? '' : 'insufficient');
        const btnText = isMax ? 'МАКС' : `${cost} 🪙`;
        const desc = key.includes('Speed') ?
            `Текущий множитель: ×${cfg.speedMult[lvl-1].toFixed(1)}` :
            `Текущий бонус: +${cfg.capAdd ? cfg.capAdd[lvl-1] : 0}`;
        return `
            <div class="upgrade-section">
                <div class="upgrade-section-title">${cfg.icon} ${cfg.name}</div>
                <div class="upgrade-item">
                    <div class="upgrade-item-info">
                        <div class="upgrade-item-name">${cfg.name}</div>
                        <div class="upgrade-item-desc">${desc}</div>
                    </div>
                    <div class="upgrade-item-level">Ур.${lvl}</div>
                    <button class="upgrade-cost-btn ${btnClass}" onclick="doUpgrade('${key}')">${btnText}</button>
                </div>
            </div>`;
    }).join('');
}

function buildManagerHTML(type) {
    const cfg = MANAGER_CONFIG[type];
    const owned = gameState.managers[type];
    const mult = getUpgradeCostMultiplier();
    const cost = Math.ceil(cfg.cost * mult);
    const canAfford = !owned && gameState.coins.normal >= cost;
    return `<div class="upgrade-section">
        <div class="upgrade-section-title">👔 Менеджер</div>
        <div class="upgrade-item" style="flex-direction:column;align-items:flex-start;gap:8px">
            <div class="upgrade-item-name">${cfg.icon} ${cfg.name}</div>
            <div class="upgrade-item-desc">${cfg.desc}</div>
            <button class="manager-buy-btn ${owned ? 'owned' : ''}" onclick="buyManager('${type}')">
                ${owned ? '✅ Нанят' : `Нанять — ${cost} 🪙`}
            </button>
        </div>
    </div>`;
}

function closeUpgradePanel() {
    document.getElementById('upgrade-panel').classList.add('hidden');
}

function doUpgrade(key) {
    const cfg = UPGRADE_CONFIG[key];
    const lvl = gameState.upgradeLevels[key];
    if (lvl >= cfg.levels.length) { showToast('Максимальный уровень!'); return; }
    const cost = Math.ceil(cfg.costs[lvl-1] * getUpgradeCostMultiplier());
    if (gameState.coins.normal < cost) { showToast('Недостаточно монет!'); return; }
    gameState.coins.normal -= cost;
    gameState.upgradeLevels[key]++;
    saveState();
    openUpgradePanel(currentUpgradeTarget);
    showToast(`${cfg.name} улучшена до уровня ${gameState.upgradeLevels[key]}!`);
    updateHUD();
}

function buyManager(type) {
    if (gameState.managers[type]) { showToast('Менеджер уже нанят!'); return; }
    const cfg = MANAGER_CONFIG[type];
    const cost = Math.ceil(cfg.cost * getUpgradeCostMultiplier());
    if (gameState.coins.normal < cost) { showToast('Недостаточно монет!'); return; }
    gameState.coins.normal -= cost;
    gameState.managers[type] = true;
    saveState();
    openUpgradePanel(currentUpgradeTarget);
    showToast(`${cfg.name} нанят!`);
}

function sellCoins(auto = false) {
    const amt = gameState.warehouse.current;
    if (amt === 0) { if (!auto) showToast('Хранилище пусто!'); return; }
    const value = Math.floor(amt * (0.7 * 20 + 0.25 * 30 + 0.05 * 50) / 100 * 100) / 100;
    gameState.warehouse.current = 0;
    showToast(`Продано ${amt} монет из хранилища!`);
    saveState();
    updateHUD();
    updateWarehouseUI();
}

function updateHUD() {
    document.getElementById('hud-normal').textContent = formatNum(gameState.coins.normal);
    document.getElementById('hud-silver').textContent = formatNum(gameState.coins.silver);
    document.getElementById('hud-gold').textContent = formatNum(gameState.coins.gold);
    const minerSpd = getMinerSpeed();
    const rate = Math.round(getMinerCapacity() / minerSpd * 60 * gameState.miners.length);
    document.getElementById('hud-rate').textContent = `${rate}/мин`;
    updateWarehouseUI();
    document.getElementById('prof-normal').textContent = formatNum(gameState.coins.normal);
    document.getElementById('prof-silver').textContent = formatNum(gameState.coins.silver);
    document.getElementById('prof-gold').textContent = formatNum(gameState.coins.gold);
    document.getElementById('craft-normal-bal').textContent = formatNum(gameState.coins.normal);
    document.getElementById('craft-silver-bal').textContent = formatNum(gameState.coins.silver);
}

function updateWarehouseUI() {
    const cur = gameState.warehouse.current;
    const max = getWarehouseMax();
    document.getElementById('wh-current').textContent = cur;
    document.getElementById('wh-max').textContent = max;
    const value = Math.floor(cur * 0.25);
    document.getElementById('sell-value').textContent = `${cur} монет`;
}

function formatNum(n) {
    if (n >= 1000000) return (n/1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n/1000).toFixed(1) + 'K';
    return Math.floor(n).toString();
}

function switchScreen(screen, btn) {
    document.querySelectorAll('.screen').forEach(s => {
        s.classList.remove('active');
        s.classList.add('hidden');
    });
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    const target = document.getElementById(screen + '-screen');
    if (target) { target.classList.remove('hidden'); target.classList.add('active'); }
    if (btn) btn.classList.add('active');
    closeUpgradePanel();
    if (screen === 'miners') loadLeaderboard('normal');
    if (screen === 'craft') updateHUD();
    if (screen === 'profile') updateProfileScreen();
}

function updateProfileScreen() {
    document.getElementById('profile-name').textContent = USER.name;
    document.getElementById('profile-id').textContent = `ID: ${USER.id}`;
    const botLink = `https://t.me/${BOT_USERNAME}?start=${USER.id}`;
    document.getElementById('ref-link').textContent = botLink;
    updateHUD();
}

let lbCurrentTab = 'normal';

function switchLbTab(type, btn) {
    lbCurrentTab = type;
    document.querySelectorAll('.lb-tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    loadLeaderboard(type);
}

function loadLeaderboard(type) {
    const list = document.getElementById('lb-list');
    list.innerHTML = '<div class="lb-loading">Загрузка...</div>';
    setTimeout(() => {
        const mockData = generateMockLeaderboard(type);
        renderLeaderboard(mockData, type);
    }, 500);
}

function generateMockLeaderboard(type) {
    const names = ['Алексей', 'Мария', 'Иван', 'Анна', 'Сергей', 'Ольга', 'Дмитрий', 'Татьяна', 'Андрей', 'Наталья',
    'Павел', 'Елена', 'Николай', 'Ирина', 'Антон', 'Юлия', 'Кирилл', 'Светлана', 'Максим', 'Виктория'];
    const data = [];
    const myCoins = type === 'normal' ? gameState.coins.normal : type === 'silver' ? gameState.coins.silver : gameState.coins.gold;
    data.push({ name: USER.name, amount: myCoins, isMe: true });
    for (let i=1; i<100; i++) {
        const base = type === 'gold' ? 50 : type === 'silver' ? 200 : 1000;
        data.push({ name: names[i % names.length] + ' ' + (i+1), amount: Math.floor(base * Math.pow(0.9, i) + Math.random()*50) });
    }
    data.sort((a,b) => b.amount - a.amount);
    return data;
}

function renderLeaderboard(data, type) {
    const list = document.getElementById('lb-list');
    const icon = { normal: '🪙', silver: '🥈', gold: '🏅' }[type];
    list.innerHTML = data.slice(0, 100).map((item, i) => {
        const rankClass = i === 0 ? 'gold-rank' : i === 1 ? 'silver-rank' : i === 2 ? 'bronze-rank' : '';
        const rankEmoji = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i+1}`;
        return `<div class="lb-item ${rankClass} ${item.isMe ? 'my-rank' : ''}">
            <div class="lb-rank">${rankEmoji}</div>
            <div class="lb-name">${item.name}${item.isMe ? ' (Вы)' : ''}</div>
            <div class="lb-amount">${formatNum(item.amount)} ${icon}</div>
        </div>`;
    }).join('');
}

function craftCoin(type) {
    if (type === 'normal') {
        if (gameState.coins.normal < 8) { showToast('Нужно 8 обычных монет!'); return; }
        gameState.coins.normal -= 8;
        if (Math.random() < 0.9) {
            gameState.coins.silver += 1;
            gameState.stats.totalSilver = (gameState.stats.totalSilver||0) + 1;
            showToast('🎉 Успех! Получена серебряная монета!');
        } else {
            showToast('💨 Неудача! Монеты потрачены...');
        }
    } else if (type === 'silver') {
        if (gameState.coins.silver < 4) { showToast('Нужно 4 серебряных монеты!'); return; }
        gameState.coins.silver -= 4;
        if (Math.random() < 0.9) {
            gameState.coins.gold += 1;
            gameState.stats.totalGold = (gameState.stats.totalGold||0) + 1;
            showToast('🎉 Успех! Получена золотая монета!');
        } else {
            showToast('💨 Неудача! Монеты потрачены...');
        }
    } else if (type === 'gold') {
        showToast('🔜 Скоро в обновлении!');
        return;
    }
    saveState();
    updateHUD();
}

function openExchange() {
    showModal(`<div class="modal-title">💱 Обмен на TON</div>
        <div class="modal-section">
            <div class="modal-label">🥈 Серебряные монеты (мин. 100)</div>
            <div class="modal-label">У вас: <b>${formatNum(gameState.coins.silver)}</b> | 1 монета = ${gameState.exchangeRates.silver} TON</div>
            <input class="modal-input" type="number" id="ex-silver-amt" placeholder="Количество (мин. 100)" min="100">
            <div class="modal-info" id="ex-silver-info">≈ 0 TON</div>
        </div>
        <div class="modal-section">
            <div class="modal-label">🏅 Золотые монеты (мин. 100)</div>
            <div class="modal-label">У вас: <b>${formatNum(gameState.coins.gold)}</b> | 1 монета = ${gameState.exchangeRates.gold} TON</div>
            <input class="modal-input" type="number" id="ex-gold-amt" placeholder="Количество (мин. 100)" min="100">
            <div class="modal-info" id="ex-gold-info">≈ 0 TON</div>
        </div>
        <button class="modal-btn blue" onclick="doExchange()">Обменять</button>
        <button class="modal-cancel" onclick="closeModal()">Отмена</button>`);
    document.getElementById('ex-silver-amt').addEventListener('input', function() {
        const v = parseFloat(this.value)||0;
        document.getElementById('ex-silver-info').textContent = `≈ ${(v * gameState.exchangeRates.silver).toFixed(4)} TON`;
    });
    document.getElementById('ex-gold-amt').addEventListener('input', function() {
        const v = parseFloat(this.value)||0;
        document.getElementById('ex-gold-info').textContent = `≈ ${(v * gameState.exchangeRates.gold).toFixed(4)} TON`;
    });
}

function doExchange() {
    const sAmt = parseInt(document.getElementById('ex-silver-amt').value)||0;
    const gAmt = parseInt(document.getElementById('ex-gold-amt').value)||0;
    let totalTon = 0;
    let ok = true;
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
    saveState();
    updateHUD();
    closeModal();
    showToast(`✅ Обменяно! ${totalTon.toFixed(4)} TON будет зачислено`);
    sendExchangeRequest(sAmt, gAmt, totalTon);
}

function openDeposit() {
    showModal(`<div class="modal-title">💳 Пополнить</div>
        <div class="modal-section">
            <p style="color:#555;margin-bottom:12px">Выберите способ пополнения:</p>
            <button class="modal-btn blue" onclick="depositStars()" style="margin-bottom:10px">⭐ Telegram Stars (мин. 100)</button>
            <button class="modal-btn" style="background:#ccc;color:#666;cursor:not-allowed;margin-bottom:10px">💎 TON (скоро)</button>
        </div>
        <button class="modal-cancel" onclick="closeModal()">Отмена</button>`);
}

function depositStars() {
    closeModal();
    showModal(`<div class="modal-title">⭐ Пополнение Stars</div>
        <div class="modal-section">
            <div class="modal-label">Количество Stars (мин. 100):</div>
            <input class="modal-input" type="number" id="dep-stars" placeholder="100" min="100">
            <div class="modal-info">100 Stars ≈ 2 серебряных + 10 обычных монет</div>
        </div>
        <button class="modal-btn blue" onclick="confirmDepositStars()">Пополнить через Telegram</button>
        <button class="modal-cancel" onclick="closeModal()">Назад</button>`);
}

function confirmDepositStars() {
    const amt = parseInt(document.getElementById('dep-stars').value)||0;
    if (amt < 100) { showToast('Минимум 100 Stars!'); return; }
    if (tg) {
        tg.openInvoice(`https://t.me/${BOT_USERNAME}?start=pay_stars_${amt}`, (status) => {
            if (status === 'paid') {
                showToast('✅ Пополнение успешно!');
            }
        });
    } else {
        showToast('Откройте в Telegram для оплаты');
    }
    closeModal();
}

function openWithdraw() {
    showModal(`<div class="modal-title">📤 Вывод TON</div>
        <div class="modal-section">
            <div class="modal-label">Сначала обменяйте монеты на TON,<br>затем выведите их.</div>
            <div class="modal-label" style="margin-top:12px">TON адрес кошелька:</div>
            <input class="modal-input" type="text" id="withdraw-addr" placeholder="EQ... или UQ...">
            <div class="modal-label" style="margin-top:12px">Сумма вывода (мин. 1 TON):</div>
            <input class="modal-input" type="number" id="withdraw-amt" placeholder="1.0" min="1" step="0.1">
        </div>
        <button class="modal-btn orange" onclick="doWithdraw()">Вывести</button>
        <button class="modal-cancel" onclick="closeModal()">Отмена</button>`);
}

function doWithdraw() {
    const addr = document.getElementById('withdraw-addr').value.trim();
    const amt = parseFloat(document.getElementById('withdraw-amt').value)||0;
    if (!addr || addr.length < 20) { showToast('Введите корректный адрес!'); return; }
    if (amt < 1) { showToast('Минимум 1 TON!'); return; }
    closeModal();
    showToast('📤 Заявка на вывод отправлена! Обработка до 24ч.');
    sendWithdrawRequest(addr, amt);
}

function copyRefLink() {
    const link = document.getElementById('ref-link').textContent;
    if (navigator.clipboard) {
        navigator.clipboard.writeText(link).then(() => showToast('Ссылка скопирована!'));
    } else {
        showToast('Скопируй ссылку вручную');
    }
}

const ADMIN_IDS = ['123456789'];

function isAdmin() {
    return ADMIN_IDS.includes(String(USER.id));
}

function checkAdminAccess() {
    if (!isAdmin()) return false;
    return true;
}

function adminSaveRates() {
    const n = parseFloat(document.getElementById('adm-normal-pct').value)||70;
    const s = parseFloat(document.getElementById('adm-silver-pct').value)||25;
    const g = parseFloat(document.getElementById('adm-gold-pct').value)||5;
    if (Math.abs(n+s+g-100) > 1) { showToast('Сумма должна = 100%!'); return; }
    gameState.rates = { normal: n, silver: s, gold: g };
    const sr = parseFloat(document.getElementById('adm-silver-rate').value)||0.001;
    const gr = parseFloat(document.getElementById('adm-gold-rate').value)||0.005;
    gameState.exchangeRates = { silver: sr, gold: gr };
    saveState();
    showToast('✅ Настройки сохранены!');
}

function adminStartHappyHour() {
    const dur = parseInt(document.getElementById('adm-happy-duration').value)||60;
    const endsAt = Date.now() + dur * 60 * 1000;
    gameState.happyHour = { active: true, endsAt };
    saveState();
    document.getElementById('happy-hour-badge').classList.remove('hidden');
    document.getElementById('happy-status').textContent = `⚡ Счастливый час активен! Осталось: ${dur} мин`;
    showToast('⚡ Счастливый час запущен!');
}

function adminLookupUser() {
    const uid = document.getElementById('adm-user-id').value.trim();
    if (!uid) { showToast('Введите ID!'); return; }
    document.getElementById('adm-user-info').classList.remove('hidden');
    document.getElementById('adm-user-name').textContent = `Пользователь: ${uid}`;
}

function adminGiveCoins() {
    const n = parseInt(document.getElementById('adm-give-normal').value)||0;
    const s = parseInt(document.getElementById('adm-give-silver').value)||0;
    const g = parseInt(document.getElementById('adm-give-gold').value)||0;
    const uid = document.getElementById('adm-user-id').value.trim();
    sendAdminAction('give', uid, n, s, g);
    showToast(`✅ Начислено: ${n}🪙 ${s}🥈 ${g}🏅`);
}

function adminRemoveCoins() {
    const n = parseInt(document.getElementById('adm-give-normal').value)||0;
    const s = parseInt(document.getElementById('adm-give-silver').value)||0;
    const g = parseInt(document.getElementById('adm-give-gold').value)||0;
    const uid = document.getElementById('adm-user-id').value.trim();
    sendAdminAction('remove', uid, n, s, g);
    showToast(`✅ Списано: ${n}🪙 ${s}🥈 ${g}🏅`);
}

function showModal(html) {
    const overlay = document.getElementById('modal-overlay');
    const content = document.getElementById('modal-content');
    content.innerHTML = html;
    overlay.classList.remove('hidden');
    document.getElementById('modal-box').onclick = e => e.stopPropagation();
}

function closeModal() {
    document.getElementById('modal-overlay').classList.add('hidden');
}

let toastTimeout;
function showToast(msg) {
    const toast = document.getElementById('toast');
    toast.textContent = msg;
    toast.classList.remove('hidden');
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => toast.classList.add('hidden'), 2500);
}

async function sendExchangeRequest(silver, gold, ton) {
    try {
        await fetch(`${API_BASE}/exchange`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: USER.id, silver, gold, ton, init_data: tg?.initData })
        });
    } catch(e) { console.log('Exchange request logged locally'); }
}

async function sendWithdrawRequest(address, amount) {
    try {
        await fetch(`${API_BASE}/withdraw`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ user_id: USER.id, address, amount, init_data: tg?.initData })
        });
    } catch(e) { console.log('Withdraw request logged locally'); }
}

async function sendAdminAction(action, target_id, normal, silver, gold) {
    try {
        await fetch(`${API_BASE}/admin/${action}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ admin_id: USER.id, target_id, normal, silver, gold, init_data: tg?.initData })
        });
    } catch(e) { console.log('Admin action logged locally'); }
}

function init() {
    const bar = document.getElementById('load-bar');
    let progress = 0;
    const loadInterval = setInterval(() => {
        progress += Math.random() * 20;
        bar.style.width = Math.min(progress, 95) + '%';
        if (progress >= 95) clearInterval(loadInterval);
    }, 150);
    window.addEventListener('resize', () => { resizeCanvas(); });
    setTimeout(() => {
        bar.style.width = '100%';
        setTimeout(() => {
            document.getElementById('loading-screen').style.display = 'none';
            document.getElementById('app').classList.remove('hidden');
            resizeCanvas();
            updateHUD();
            updateProfileScreen();
            if (isAdmin()) {
                const nav = document.getElementById('bottom-nav');
                const adminBtn = document.createElement('button');
                adminBtn.className = 'nav-btn';
                adminBtn.innerHTML = '<span class="nav-icon">🔐</span><span class="nav-label">Админ</span>';
                adminBtn.onclick = function() { switchScreen('admin', adminBtn); };
                nav.appendChild(adminBtn);
            }
            requestAnimationFrame(gameTick);
            const isNew = !localStorage.getItem(`gt_visited_${USER.id}`);
            if (isNew) {
                localStorage.setItem(`gt_visited_${USER.id}`, '1');
                setTimeout(() => {
                    showToast('🎉 Добро пожаловать! Вам начислены стартовые монеты!');
                }, 1000);
            }
        }, 500);
    }, 1500);
}

init();
