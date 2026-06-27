const express = require('express');
const fetch = require('node-fetch');
const admin = require('firebase-admin');

const app = express();
app.use(express.json());

// Firebase Setup
const serviceAccount = require('./serviceAccount.json'); // Download from Firebase Console
admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
    databaseURL: 'https://smmhub-1e20c-default-rtdb.firebaseio.com'
});
const db = admin.database();

// Bot Configuration
const BOT_TOKEN = '8850279766:AAG5dHzrgGJQgr6FVrKmRopqn-1wAbWjrBc';
const WEBHOOK_URL = process.env.WEBHOOK_URL || 'https://your-render-url.onrender.com';
const PORT = process.env.PORT || 3000;

// Mini App URLs
const USER_MINI_APP = 'https://your-domain.com/index.html';
const ADMIN_PANEL_URL = 'https://your-domain.com/admin.html';

// ===================== TELEGRAM API HELPERS =====================
async function sendMessage(chatId, text, options = {}) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;
    const data = {
        chat_id: chatId,
        text,
        parse_mode: 'Markdown',
        ...options
    };
    try {
        const res = await fetch(url, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
        return res.json();
    } catch (e) {
        console.error('Send message error:', e);
    }
}

async function editMessage(chatId, messageId, text, options = {}) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/editMessageText`;
    const data = { chat_id: chatId, message_id: messageId, text, parse_mode: 'Markdown', ...options };
    try {
        const res = await fetch(url, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
        return res.json();
    } catch (e) {
        console.error('Edit message error:', e);
    }
}

async function answerCallbackQuery(callbackQueryId, notification = '', alert = false) {
    const url = `https://api.telegram.org/bot${BOT_TOKEN}/answerCallbackQuery`;
    const data = { callback_query_id: callbackQueryId, text: notification, show_alert: alert };
    try {
        await fetch(url, { method: 'POST', body: JSON.stringify(data), headers: { 'Content-Type': 'application/json' } });
    } catch (e) {}
}

// ===================== KEYBOARD BUILDERS =====================
function mainMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '🚀 Open User Panel', web_app: { url: USER_MINI_APP } }],
            [{ text: '📊 My Orders', callback_data: 'orders' }, { text: '💰 My Balance', callback_data: 'balance' }],
            [{ text: '🎁 Refer & Earn', callback_data: 'referral' }, { text: '⚙️ Settings', callback_data: 'settings' }],
            [{ text: '💬 Support', callback_data: 'support' }]
        ]
    };
}

function adminMenuKeyboard() {
    return {
        inline_keyboard: [
            [{ text: '⚙️ Open Admin Panel', web_app: { url: ADMIN_PANEL_URL } }],
            [{ text: '📈 API Status', callback_data: 'api_status' }, { text: '👥 Users Count', callback_data: 'users_count' }],
            [{ text: '📣 Broadcast', callback_data: 'broadcast_menu' }, { text: '🔄 Orders Stats', callback_data: 'orders_stats' }],
            [{ text: '🔧 Settings', callback_data: 'admin_settings' }]
        ]
    };
}

// ===================== API STATUS CHECK =====================
async function checkAPIStatus(apiUrl, apiKey) {
    try {
        const res = await fetch(apiUrl, {
            method: 'POST',
            body: new URLSearchParams({ key: apiKey, action: 'balance' })
        });
        const data = await res.json();
        return { online: !!data, data };
    } catch (e) {
        return { online: false, data: { error: e.message } };
    }
}

// ===================== WEBHOOK HANDLER =====================
app.post('/webhook', async (req, res) => {
    const update = req.body;

    // Message Handler
    if (update.message) {
        const msg = update.message;
        const chatId = msg.chat.id;
        const text = msg.text || '';
        const userId = msg.from.id;
        const username = msg.from.username || `user_${userId}`;
        const firstName = msg.from.first_name || '';

        // Save/update user in Firebase
        await db.ref(`users/${chatId}`).update({
            chatId,
            username,
            firstName,
            lastActive: Date.now(),
            isGuest: false
        });

        // Commands
        if (text === '/start') {
            const settings = await db.ref('settings').once('value').then(s => s.val() || {});
            const isAdmin = chatId == settings.adminChatId || chatId == settings.admin2ChatId;

            const welcome = isAdmin 
                ? `🔐 *Welcome Admin*\n\n${firstName}, you have admin access.\n\nChoose an action:`
                : `👋 *Welcome to Fire SMM*\n\n${firstName}, tap below to open your panel or manage your account.`;

            await sendMessage(chatId, welcome, {
                reply_markup: isAdmin ? adminMenuKeyboard() : mainMenuKeyboard()
            });
        } else if (text === '/help') {
            await sendMessage(chatId, `ℹ️ *Fire SMM Help*\n\n` +
                `🚀 /start - Main menu\n` +
                `💰 /balance - Check balance\n` +
                `📊 /orders - View orders\n` +
                `🎁 /ref - Get referral code\n` +
                `💬 /support - Contact support\n` +
                `⚙️ /settings - Manage settings`);
        } else if (text === '/balance' || text.startsWith('/balance')) {
            const userSnap = await db.ref(`users/${chatId}`).once('value');
            const user = userSnap.val() || {};
            await sendMessage(chatId, `💰 *Your Balance*\n\n₹${(user.balance || 0).toFixed(2)}\n\n[Open Wallet](${USER_MINI_APP}?tab=wallet)`);
        } else if (text === '/ref' || text.startsWith('/ref')) {
            const refCode = `REF${String(chatId).slice(-6).toUpperCase()}`;
            await sendMessage(chatId, `🎁 *Your Referral Code*\n\n\`${refCode}\`\n\nShare to earn 10-15% commission on every purchase your referrals make!`);
        } else if (text.startsWith('/order ')) {
            const service = text.replace('/order ', '').toLowerCase();
            await sendMessage(chatId, `📦 Quick Order for: ${service}\n\n[Open Panel to Order](${USER_MINI_APP}?search=${service})`);
        }
    }

    // Callback Query Handler (Button Clicks)
    if (update.callback_query) {
        const query = update.callback_query;
        const chatId = query.from.id;
        const data = query.data;

        await answerCallbackQuery(query.id);

        try {
            if (data === 'balance') {
                const userSnap = await db.ref(`users/${chatId}`).once('value');
                const user = userSnap.val() || {};
                await sendMessage(chatId, `💰 *Balance: ₹${(user.balance || 0).toFixed(2)}*\n\n[Add Money](${USER_MINI_APP}?tab=wallet)`);
            }

            else if (data === 'orders') {
                const ordersSnap = await db.ref('orders').orderByChild('userId').equalTo(String(chatId)).once('value');
                const orders = ordersSnap.val() || {};
                const count = Object.keys(orders).length;
                await sendMessage(chatId, `📊 *Your Orders*\n\nTotal: ${count}\n\n[View All](${USER_MINI_APP}?tab=history)`);
            }

            else if (data === 'referral') {
                const refCode = `REF${String(chatId).slice(-6).toUpperCase()}`;
                await sendMessage(chatId, `🎁 *Referral Code: \`${refCode}\`*\n\nEarn ₹${10}-₹15 per referral!\n\n[See Referral Dashboard](${USER_MINI_APP}?tab=referral)`);
            }

            else if (data === 'api_status') {
                const settings = await db.ref('settings').once('value').then(s => s.val() || {});
                const status = await checkAPIStatus(settings.smmApiUrl, settings.smmApiKey);
                const statusText = status.online ? '✅ *Online*' : '❌ *Offline*';
                await sendMessage(chatId, `🔌 *API Status*\n\n${statusText}\n\n[Admin Panel](${ADMIN_PANEL_URL})`);
            }

            else if (data === 'users_count') {
                const usersSnap = await db.ref('users').once('value');
                const userCount = Object.keys(usersSnap.val() || {}).length;
                await sendMessage(chatId, `👥 *Total Users: ${userCount}*\n\n[Admin Panel](${ADMIN_PANEL_URL})`);
            }

            else if (data === 'orders_stats') {
                const ordersSnap = await db.ref('orders').once('value');
                const orders = ordersSnap.val() || {};
                const totalRevenue = Object.values(orders).reduce((s, o) => s + Number(o.cost || 0), 0);
                await sendMessage(chatId, `📈 *Orders Stats*\n\nTotal Orders: ${Object.keys(orders).length}\nRevenue: ₹${totalRevenue.toFixed(2)}\n\n[Admin Panel](${ADMIN_PANEL_URL})`);
            }

            else if (data === 'settings') {
                await sendMessage(chatId, `⚙️ *Settings*\n\nManage your preferences in the app or admin panel.\n\n[Open Settings](${USER_MINI_APP}?tab=profile)`);
            }

            else if (data === 'support') {
                await sendMessage(chatId, `💬 *Support*\n\nMessage us anytime. Our team will respond shortly.\n\n[Open Chat](${USER_MINI_APP}?tab=support)`);
            }
        } catch (e) {
            console.error('Callback query error:', e);
            await sendMessage(chatId, '❌ Error processing request');
        }
    }

    res.json({ ok: true });
});

// ===================== HEALTH CHECK =====================
app.get('/', (req, res) => {
    res.json({ status: 'Fire SMM Bot Running', timestamp: new Date().toISOString() });
});

// ===================== START SERVER =====================
app.listen(PORT, async () => {
    console.log(`✅ Bot server running on port ${PORT}`);
    
    // Set webhook
    try {
        const webhookUrl = `${WEBHOOK_URL}/webhook`;
        const setWebhookRes = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/setWebhook`, {
            method: 'POST',
            body: JSON.stringify({ url: webhookUrl }),
            headers: { 'Content-Type': 'application/json' }
        });
        const webhookResult = await setWebhookRes.json();
        console.log('✅ Webhook set:', webhookResult.ok ? 'Success' : 'Failed');
    } catch (e) {
        console.error('⚠️ Webhook setup error:', e.message);
    }
});
