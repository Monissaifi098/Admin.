/**
 * Fire SMM — Admin Telegram Bot
 * --------------------------------
 * Kaam:
 *  - Sirf 2 admin (settings/adminChatId & admin2ChatId) hi bot use kar sakte hai
 *  - "Open Admin Panel" button se Mini App seedha launch hoga (auto-login already admin.html me hai)
 *  - Naya order / naya pending payment / naya user — auto notification admin ko
 *  - Bot ke andar hi: Dashboard, Pending Orders, Pending Payments, API Balance, API Test
 *
 * Deploy: Render (Web Service) — start command: node index.js
 */

const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// ===================== CONFIG =====================
// Bot token same use kiya jo tumhare admin.html/Firebase settings me already hai.
// Naya/alag token chahiye to Render env var BOT_TOKEN me daal dena, ye usko override kar lega.
const BOT_TOKEN = process.env.BOT_TOKEN || '8850279766:AAG5dHzrgGJQgr6FVrKmRopqn-1wAbWjrBc';

// Firebase Realtime DB (same as admin.html)
const FIREBASE_URL = process.env.FIREBASE_URL || 'https://smmhub-1e20c-default-rtdb.firebaseio.com';

const ADMIN_PANEL_URL = process.env.ADMIN_PANEL_URL || 'https://smmhu.netlify.app/admin.html';

const PORT = process.env.PORT || 3000;
const POLL_INTERVAL_MS = 20000; // 20 sec me Firebase check karega naye events ke liye

// ===================== KEEP-ALIVE SERVER (Render ke liye zaroori) =====================
const app = express();
app.get('/', (req, res) => res.send('🔥 Fire SMM Admin Bot is running'));
app.listen(PORT, () => console.log('✅ Server listening on port', PORT));

// ===================== BOT INIT =====================
const bot = new TelegramBot(BOT_TOKEN, { polling: true });
bot.on('polling_error', (err) => console.error('Polling error:', err.message));

// ===================== FIREBASE HELPERS =====================
async function fbGet(path) {
    const res = await fetch(`${FIREBASE_URL}/${path}.json`);
    if (!res.ok) throw new Error('Firebase GET failed: ' + res.status);
    return res.json();
}
async function fbPatch(path, data) {
    const res = await fetch(`${FIREBASE_URL}/${path}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    return res.json();
}

let settingsCache = {};
let adminIds = [];

async function refreshSettings() {
    try {
        const s = await fbGet('settings');
        settingsCache = s || {};
        adminIds = [String(s.adminChatId || ''), String(s.admin2ChatId || '')].filter(Boolean);
    } catch (e) {
        console.error('Settings fetch failed:', e.message);
    }
}

function isAdmin(chatId) {
    return adminIds.includes(String(chatId));
}

function fmtMoney(n) { return '₹' + Number(n || 0).toFixed(2); }

// ===================== KEYBOARDS =====================
function mainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🚀 Open Admin Panel', web_app: { url: ADMIN_PANEL_URL } }],
            [{ text: '📊 Dashboard', callback_data: 'dashboard' }],
            [
                { text: '📋 Pending Orders', callback_data: 'pending_orders' },
                { text: '💳 Pending Payments', callback_data: 'pending_deposits' }
            ],
            [
                { text: '💰 API Balance', callback_data: 'api_balance' },
                { text: '🧪 Test API', callback_data: 'api_test' }
            ]
        ]
    };
}
function openPanelKeyboard() {
    return { inline_keyboard: [[{ text: '🚀 Open Admin Panel', web_app: { url: ADMIN_PANEL_URL } }]] };
}

// ===================== COMMANDS =====================
bot.onText(/\/start|\/menu/, async (msg) => {
    const chatId = msg.chat.id;
    await refreshSettings();
    if (!isAdmin(chatId)) {
        return bot.sendMessage(chatId, '❌ Aap authorized admin nahi ho. Access denied.');
    }
    bot.sendMessage(chatId,
        `👋 *Welcome Admin!*\n\n🔥 Fire SMM — Admin Control Bot\n\nNeeche se koi bhi action use karo 👇`,
        { parse_mode: 'Markdown', reply_markup: mainMenuKeyboard() }
    );
});

bot.on('callback_query', async (query) => {
    const chatId = query.message.chat.id;
    await refreshSettings();
    if (!isAdmin(chatId)) {
        return bot.answerCallbackQuery(query.id, { text: '❌ Not authorized', show_alert: true });
    }
    bot.answerCallbackQuery(query.id).catch(() => {});

    switch (query.data) {
        case 'dashboard': return sendDashboard(chatId);
        case 'pending_orders': return sendPendingOrders(chatId);
        case 'pending_deposits': return sendPendingDeposits(chatId);
        case 'api_balance': return sendApiBalance(chatId);
        case 'api_test': return sendApiTest(chatId);
    }
});

// ===================== FEATURES =====================
async function sendDashboard(chatId) {
    try {
        const [orders, deposits, users] = await Promise.all([fbGet('orders'), fbGet('deposits'), fbGet('users')]);
        const ordersArr = Object.values(orders || {});
        const depositsArr = Object.values(deposits || {});
        const usersArr = Object.values(users || {});

        const pendingOrders = ordersArr.filter(o => o.status === 'pending' || o.status === 'processing').length;
        const pendingDeposits = depositsArr.filter(d => d.status === 'pending').length;
        const totalUsers = usersArr.filter(u => u.isGuest !== true).length;
        const totalRevenue = depositsArr.filter(d => d.status === 'approved').reduce((s, d) => s + Number(d.amount || 0), 0);
        const todayStr = new Date().toDateString();
        const todayOrders = ordersArr.filter(o => new Date(o.createdAt || 0).toDateString() === todayStr).length;

        bot.sendMessage(chatId,
            `📊 *Dashboard*\n\n` +
            `👥 Total Users: *${totalUsers}*\n` +
            `📦 Pending Orders: *${pendingOrders}*\n` +
            `💳 Pending Payments: *${pendingDeposits}*\n` +
            `💰 Total Revenue: *${fmtMoney(totalRevenue)}*\n` +
            `🛒 Today's Orders: *${todayOrders}*`,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        bot.sendMessage(chatId, '❌ Dashboard load failed: ' + e.message);
    }
}

async function sendPendingOrders(chatId) {
    try {
        const orders = await fbGet('orders');
        const entries = Object.entries(orders || {}).filter(([, o]) => o.status === 'pending' || o.status === 'processing');
        if (!entries.length) return bot.sendMessage(chatId, '✅ Koi pending order nahi hai.');

        let text = `📋 *Pending Orders (${entries.length})*\n\n`;
        entries.slice(0, 15).forEach(([id, o]) => {
            text += `🆔 \`${id.slice(-6)}\`\n👤 @${o.username || '-'}\n📦 ${(o.serviceLabel || '-').slice(0, 40)}\n💵 ${fmtMoney(o.cost)} | Qty: ${o.quantity || '-'}\n\n`;
        });
        if (entries.length > 15) text += `...aur ${entries.length - 15} order(s) admin panel me dekho.`;
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: openPanelKeyboard() });
    } catch (e) {
        bot.sendMessage(chatId, '❌ Orders load failed: ' + e.message);
    }
}

async function sendPendingDeposits(chatId) {
    try {
        const deposits = await fbGet('deposits');
        const entries = Object.entries(deposits || {}).filter(([, d]) => d.status === 'pending');
        if (!entries.length) return bot.sendMessage(chatId, '✅ Koi pending payment nahi hai.');

        let text = `💳 *Pending Payments (${entries.length})*\n\n`;
        entries.slice(0, 15).forEach(([id, d]) => {
            text += `👤 @${d.username || '-'}\n💵 ${fmtMoney(d.amount)}\n🔖 UTR: \`${d.utr || '-'}\`\n\n`;
        });
        text += `👉 Approve/Reject karne ke liye Admin Panel kholo.`;
        bot.sendMessage(chatId, text, { parse_mode: 'Markdown', reply_markup: openPanelKeyboard() });
    } catch (e) {
        bot.sendMessage(chatId, '❌ Payments load failed: ' + e.message);
    }
}

async function sendApiBalance(chatId) {
    await refreshSettings();
    const { smmApiUrl: url, smmApiKey: key } = settingsCache;
    if (!url || !key) return bot.sendMessage(chatId, '⚠️ SMM API URL/Key Settings me configure nahi hai.');
    bot.sendMessage(chatId, '⏳ Checking balance...');
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ key, action: 'balance' })
        });
        const text = await res.text();
        let data;
        try { data = JSON.parse(text); } catch { data = null; }

        if (data && data.balance !== undefined) {
            bot.sendMessage(chatId, `💰 *API Balance*\n\n${data.balance} ${data.currency || ''}`, { parse_mode: 'Markdown' });
        } else {
            bot.sendMessage(chatId, `📄 Raw Response:\n\`${text.slice(0, 300)}\``, { parse_mode: 'Markdown' });
        }
    } catch (e) {
        bot.sendMessage(chatId, '❌ Balance fetch failed: ' + e.message);
    }
}

async function sendApiTest(chatId) {
    await refreshSettings();
    const { smmApiUrl: url, smmApiKey: key } = settingsCache;
    if (!url || !key) return bot.sendMessage(chatId, '⚠️ SMM API URL/Key Settings me configure nahi hai.');
    bot.sendMessage(chatId, '⏳ Testing API connection...');
    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ key, action: 'balance' })
        });
        const text = await res.text();
        bot.sendMessage(chatId,
            `✅ *API Reachable* (status ${res.status})\n\n\`${text.slice(0, 300)}\``,
            { parse_mode: 'Markdown' }
        );
    } catch (e) {
        bot.sendMessage(chatId, '❌ *API Test Failed*\n' + e.message, { parse_mode: 'Markdown' });
    }
}

// ===================== AUTO NOTIFICATIONS (poll-based) =====================
let lastCheck = { orders: 0, deposits: 0, users: 0 };

async function loadLastCheck() {
    try {
        const saved = await fbGet('botState/adminBotLastCheck');
        lastCheck = saved ? { ...lastCheck, ...saved } : { orders: Date.now(), deposits: Date.now(), users: Date.now() };
    } catch {
        lastCheck = { orders: Date.now(), deposits: Date.now(), users: Date.now() };
    }
}
async function saveLastCheck() {
    fbPatch('botState/adminBotLastCheck', lastCheck).catch(() => {});
}

async function notifyAdmins(text, extra) {
    for (const id of adminIds) {
        try { await bot.sendMessage(id, text, { parse_mode: 'Markdown', ...(extra || {}) }); } catch (e) { /* admin ne bot start nahi kiya hoga */ }
    }
}

async function pollForEvents() {
    await refreshSettings();
    if (!adminIds.length) return;
    try {
        const [orders, deposits, users] = await Promise.all([fbGet('orders'), fbGet('deposits'), fbGet('users')]);

        Object.entries(orders || {}).forEach(([id, o]) => {
            if ((o.createdAt || 0) > lastCheck.orders) {
                notifyAdmins(
                    `🛒 *New Order Placed*\n👤 @${o.username || '-'}\n📦 ${(o.serviceLabel || '-').slice(0, 40)}\n💵 ${fmtMoney(o.cost)} | Qty: ${o.quantity || '-'}\nStatus: ${o.status || 'pending'}`,
                    { reply_markup: openPanelKeyboard() }
                );
            }
        });

        Object.entries(deposits || {}).forEach(([id, d]) => {
            if ((d.createdAt || 0) > lastCheck.deposits && d.status === 'pending') {
                notifyAdmins(
                    `💳 *New Payment Request*\n👤 @${d.username || '-'}\n💵 ${fmtMoney(d.amount)}\n🔖 UTR: \`${d.utr || '-'}\`\n\n👉 Approve karne ke liye Admin Panel kholo`,
                    { reply_markup: openPanelKeyboard() }
                );
            }
        });

        Object.entries(users || {}).forEach(([id, u]) => {
            if ((u.createdAt || 0) > lastCheck.users && u.isGuest !== true) {
                notifyAdmins(`👤 *New User Joined*\n@${u.username || '-'}\nChat ID: \`${id}\``);
            }
        });

        const now = Date.now();
        lastCheck = { orders: now, deposits: now, users: now };
        await saveLastCheck();
    } catch (e) {
        console.error('Poll error:', e.message);
    }
}

// ===================== BOOT =====================
(async () => {
    await refreshSettings();
    await loadLastCheck();
    console.log('✅ Fire SMM Admin Bot started. Admins:', adminIds);
    setInterval(pollForEvents, POLL_INTERVAL_MS);
    setInterval(refreshSettings, 60000);
})();
