import os
import json
import hmac
import hashlib
import logging
import asyncio
import secrets
from datetime import datetime, timedelta
from typing import Optional
import sqlite3
from dotenv import load_dotenv

load_dotenv()

BOT_TOKEN   = os.getenv('BOT_TOKEN', 'YOUR_BOT_TOKEN')
WEBAPP_URL  = os.getenv('WEBAPP_URL', 'https://your-domain.com')
ADMIN_IDS   = list(map(int, os.getenv('ADMIN_IDS', '').split(','))) if os.getenv('ADMIN_IDS') else []
PORT = 8000

logging.basicConfig(level=logging.INFO)
log = logging.getLogger(__name__)


# ─────────────────────────── DATABASE ───────────────────────────

def init_db():
    conn = sqlite3.connect('gifts_tycoon.db')
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS users (
        user_id      INTEGER PRIMARY KEY,
        username     TEXT,
        first_name   TEXT,
        coins_normal REAL    DEFAULT 50,
        coins_silver REAL    DEFAULT 5,
        coins_gold   REAL    DEFAULT 1,
        total_normal INTEGER DEFAULT 0,
        total_silver INTEGER DEFAULT 0,
        total_gold   INTEGER DEFAULT 0,
        referred_by  INTEGER,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        last_seen    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS transactions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id       INTEGER,
        type          TEXT,
        amount_normal REAL DEFAULT 0,
        amount_silver REAL DEFAULT 0,
        amount_gold   REAL DEFAULT 0,
        ton_amount    REAL DEFAULT 0,
        notes         TEXT,
        created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS withdrawals (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER,
        ton_address  TEXT,
        amount       REAL,
        status       TEXT DEFAULT 'pending',
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        processed_at TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS happy_hours (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        started_by INTEGER,
        started_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        ends_at    TIMESTAMP,
        is_active  INTEGER DEFAULT 1
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS game_settings (
        key   TEXT PRIMARY KEY,
        value TEXT
    )''')

    # pending_invoices: tracks Stars invoices until Telegram confirms payment
    c.execute('''CREATE TABLE IF NOT EXISTS pending_invoices (
        invoice_id   TEXT PRIMARY KEY,
        user_id      INTEGER,
        stars        INTEGER,
        invoice_type TEXT,  -- 'deposit' | 'boost'
        boost_pct    REAL   DEFAULT 0,
        boost_hours  INTEGER DEFAULT 0,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        paid         INTEGER DEFAULT 0
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS promo_codes (
        code         TEXT PRIMARY KEY,
        uses_max     INTEGER DEFAULT 1,
        uses_current INTEGER DEFAULT 0,
        normal       INTEGER DEFAULT 0,
        silver       INTEGER DEFAULT 0,
        gold         INTEGER DEFAULT 0,
        created_by   INTEGER,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS promo_activations (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER,
        code       TEXT,
        activated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )''')

    defaults = [
        ('normal_rate',       '70'),
        ('silver_rate',       '25'),
        ('gold_rate',         '5'),
        ('silver_ton_rate',   '0.001'),
        ('gold_ton_rate',     '0.005'),
        ('min_exchange',      '100'),
        ('min_withdraw_ton',  '1.0'),
        ('ref_reward_type',   'silver'),
        ('ref_reward_amount', '1'),
        ('upgrade_mult',      '1.0'),
        ('mine_costs',        '{}'),
    ]
    c.executemany('INSERT OR IGNORE INTO game_settings VALUES (?,?)', defaults)
    conn.commit()
    conn.close()


def get_db():
    return sqlite3.connect('gifts_tycoon.db')


def get_setting(key: str, default=None):
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT value FROM game_settings WHERE key=?', (key,))
    row = c.fetchone()
    conn.close()
    return row[0] if row else default


def set_setting(key: str, value: str):
    conn = get_db()
    c = conn.cursor()
    c.execute('INSERT OR REPLACE INTO game_settings VALUES (?,?)', (key, value))
    conn.commit()
    conn.close()


def get_or_create_user(user_id: int, username: str = None, first_name: str = None):
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM users WHERE user_id=?', (user_id,))
    user = c.fetchone()
    if not user:
        c.execute(
            'INSERT INTO users (user_id, username, first_name) VALUES (?,?,?)',
            (user_id, username, first_name)
        )
        conn.commit()
        c.execute('SELECT * FROM users WHERE user_id=?', (user_id,))
        user = c.fetchone()
    else:
        c.execute(
            'UPDATE users SET last_seen=CURRENT_TIMESTAMP, username=?, first_name=? WHERE user_id=?',
            (username, first_name, user_id)
        )
        conn.commit()
    conn.close()
    return user


def get_user(user_id: int):
    conn = get_db()
    c = conn.cursor()
    c.execute('SELECT * FROM users WHERE user_id=?', (user_id,))
    user = c.fetchone()
    conn.close()
    return user


def adjust_coins(user_id: int, normal: float = 0, silver: float = 0, gold: float = 0,
                 transaction_type: str = 'admin', notes: str = ''):
    conn = get_db()
    c = conn.cursor()
    c.execute('''UPDATE users SET
        coins_normal = MAX(0, coins_normal + ?),
        coins_silver = MAX(0, coins_silver + ?),
        coins_gold   = MAX(0, coins_gold   + ?)
        WHERE user_id=?''', (normal, silver, gold, user_id))
    if normal > 0: c.execute('UPDATE users SET total_normal=total_normal+? WHERE user_id=?', (int(normal), user_id))
    if silver > 0: c.execute('UPDATE users SET total_silver=total_silver+? WHERE user_id=?', (int(silver), user_id))
    if gold   > 0: c.execute('UPDATE users SET total_gold=total_gold+?     WHERE user_id=?', (int(gold),   user_id))
    c.execute(
        'INSERT INTO transactions (user_id,type,amount_normal,amount_silver,amount_gold,notes) VALUES (?,?,?,?,?,?)',
        (user_id, transaction_type, normal, silver, gold, notes)
    )
    conn.commit()
    conn.close()


def get_leaderboard(coin_type: str, limit: int = 100):
    conn = get_db()
    c = conn.cursor()
    col = f'total_{coin_type}'
    c.execute(f'SELECT user_id,first_name,username,{col} FROM users ORDER BY {col} DESC LIMIT ?', (limit,))
    rows = c.fetchall()
    conn.close()
    return rows


def validate_init_data(init_data: str) -> Optional[dict]:
    try:
        params = dict(pair.split('=', 1) for pair in init_data.split('&') if '=' in pair)
        check_hash = params.pop('hash', '')
        data_check_string = '\n'.join(f'{k}={v}' for k, v in sorted(params.items()))
        secret_key = hmac.new(b'WebAppData', BOT_TOKEN.encode(), hashlib.sha256).digest()
        computed   = hmac.new(secret_key, data_check_string.encode(), hashlib.sha256).hexdigest()
        if computed == check_hash:
            return json.loads(params.get('user', '{}'))
    except Exception as e:
        log.error(f'init_data validation error: {e}')
    return None


# ─────────────────────────── FASTAPI ────────────────────────────

try:
    from fastapi import FastAPI, HTTPException, Request, Query
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import HTMLResponse, JSONResponse, FileResponse
    from fastapi.middleware.cors import CORSMiddleware
    import uvicorn

    app = FastAPI(title='Gifts Tycoon API')

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Serve static files
    try:
        app.mount('/static', StaticFiles(directory='.'), name='static')
    except Exception:
        pass

    @app.get('/', response_class=HTMLResponse)
    async def serve_game():
        try:
            with open('index.html') as f:
                return f.read()
        except FileNotFoundError:
            return '<h1>index.html not found</h1>'

    @app.get('/style.css')
    async def serve_css():
        return FileResponse('style.css', media_type='text/css')

    @app.get('/game.js')
    async def serve_js():
        return FileResponse('game.js', media_type='application/javascript')

    # ── AUTH HELPER ──
    def require_user(init_data: str, user_id_fallback=None):
        user_info = validate_init_data(init_data) if init_data else None
        if user_info:
            return user_info.get('id')
        if os.getenv('DEBUG') and user_id_fallback:
            return user_id_fallback
        return None

    # ── SYNC ──
    @app.post('/api/sync')
    async def sync_user(request: Request):
        data      = await request.json()
        init_data = data.get('init_data', '')
        user_info = validate_init_data(init_data)
        if not user_info and not os.getenv('DEBUG'):
            raise HTTPException(401, 'Invalid auth')
        uid = user_info.get('id', 0) if user_info else data.get('user_id', 0)
        get_or_create_user(uid, user_info.get('username') if user_info else None,
                               user_info.get('first_name') if user_info else None)
        return {'status': 'ok'}

    # ── CREATE STARS INVOICE (deposit) ──
    @app.post('/api/create-stars-invoice')
    async def create_stars_invoice(request: Request):
        data      = await request.json()
        init_data = data.get('init_data', '')
        user_id   = int(data.get('user_id', 0))
        stars     = int(data.get('stars', 100))

        if stars < 1:
            raise HTTPException(400, 'Invalid amount')

        # Validate user
        user_info = validate_init_data(init_data)
        if not user_info and not os.getenv('DEBUG'):
            raise HTTPException(401, 'Invalid auth')

        get_or_create_user(user_id)

        # Create invoice via Telegram Bot API
        invoice_id = secrets.token_hex(16)
        payload    = f'deposit_{user_id}_{invoice_id}'

        try:
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f'https://api.telegram.org/bot{BOT_TOKEN}/createInvoiceLink',
                    json={
                        'title':         '💰 Пополнение баланса',
                        'description':   f'{stars} Stars → {stars*10} 🪙 + {stars} 🥈',
                        'payload':       payload,
                        'currency':      'XTR',
                        'prices':        [{'label': f'{stars} Stars', 'amount': stars}],
                    }
                )
            result = resp.json()
            if result.get('ok'):
                invoice_link = result['result']
                # Save pending invoice
                conn = get_db()
                conn.execute(
                    'INSERT INTO pending_invoices (invoice_id,user_id,stars,invoice_type,paid) VALUES (?,?,?,?,0)',
                    (invoice_id, user_id, stars, 'deposit')
                )
                conn.commit(); conn.close()
                return {'status': 'ok', 'invoice_url': invoice_link, 'invoice_id': invoice_id}
            else:
                raise HTTPException(500, result.get('description', 'Telegram API error'))
        except ImportError:
            # httpx not available — demo mode
            conn = get_db()
            conn.execute(
                'INSERT INTO pending_invoices (invoice_id,user_id,stars,invoice_type,paid) VALUES (?,?,?,?,0)',
                (invoice_id, user_id, stars, 'deposit')
            )
            conn.commit(); conn.close()
            return {'status': 'demo', 'invoice_url': None, 'invoice_id': invoice_id}

    # ── CREATE BOOST INVOICE ──
    @app.post('/api/create-boost-invoice')
    async def create_boost_invoice(request: Request):
        data       = await request.json()
        init_data  = data.get('init_data', '')
        user_id    = int(data.get('user_id', 0))
        stars      = int(data.get('stars', 100))
        boost_pct  = float(data.get('boost_pct', 0.1))
        boost_hours = int(data.get('boost_hours', 1))

        user_info = validate_init_data(init_data)
        if not user_info and not os.getenv('DEBUG'):
            raise HTTPException(401, 'Invalid auth')

        get_or_create_user(user_id)

        invoice_id = secrets.token_hex(16)
        payload    = f'boost_{user_id}_{invoice_id}'
        pct_str    = int(boost_pct * 100)

        try:
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    f'https://api.telegram.org/bot{BOT_TOKEN}/createInvoiceLink',
                    json={
                        'title':       f'⚡ Буст +{pct_str}% на {boost_hours}ч',
                        'description': f'Увеличение дохода на {pct_str}% на {boost_hours} час(а)',
                        'payload':     payload,
                        'currency':    'XTR',
                        'prices':      [{'label': f'{stars} Stars', 'amount': stars}],
                    }
                )
            result = resp.json()
            if result.get('ok'):
                invoice_link = result['result']
                conn = get_db()
                conn.execute(
                    'INSERT INTO pending_invoices (invoice_id,user_id,stars,invoice_type,boost_pct,boost_hours,paid) VALUES (?,?,?,?,?,?,0)',
                    (invoice_id, user_id, stars, 'boost', boost_pct, boost_hours)
                )
                conn.commit(); conn.close()
                return {'status': 'ok', 'invoice_url': invoice_link, 'invoice_id': invoice_id}
            else:
                raise HTTPException(500, result.get('description', 'Telegram API error'))
        except ImportError:
            conn = get_db()
            conn.execute(
                'INSERT INTO pending_invoices (invoice_id,user_id,stars,invoice_type,boost_pct,boost_hours,paid) VALUES (?,?,?,?,?,?,0)',
                (invoice_id, user_id, stars, 'boost', boost_pct, boost_hours)
            )
            conn.commit(); conn.close()
            return {'status': 'demo', 'invoice_url': None, 'invoice_id': invoice_id}

    # ── CHECK INVOICE PAID (called by frontend after tg.openInvoice 'paid') ──
    @app.post('/api/check-invoice')
    async def check_invoice(request: Request):
        data       = await request.json()
        invoice_id = data.get('invoice_id', '')
        user_id    = int(data.get('user_id', 0))
        init_data  = data.get('init_data', '')

        user_info = validate_init_data(init_data)
        if not user_info and not os.getenv('DEBUG'):
            raise HTTPException(401, 'Invalid auth')

        conn = get_db()
        row  = conn.execute(
            'SELECT invoice_id,user_id,stars,invoice_type,boost_pct,boost_hours,paid FROM pending_invoices WHERE invoice_id=?',
            (invoice_id,)
        ).fetchone()
        conn.close()

        if not row:
            raise HTTPException(404, 'Invoice not found')

        inv_id, inv_user, stars, inv_type, boost_pct, boost_hours, paid = row

        if int(inv_user) != user_id:
            raise HTTPException(403, 'Forbidden')

        if not paid:
            # Not yet confirmed by Telegram webhook — reject
            raise HTTPException(402, 'Payment not confirmed by Telegram yet')

        # Already paid — apply reward
        if inv_type == 'deposit':
            normal_gain = stars * 10
            silver_gain = stars
            adjust_coins(user_id, normal=normal_gain, silver=silver_gain,
                         transaction_type='deposit', notes=f'Stars deposit: {stars}')
            return {'status': 'ok', 'type': 'deposit', 'normal': normal_gain, 'silver': silver_gain}

        elif inv_type == 'boost':
            expiry_ms = int((datetime.now() + timedelta(hours=boost_hours)).timestamp() * 1000)
            return {'status': 'ok', 'type': 'boost', 'boost_pct': boost_pct,
                    'boost_hours': boost_hours, 'expiry_ms': expiry_ms}

        raise HTTPException(400, 'Unknown invoice type')

    # ── EXCHANGE ──
    @app.post('/api/exchange')
    async def exchange_coins(request: Request):
        data    = await request.json()
        user_id = int(data.get('user_id', 0))
        silver  = int(data.get('silver', 0))
        gold    = int(data.get('gold', 0))

        min_ex = int(get_setting('min_exchange', '100'))
        if silver > 0 and silver < min_ex:
            raise HTTPException(400, f'Minimum {min_ex} silver')
        if gold > 0 and gold < min_ex:
            raise HTTPException(400, f'Minimum {min_ex} gold')

        user = get_user(user_id)
        if not user:
            raise HTTPException(404, 'User not found')
        if user[4] < silver or user[5] < gold:
            raise HTTPException(400, 'Insufficient coins')

        sr  = float(get_setting('silver_ton_rate', '0.001'))
        gr  = float(get_setting('gold_ton_rate',   '0.005'))
        ton = silver * sr + gold * gr
        adjust_coins(user_id, silver=-silver, gold=-gold,
                     transaction_type='exchange', notes=f'{silver}s+{gold}g={ton}TON')
        return {'status': 'ok', 'ton_amount': ton}

    # ── WITHDRAW ──
    @app.post('/api/withdraw')
    async def withdraw_ton(request: Request):
        data    = await request.json()
        user_id = int(data.get('user_id', 0))
        address = data.get('address', '').strip()
        amount  = float(data.get('amount', 0))

        min_wd = float(get_setting('min_withdraw_ton', '1.0'))
        if amount < min_wd:
            raise HTTPException(400, f'Minimum {min_wd} TON')
        if not address or len(address) < 20:
            raise HTTPException(400, 'Invalid address')

        conn = get_db()
        conn.execute('INSERT INTO withdrawals (user_id,ton_address,amount) VALUES (?,?,?)',
                     (user_id, address, amount))
        conn.commit(); conn.close()
        return {'status': 'pending'}

    # ── LEADERBOARD ──
    @app.get('/api/leaderboard/{coin_type}')
    async def leaderboard(coin_type: str, limit: int = 100):
        if coin_type not in ('normal', 'silver', 'gold'):
            raise HTTPException(400, 'Invalid type')
        rows = get_leaderboard(coin_type, limit)
        return {'players': [{'name': r[1] or r[2] or 'Player', 'amount': r[3]} for r in rows]}

    # ── REFERRALS ──
    @app.get('/api/referrals')
    async def get_referrals(user_id: int, init_data: str = ''):
        conn  = get_db()
        count = conn.execute('SELECT COUNT(*) FROM users WHERE referred_by=?', (user_id,)).fetchone()[0]
        conn.close()
        return {'count': count}

    # ── USER PROFILE ──
    @app.get('/api/user/{user_id}')
    async def get_user_profile(user_id: int, admin_id: int = 0):
        if admin_id not in ADMIN_IDS:
            raise HTTPException(403, 'Not authorized')
        user = get_user(user_id)
        if not user:
            raise HTTPException(404, 'Not found')
        return {
            'user_id':    user[0], 'username': user[1], 'first_name': user[2],
            'coins_normal': user[3], 'coins_silver': user[4], 'coins_gold': user[5],
            'total_normal': user[6], 'total_silver': user[7], 'total_gold': user[8],
            'created_at': user[10], 'last_seen': user[11]
        }

    # ── ADMIN STATS ──
    @app.get('/api/admin/stats')
    async def admin_stats(admin_id: int, init_data: str = ''):
        if admin_id not in ADMIN_IDS:
            raise HTTPException(403, 'Not authorized')
        conn = get_db()
        total    = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        new_24h  = conn.execute("SELECT COUNT(*) FROM users WHERE created_at > datetime('now','-1 day')").fetchone()[0]
        active   = conn.execute("SELECT COUNT(*) FROM users WHERE last_seen  > datetime('now','-1 day')").fetchone()[0]
        pend_wd  = conn.execute("SELECT COUNT(*) FROM withdrawals WHERE status='pending'").fetchone()[0]
        stars_total = conn.execute(
            "SELECT COALESCE(SUM(stars),0) FROM pending_invoices WHERE paid=1"
        ).fetchone()[0]
        conn.close()
        return {'total_users': total, 'new_24h': new_24h, 'active_24h': active,
                'pending_withdrawals': pend_wd, 'stars_revenue': stars_total}

    # ── ADMIN GIVE ──
    @app.post('/api/admin/give')
    async def admin_give(request: Request):
        data     = await request.json()
        admin_id = int(data.get('admin_id', 0))
        if admin_id not in ADMIN_IDS:
            raise HTTPException(403, 'Not authorized')
        target = int(data.get('target_id', 0))
        n = float(data.get('normal', 0))
        s = float(data.get('silver', 0))
        g = float(data.get('gold',   0))
        get_or_create_user(target)
        adjust_coins(target, n, s, g, 'admin_give', f'by {admin_id}')
        u = get_user(target)
        return {'status': 'ok', 'coins_normal': u[3], 'coins_silver': u[4], 'coins_gold': u[5]}

    # ── ADMIN REMOVE ──
    @app.post('/api/admin/remove')
    async def admin_remove(request: Request):
        data     = await request.json()
        admin_id = int(data.get('admin_id', 0))
        if admin_id not in ADMIN_IDS:
            raise HTTPException(403, 'Not authorized')
        target = int(data.get('target_id', 0))
        n = float(data.get('normal', 0))
        s = float(data.get('silver', 0))
        g = float(data.get('gold',   0))
        adjust_coins(target, -n, -s, -g, 'admin_remove', f'by {admin_id}')
        u = get_user(target)
        return {'status': 'ok', 'coins_normal': u[3] if u else 0, 'coins_silver': u[4] if u else 0, 'coins_gold': u[5] if u else 0}

    # ── ADMIN SETTINGS (rates) ──
    @app.post('/api/admin/settings')
    async def admin_settings(request: Request):
        data     = await request.json()
        admin_id = int(data.get('admin_id', 0))
        if admin_id not in ADMIN_IDS:
            raise HTTPException(403, 'Not authorized')
        allowed = ('normal_rate','silver_rate','gold_rate','silver_ton_rate','gold_ton_rate')
        for k, v in data.items():
            if k in allowed:
                set_setting(k, str(v))
        return {'status': 'ok'}

    # ── ADMIN ECONOMY ──
    @app.post('/api/admin/economy')
    async def admin_economy(request: Request):
        data     = await request.json()
        admin_id = int(data.get('admin_id', 0))
        if admin_id not in ADMIN_IDS:
            raise HTTPException(403, 'Not authorized')
        if 'ref_reward_type'   in data: set_setting('ref_reward_type',   str(data['ref_reward_type']))
        if 'ref_reward_amount' in data: set_setting('ref_reward_amount', str(data['ref_reward_amount']))
        if 'upgrade_mult'      in data: set_setting('upgrade_mult',      str(data['upgrade_mult']))
        if 'mine_costs'        in data: set_setting('mine_costs',        json.dumps(data['mine_costs']))
        return {'status': 'ok'}

    # ── ADMIN ECONOMY GET ──
    @app.get('/api/admin/economy')
    async def get_admin_economy(admin_id: int):
        if admin_id not in ADMIN_IDS:
            raise HTTPException(403, 'Not authorized')
        return {
            'ref_reward_type':   get_setting('ref_reward_type',   'silver'),
            'ref_reward_amount': int(get_setting('ref_reward_amount', '1')),
            'upgrade_mult':      float(get_setting('upgrade_mult', '1.0')),
            'mine_costs':        json.loads(get_setting('mine_costs', '{}') or '{}'),
        }

    # ── PROMO: CREATE ──
    @app.post('/api/admin/promo/create')
    async def promo_create(request: Request):
        data     = await request.json()
        admin_id = int(data.get('admin_id', 0))
        if admin_id not in ADMIN_IDS:
            raise HTTPException(403, 'Not authorized')
        code   = str(data.get('code', '')).upper().strip()
        uses   = int(data.get('uses', 1))
        normal = int(data.get('normal', 0))
        silver = int(data.get('silver', 0))
        gold   = int(data.get('gold',   0))
        if not code:
            raise HTTPException(400, 'Code required')
        conn = get_db()
        try:
            conn.execute(
                'INSERT INTO promo_codes (code,uses_max,normal,silver,gold,created_by) VALUES (?,?,?,?,?,?)',
                (code, uses, normal, silver, gold, admin_id)
            )
            conn.commit()
        except sqlite3.IntegrityError:
            conn.close()
            raise HTTPException(409, 'Code already exists')
        conn.close()
        return {'status': 'ok', 'code': code}

    # ── PROMO: LIST ──
    @app.get('/api/admin/promo/list')
    async def promo_list(admin_id: int):
        if admin_id not in ADMIN_IDS:
            raise HTTPException(403, 'Not authorized')
        conn = get_db()
        rows = conn.execute(
            'SELECT code,uses_max,uses_current,normal,silver,gold,created_at FROM promo_codes ORDER BY created_at DESC LIMIT 50'
        ).fetchall()
        conn.close()
        return {'codes': [
            {'code':r[0],'uses_max':r[1],'uses_current':r[2],'normal':r[3],'silver':r[4],'gold':r[5],'created_at':r[6]}
            for r in rows
        ]}

    # ── PROMO: ACTIVATE ──
    @app.post('/api/promo/activate')
    async def promo_activate(request: Request):
        data      = await request.json()
        user_id   = int(data.get('user_id', 0))
        code      = str(data.get('code', '')).upper().strip()
        init_data = data.get('init_data', '')

        user_info = validate_init_data(init_data)
        if not user_info and not os.getenv('DEBUG'):
            raise HTTPException(401, 'Invalid auth')

        conn = get_db()
        promo = conn.execute(
            'SELECT code,uses_max,uses_current,normal,silver,gold FROM promo_codes WHERE code=?', (code,)
        ).fetchone()

        if not promo:
            conn.close()
            raise HTTPException(404, detail='Промокод не найден')

        if promo[2] >= promo[1]:
            conn.close()
            raise HTTPException(410, detail='Промокод уже использован')

        already = conn.execute(
            'SELECT id FROM promo_activations WHERE user_id=? AND code=?', (user_id, code)
        ).fetchone()
        if already:
            conn.close()
            raise HTTPException(409, detail='Вы уже использовали этот промокод')

        conn.execute('UPDATE promo_codes SET uses_current=uses_current+1 WHERE code=?', (code,))
        conn.execute('INSERT INTO promo_activations (user_id,code) VALUES (?,?)', (user_id, code))
        conn.commit()
        conn.close()

        adjust_coins(user_id, promo[3], promo[4], promo[5], 'promo', f'Promo: {code}')
        return {'status': 'ok', 'normal': promo[3], 'silver': promo[4], 'gold': promo[5]}

except ImportError:
        log.error('FastAPI not installed. Run: pip install fastapi uvicorn httpx')


# ─────────────────────────── AIOGRAM BOT ────────────────────────

try:
    from aiogram import Bot, Dispatcher, types, Router
    from aiogram.filters import Command, CommandStart
    from aiogram.types import (
        InlineKeyboardMarkup, InlineKeyboardButton,
        WebAppInfo, MenuButtonWebApp, BotCommand,
        LabeledPrice, Message
    )

    bot = Bot(token=BOT_TOKEN)
    dp  = Dispatcher()
    router = Router()
    dp.include_router(router)

    # ── /start ──
    @router.message(CommandStart())
    async def cmd_start(message: Message):
        user     = message.from_user
        ref_code = None
        if message.text and ' ' in message.text:
            ref_code = message.text.split(' ', 1)[1]

        get_or_create_user(user.id, user.username, user.first_name)

        if ref_code and ref_code.isdigit() and int(ref_code) != user.id:
            referrer_id = int(ref_code)
            conn = get_db()
            row  = conn.execute('SELECT referred_by FROM users WHERE user_id=?', (user.id,)).fetchone()
            already = row and row[0] is not None
            conn.close()
            if not already and get_user(referrer_id):
                conn2 = get_db()
                conn2.execute('UPDATE users SET referred_by=? WHERE user_id=?', (referrer_id, user.id))
                conn2.commit(); conn2.close()

                # Use admin-configured ref reward
                ref_type   = get_setting('ref_reward_type', 'silver')
                ref_amount = int(get_setting('ref_reward_amount', '1'))
                kw = {ref_type: ref_amount}
                adjust_coins(referrer_id, transaction_type='referral',
                             notes=f'Ref from {user.id}', **kw)
                adjust_coins(user.id, normal=20, silver=2,
                             transaction_type='referral', notes=f'Welcome, ref by {referrer_id}')
                try:
                    icon = {'normal': '🪙', 'silver': '🥈', 'gold': '🏅'}.get(ref_type, '🥈')
                    await bot.send_message(
                        referrer_id,
                        f'🎉 <b>{user.first_name}</b> присоединился по вашей ссылке!\n'
                        f'Вы получили +{ref_amount} {icon}!',
                        parse_mode='HTML'
                    )
                except Exception:
                    pass

        kb = InlineKeyboardMarkup(inline_keyboard=[[
            InlineKeyboardButton(text='⛏️ Играть', web_app=WebAppInfo(url=WEBAPP_URL))
        ]])
        await message.answer(
            f'⛏️ Добро пожаловать, <b>{user.first_name}</b>!\n\n'
            '🪙 Копай монеты · 🥈 Серебро · 🏅 Золото · 💎 TON\n\n'
            'Стартовый бонус уже на счету!',
            reply_markup=kb, parse_mode='HTML'
        )

    # ── /help ──
    @router.message(Command('help'))
    async def cmd_help(message: Message):
        await message.answer(
            '📖 <b>Gifts Tycoon — помощь</b>\n\n'
            '⛏️ Шахтёр автоматически добывает монеты\n'
            '🚡 Лифт поднимает монеты наверх\n'
            '🚂 Поезд везёт монеты на склад\n'
            '⚗️ Кузница: 8🪙→1🥈 / 4🥈→1🏅\n\n'
            '🛒 Магазин: бусты за Stars\n'
            '🎁 Ежедневная награда в Кузнице\n'
            '👥 /referral — пригласи друзей',
            parse_mode='HTML'
        )

    # ── /referral ──
    @router.message(Command('referral'))
    async def cmd_referral(message: Message):
        user    = message.from_user
        bot_me  = await bot.get_me()
        ref_link = f'https://t.me/{bot_me.username}?start={user.id}'
        conn   = get_db()
        count  = conn.execute('SELECT COUNT(*) FROM users WHERE referred_by=?', (user.id,)).fetchone()[0]
        conn.close()
        bonus  = min(count, 10) * 20
        ref_type   = get_setting('ref_reward_type',   'silver')
        ref_amount = int(get_setting('ref_reward_amount', '1'))
        icon   = {'normal': '🪙', 'silver': '🥈', 'gold': '🏅'}.get(ref_type, '🥈')
        await message.answer(
            f'👥 <b>Реферальная ссылка:</b>\n<code>{ref_link}</code>\n\n'
            f'Рефералов: <b>{count}</b> | Бонус склада: +{bonus} мест\n\n'
            f'За каждого реферала: <b>+{ref_amount} {icon}</b>',
            parse_mode='HTML'
        )

    # ── PRE-CHECKOUT ──
    @router.pre_checkout_query()
    async def pre_checkout(query: types.PreCheckoutQuery):
        # Always confirm — actual validation done in successful_payment
        await query.answer(ok=True)

    # ── SUCCESSFUL PAYMENT (Telegram webhook) ──
    @router.message(lambda m: m.successful_payment is not None)
    async def payment_received(message: Message):
        payment = message.successful_payment
        user_id = message.from_user.id
        stars   = payment.total_amount
        payload = payment.invoice_payload  # e.g. 'deposit_123_abc' or 'boost_123_abc'

        log.info(f'Payment received: user={user_id} stars={stars} payload={payload}')

        parts      = payload.split('_', 2)
        ptype      = parts[0] if len(parts) >= 1 else 'unknown'
        invoice_id = parts[2] if len(parts) >= 3 else None

        if invoice_id:
            # Mark invoice as paid in DB so /api/check-invoice can confirm
            conn = get_db()
            conn.execute('UPDATE pending_invoices SET paid=1 WHERE invoice_id=?', (invoice_id,))
            conn.commit(); conn.close()

        if ptype == 'deposit':
            normal_gain = stars * 10
            silver_gain = stars
            adjust_coins(user_id, normal=normal_gain, silver=silver_gain,
                         transaction_type='deposit', notes=f'Stars: {stars}')
            await message.answer(
                f'✅ <b>Пополнение успешно!</b>\n\n'
                f'⭐ Stars: {stars}\n'
                f'🪙 +{normal_gain} обычных\n'
                f'🥈 +{silver_gain} серебряных\n\n'
                f'Монеты уже на вашем счету в игре!',
                parse_mode='HTML'
            )

        elif ptype == 'boost':
            conn    = get_db()
            inv_row = conn.execute(
                'SELECT boost_pct,boost_hours FROM pending_invoices WHERE invoice_id=?', (invoice_id,)
            ).fetchone() if invoice_id else None
            conn.close()
            boost_pct   = inv_row[0] if inv_row else 0.1
            boost_hours = inv_row[1] if inv_row else 1
            pct_str = int(boost_pct * 100)
            await message.answer(
                f'⚡ <b>Буст активирован!</b>\n\n'
                f'+{pct_str}% к доходу на {boost_hours} час(а)\n\n'
                f'Откройте игру — буст уже применён!',
                parse_mode='HTML'
            )

        else:
            await message.answer('✅ Платёж получен!')

    # ── /stats (admin) ──
    @router.message(Command('stats'))
    async def cmd_stats(message: Message):
        if message.from_user.id not in ADMIN_IDS:
            return
        conn    = get_db()
        total   = conn.execute('SELECT COUNT(*) FROM users').fetchone()[0]
        new_24h = conn.execute("SELECT COUNT(*) FROM users WHERE created_at>datetime('now','-1 day')").fetchone()[0]
        dau     = conn.execute("SELECT COUNT(*) FROM users WHERE last_seen >datetime('now','-1 day')").fetchone()[0]
        pend_wd = conn.execute("SELECT COUNT(*) FROM withdrawals WHERE status='pending'").fetchone()[0]
        stars_r = conn.execute("SELECT COALESCE(SUM(stars),0) FROM pending_invoices WHERE paid=1").fetchone()[0]
        conn.close()
        await message.answer(
            f'📊 <b>Статистика</b>\n\n'
            f'👥 Всего: {total}\n'
            f'🆕 Новых 24ч: {new_24h}\n'
            f'📈 DAU: {dau}\n'
            f'⏳ Вывод pending: {pend_wd}\n'
            f'⭐ Stars выручка: {stars_r}',
            parse_mode='HTML'
        )

    # ── /give (admin) ──
    @router.message(Command('give'))
    async def cmd_give(message: Message):
        if message.from_user.id not in ADMIN_IDS:
            return
        parts = message.text.split()
        if len(parts) < 3:
            await message.answer('Формат: /give <user_id> <normal> [silver] [gold]')
            return
        tid    = int(parts[1])
        normal = float(parts[2]) if len(parts) > 2 else 0
        silver = float(parts[3]) if len(parts) > 3 else 0
        gold   = float(parts[4]) if len(parts) > 4 else 0
        get_or_create_user(tid)
        adjust_coins(tid, normal, silver, gold, 'admin_give', f'bot give by {message.from_user.id}')
        await message.answer(f'✅ Начислено {tid}: 🪙{normal} 🥈{silver} 🏅{gold}')

    # ── /happyhour (admin) ──
    @router.message(Command('happyhour'))
    async def cmd_happy_hour(message: Message):
        if message.from_user.id not in ADMIN_IDS:
            return
        args     = message.text.split()
        duration = int(args[1]) if len(args) > 1 else 60
        ends_at  = datetime.now() + timedelta(minutes=duration)
        conn = get_db()
        conn.execute('INSERT INTO happy_hours (started_by,ends_at) VALUES (?,?)',
                     (message.from_user.id, ends_at))
        conn.commit(); conn.close()
        await message.answer(
            f'⚡ <b>Счастливый час!</b>\n\nДлительность: {duration} мин\nДо: {ends_at.strftime("%H:%M")}',
            parse_mode='HTML'
        )

    # ── /promo (admin) ──
    @router.message(Command('promo'))
    async def cmd_promo(message: Message):
        if message.from_user.id not in ADMIN_IDS:
            return
        # /promo CODE USES NORMAL SILVER GOLD
        parts = message.text.split()
        if len(parts) < 6:
            await message.answer('Формат: /promo <CODE> <uses> <normal> <silver> <gold>')
            return
        code   = parts[1].upper()
        uses   = int(parts[2])
        normal = int(parts[3])
        silver = int(parts[4])
        gold   = int(parts[5])
        conn = get_db()
        try:
            conn.execute(
                'INSERT INTO promo_codes (code,uses_max,normal,silver,gold,created_by) VALUES (?,?,?,?,?,?)',
                (code, uses, normal, silver, gold, message.from_user.id)
            )
            conn.commit()
            await message.answer(f'✅ Промокод <code>{code}</code> создан!\nАктиваций: {uses} | 🪙{normal} 🥈{silver} 🏅{gold}',
                                 parse_mode='HTML')
        except sqlite3.IntegrityError:
            await message.answer('❌ Промокод уже существует')
        finally:
            conn.close()

    async def setup_bot():
        await bot.set_my_commands([
            BotCommand(command='start',      description='Начать игру'),
            BotCommand(command='help',       description='Помощь'),
            BotCommand(command='referral',   description='Реферальная ссылка'),
        ])
        try:
            await bot.set_chat_menu_button(
                menu_button=MenuButtonWebApp(
                    text='⛏️ Играть',
                    web_app=WebAppInfo(url=WEBAPP_URL)
                )
            )
        except Exception:
            pass
        me = await bot.get_me()
        log.info(f'Bot ready: @{me.username}')

    async def run_bot():
        await setup_bot()
        await dp.start_polling(bot, skip_updates=True)

except ImportError:
    log.error('aiogram not installed. Run: pip install aiogram')
    async def run_bot():
        pass


# ─────────────────────────── ENTRY POINT ────────────────────────

if __name__ == '__main__':
    import sys
    init_db()
    mode = sys.argv[1] if len(sys.argv) > 1 else 'both'

    if mode == 'bot':
        asyncio.run(run_bot())

    elif mode == 'server':
        try:
            uvicorn.run(app, host='0.0.0.0', port=8000)
        except NameError:
            log.error('Install: pip install fastapi uvicorn')

    else:
        async def run_all():
            bot_task = asyncio.create_task(run_bot())
            try:
                config  = uvicorn.Config(app, host='0.0.0.0', port=8000)
                server  = uvicorn.Server(config)
                srv_task = asyncio.create_task(server.serve())
                await asyncio.gather(bot_task, srv_task)
            except (NameError, ImportError):
                await bot_task

        asyncio.run(run_all())
