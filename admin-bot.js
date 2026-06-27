const express = require('express');
const TelegramBot = require('node-telegram-bot-api');

// ===================== CONFIG =====================
const ADMIN_BOT_TOKEN = process.env.ADMIN_BOT_TOKEN || '8850279766:AAG5dHzrgGJQgr6FVrKmRopqn-1wAbWjrBc';
const WEBHOOK_URL = process.env.WEBHOOK_URL || ''; // e.g. https://your-app.up.railway.app
const ADMIN_PANEL_URL = process.env.ADMIN_PANEL_URL || 'https://smmhu.netlify.app/admin.html';
const FIREBASE_DB_URL = process.env.FIREBASE_DB_URL || 'https://smmhub-1e20c-default-rtdb.firebaseio.com';
const ADMIN_CHAT_ID = process.env.ADMIN_CHAT_ID || '6270522295';
const PORT = process.env.PORT || 3001;

const adminBot = new TelegramBot(ADMIN_BOT_TOKEN);
const app = express();
app.use(express.json());

// ===================== FIREBASE REST HELPERS =====================
async function fbGet(path) {
    const r = await fetch(`${FIREBASE_DB_URL}/${path}.json`);
    if (!r.ok) return null;
    return r.json();
}

async function fbSet(path, data) {
    await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
}

async function fbUpdate(path, data) {
    await fetch(`${FIREBASE_DB_URL}/${path}.json`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
}

// ===================== IN-MEMORY STATE =====================
const adminState = {};

// ===================== ADMIN KEYBOARD =====================
function adminMainKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [{ text: '📊 Dashboard' }, { text: '🔐 Admin Panel' }],
                [{ text: '💳 Deposits' }, { text: '📦 Orders' }],
                [{ text: '👥 Users' }, { text: '⚙️ Settings' }],
                [{ text: '🔌 API Status' }]
            ],
            resize_keyboard: true
        }
    };
}

function homeKeyboard() {
    return {
        reply_markup: {
            keyboard: [
                [{ text: '🏠 Back' }]
            ],
            resize_keyboard: true
        }
    };
}

// ===================== HELPER FUNCTIONS =====================

async function getDashboardStats() {
    try {
        const users = (await fbGet('users')) || {};
        const deposits = (await fbGet('deposits')) || {};
        const orders = (await fbGet('orders')) || {};
        
        const totalUsers = Object.keys(users).length;
        const newUsers = Object.values(users).filter(u => {
            const dayOld = Date.now() - (24 * 60 * 60 * 1000);
            return u.createdAt > dayOld;
        }).length;
        
        const pendingDeposits = Object.values(deposits).filter(d => d.status === 'pending').length;
        const totalBalance = Object.values(users).reduce((sum, u) => sum + (u.balance || 0), 0);
        
        const pendingOrders = Object.values(orders).filter(o => o.status === 'pending').length;
        const completedOrders = Object.values(orders).filter(o => o.status === 'completed').length;
        
        return {
            totalUsers,
            newUsers,
            totalBalance,
            pendingDeposits,
            pendingOrders,
            completedOrders
        };
    } catch (e) {
        console.error('Dashboard stats error:', e);
        return {};
    }
}

async function getDepositsList(limit = 10) {
    try {
        const deposits = (await fbGet('deposits')) || {};
        return Object.entries(deposits)
            .map(([key, val]) => ({ id: key, ...val }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, limit);
    } catch (e) {
        console.error('Deposits list error:', e);
        return [];
    }
}

async function getOrdersList(limit = 10) {
    try {
        const orders = (await fbGet('orders')) || {};
        return Object.entries(orders)
            .map(([key, val]) => ({ id: key, ...val }))
            .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
            .slice(0, limit);
    } catch (e) {
        console.error('Orders list error:', e);
        return [];
    }
}

async function checkAPIStatus() {
    try {
        const startTime = Date.now();
        const response = await fetch(`${FIREBASE_DB_URL}/.json`, { method: 'GET' });
        const latency = Date.now() - startTime;
        return {
            status: response.ok ? '✅ ONLINE' : '❌ OFFLINE',
            latency: `${latency}ms`,
            timestamp: new Date().toLocaleString('en-IN')
        };
    } catch (e) {
        return {
            status: '❌ OFFLINE',
            latency: 'N/A',
            error: e.message,
            timestamp: new Date().toLocaleString('en-IN')
        };
    }
}

// ===================== /start COMMAND =====================
adminBot.onText(/\/start/, async (msg) => {
    const chatId = String(msg.chat.id);
    
    // Only admin can use this bot
    if (chatId !== ADMIN_CHAT_ID) {
        adminBot.sendMessage(chatId, '🔐 *Unauthorized Access*\n\nYou are not authorized to use this bot.', 
            { parse_mode: 'Markdown' });
        return;
    }
    
    adminBot.sendMessage(chatId, 
        '👑 *Admin Bot - Welcome!*\n\nSelect an option below to manage your SMM Panel:',
        adminMainKeyboard());
});

// ===================== MESSAGE ROUTER =====================
adminBot.on('message', async (msg) => {
    if (!msg.text || msg.text.startsWith('/start')) return;
    
    const chatId = String(msg.chat.id);
    const text = msg.text.trim();
    
    // Check auth
    if (chatId !== ADMIN_CHAT_ID) {
        adminBot.sendMessage(chatId, '🔐 Unauthorized');
        return;
    }
    
    try {
        // ---- HOME ----
        if (text === '🏠 Back') {
            adminBot.sendMessage(chatId, 'Menu ko select karo:', adminMainKeyboard());
            return;
        }
        
        // ---- DASHBOARD ----
        if (text === '📊 Dashboard') {
            const stats = await getDashboardStats();
            const message = `
📊 *Dashboard Statistics*

👥 *Users:*
  • Total Users: ${stats.totalUsers || 0}
  • New Users (24h): ${stats.newUsers || 0}

💰 *Wallet:*
  • Total Balance: ₹${(stats.totalBalance || 0).toFixed(2)}

💳 *Deposits:*
  • Pending Verification: ${stats.pendingDeposits || 0}

📦 *Orders:*
  • Pending: ${stats.pendingOrders || 0}
  • Completed: ${stats.completedOrders || 0}

⏰ Updated: ${new Date().toLocaleString('en-IN')}
`;
            adminBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return;
        }
        
        // ---- ADMIN PANEL ----
        if (text === '🔐 Admin Panel') {
            adminBot.sendMessage(chatId, 
                `🔐 *Admin Panel Access*\n\nClick button below to open full admin panel:\n\n🔗 ${ADMIN_PANEL_URL}`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: {
                        inline_keyboard: [[
                            { text: '📱 Open Admin Panel', web_app: { url: ADMIN_PANEL_URL } }
                        ]]
                    }
                });
            return;
        }
        
        // ---- DEPOSITS ----
        if (text === '💳 Deposits') {
            const deposits = await getDepositsList(5);
            
            if (deposits.length === 0) {
                adminBot.sendMessage(chatId, 'Koi deposits pending nahi hai ✅', adminMainKeyboard());
                return;
            }
            
            const buttons = deposits
                .filter(d => d.status === 'pending')
                .map(d => [{
                    text: `✓ ${d.username} - ₹${Number(d.amount).toFixed(2)} - UTR: ${d.utr}`,
                    callback_data: `approve_deposit_${d.id}`
                }]);
            
            adminBot.sendMessage(chatId,
                `💳 *Pending Deposits* (${deposits.filter(d => d.status === 'pending').length})\n\nClick to approve:`,
                {
                    parse_mode: 'Markdown',
                    reply_markup: { inline_keyboard: buttons }
                });
            
            adminState[chatId] = { deposits };
            return;
        }
        
        // ---- ORDERS ----
        if (text === '📦 Orders') {
            const orders = await getOrdersList(5);
            
            if (orders.length === 0) {
                adminBot.sendMessage(chatId, 'Koi orders pending nahi hai ✅', adminMainKeyboard());
                return;
            }
            
            const pendingOrders = orders.filter(o => o.status === 'pending');
            
            if (pendingOrders.length === 0) {
                adminBot.sendMessage(chatId, 'Saare orders complete ho gaye ✅', adminMainKeyboard());
                return;
            }
            
            let orderText = '📦 *Pending Orders:*\n\n';
            pendingOrders.forEach(o => {
                orderText += `🔹 *Order ID:* ${o.id}\n`;
                orderText += `   User: ${o.username || 'Unknown'}\n`;
                orderText += `   Service: ${o.service || 'N/A'}\n`;
                orderText += `   Amount: ₹${Number(o.amount).toFixed(2)}\n`;
                orderText += `   Status: ⏳ Pending\n\n`;
            });
            
            adminBot.sendMessage(chatId, orderText, { parse_mode: 'Markdown' });
            return;
        }
        
        // ---- USERS ----
        if (text === '👥 Users') {
            const users = (await fbGet('users')) || {};
            const totalUsers = Object.keys(users).length;
            const activeUsers = Object.values(users).filter(u => u.balance > 0).length;
            
            const topUsers = Object.entries(users)
                .sort((a, b) => (b[1].balance || 0) - (a[1].balance || 0))
                .slice(0, 5);
            
            let userText = `👥 *Users Stats*\n\n`;
            userText += `📊 Total Users: ${totalUsers}\n`;
            userText += `💰 Active Users: ${activeUsers}\n\n`;
            userText += `*Top 5 Spenders:*\n`;
            topUsers.forEach((u, idx) => {
                userText += `${idx + 1}. ${u[1].username || u[0]} - ₹${(u[1].balance || 0).toFixed(2)}\n`;
            });
            
            adminBot.sendMessage(chatId, userText, { parse_mode: 'Markdown' });
            return;
        }
        
        // ---- SETTINGS ----
        if (text === '⚙️ Settings') {
            const settings = (await fbGet('settings')) || {};
            adminBot.sendMessage(chatId,
                `⚙️ *Settings*\n\n` +
                `UPI ID: ${settings.upiId || 'Not set'}\n` +
                `Referral Bonus: ₹${settings.referralBonus || 10}\n` +
                `Daily Reward: ₹${settings.dailyRewardAmount || 2}\n` +
                `Mini App URL: ${settings.miniAppUrl || 'Not set'}\n\n` +
                `Admin Panel URL: ${ADMIN_PANEL_URL}`,
                { parse_mode: 'Markdown' });
            return;
        }
        
        // ---- API STATUS ----
        if (text === '🔌 API Status') {
            adminBot.sendMessage(chatId, '⏳ Checking API status...');
            
            const status = await checkAPIStatus();
            const message = `
🔌 *API Status Check*

Status: ${status.status}
Latency: ${status.latency}
Timestamp: ${status.timestamp}

Firebase DB: ${FIREBASE_DB_URL}
${status.error ? `Error: ${status.error}` : ''}
`;
            adminBot.sendMessage(chatId, message, { parse_mode: 'Markdown' });
            return;
        }
        
        // Default
        adminBot.sendMessage(chatId, 'Command samajh nahi aaya. Menu select karo:', adminMainKeyboard());
        
    } catch (e) {
        console.error('Message error:', e);
        adminBot.sendMessage(chatId, `⚠️ Error: ${e.message}`);
    }
});

// ===================== CALLBACK QUERY (Inline Buttons) =====================
adminBot.on('callback_query', async (query) => {
    const chatId = String(query.message.chat.id);
    const data = query.data;
    
    if (chatId !== ADMIN_CHAT_ID) {
        adminBot.answerCallbackQuery(query.id, { text: 'Unauthorized' });
        return;
    }
    
    try {
        // ---- APPROVE DEPOSIT ----
        if (data.startsWith('approve_deposit_')) {
            const depositId = data.replace('approve_deposit_', '');
            const deposits = (await fbGet('deposits')) || {};
            const deposit = deposits[depositId];
            
            if (!deposit) {
                adminBot.answerCallbackQuery(query.id, { text: 'Deposit not found' });
                return;
            }
            
            // Update deposit status
            await fbUpdate(`deposits/${depositId}`, { status: 'approved' });
            
            // Credit user wallet
            const user = (await fbGet(`users/${deposit.userId}`)) || {};
            const newBalance = (user.balance || 0) + deposit.amount;
            await fbUpdate(`users/${deposit.userId}`, { balance: newBalance });
            
            // Send notification to user
            adminBot.sendMessage(deposit.userId,
                `✅ *Deposit Approved!*\n\nYour deposit of ₹${Number(deposit.amount).toFixed(2)} (UTR: ${deposit.utr}) has been verified and credited.\n\nNew Balance: ₹${newBalance.toFixed(2)}`,
                { parse_mode: 'Markdown' });
            
            // Feedback to admin
            adminBot.answerCallbackQuery(query.id, { text: `✅ Approved ₹${deposit.amount}` });
            adminBot.editMessageText(`✅ Approved: ${deposit.username} - ₹${Number(deposit.amount).toFixed(2)}`,
                { chat_id: chatId, message_id: query.message.message_id });
            
        }
        
    } catch (e) {
        console.error('Callback error:', e);
        adminBot.answerCallbackQuery(query.id, { text: `Error: ${e.message}` });
    }
});

// ===================== WEBHOOK SETUP =====================
if (WEBHOOK_URL) {
    adminBot.setWebHook(`${WEBHOOK_URL}/admin-bot${ADMIN_BOT_TOKEN}`);
    app.post(`/admin-bot${ADMIN_BOT_TOKEN}`, (req, res) => {
        adminBot.processUpdate(req.body);
        res.sendStatus(200);
    });
    console.log('Admin Bot Webhook mode active:', `${WEBHOOK_URL}/admin-bot${ADMIN_BOT_TOKEN}`);
} else {
    console.warn('⚠️ WEBHOOK_URL not set. Admin Bot will use polling mode.');
    adminBot.startPolling();
}

app.get('/', (req, res) => res.send('Admin Bot is running ✅'));

app.listen(PORT, () => console.log(`Admin Bot listening on port ${PORT}`));
