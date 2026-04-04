let socket;
let currentUser = null;
let currentChat = null;
let typingTimeout;

// Элементы
const authDiv = document.getElementById('auth');
const chatDiv = document.getElementById('chat');
const inputArea = document.getElementById('inputArea');
const chatTitle = document.getElementById('chatTitle');
const messagesContainer = document.getElementById('messages');

function showError(msg) {
    const errDiv = document.getElementById('authError');
    if(errDiv) errDiv.innerText = msg;
}

// ========== АВТОРИЗАЦИЯ (ИСПРАВЛЕНО) ==========
async function register() {
    const u = document.getElementById('authUsername').value.trim();
    const p = document.getElementById('authPassword').value.trim();
    if (!u || !p) return showError("Заполните все поля");

    try {
        const res = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();
        if (res.ok) loginSuccess(data.token, data.user);
        else showError(data.error);
    } catch(e) { showError("Ошибка сервера"); }
}

async function login() {
    const u = document.getElementById('authUsername').value.trim();
    const p = document.getElementById('authPassword').value.trim();
    if (!u || !p) return showError("Заполните все поля");

    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: u, password: p })
        });
        const data = await res.json();
        if (res.ok) loginSuccess(data.token, data.user);
        else showError(data.error);
    } catch(e) { showError("Ошибка сервера"); }
}

function loginSuccess(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    currentUser = user;
    authDiv.style.display = 'none';
    chatDiv.style.display = 'flex';
    inputArea.style.display = 'none';
    document.getElementById('userInfo').innerHTML = `👤 ${user.username}`;
    initSocket(token);
    loadFriends();
    initAvatarPicker();
}

function logout() {
    localStorage.clear();
    location.reload();
}

// ========== РАБОТА С ЧАТОМ ==========
function initSocket(token) {
    socket = io({ auth: { token } });
    
    socket.on('private_message', (msg) => {
        if (currentChat === msg.from || currentChat === msg.to) {
            addMessageToChat(msg);
        }
    });

    socket.on('message_deleted', (data) => {
        const el = document.querySelector(`.message[data-id="${data.messageId}"]`);
        if (el) el.remove();
    });

    socket.on('typing', (data) => {
        if (currentChat === data.from) {
            const ti = document.getElementById('typingIndicator');
            ti.innerText = `${data.from} печатает...`;
            ti.style.opacity = '1';
            clearTimeout(typingTimeout);
            typingTimeout = setTimeout(() => { ti.style.opacity = '0'; }, 2000);
        }
    });
}

function addMessageToChat(msg, skipScroll = false) {
    const div = document.createElement('div');
    div.className = `message ${msg.from === currentUser.username ? 'own' : 'other'}`;
    div.setAttribute('data-id', msg._id);
    div.innerHTML = `
        <div class="message-bubble">
            <div class="message-header">
                <span class="username" style="color:${msg.color}">${escapeHtml(msg.from)}</span>
            </div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
        </div>
        ${msg.from === currentUser.username ? `<button class="del-btn" onclick="deleteMsg('${msg._id}')">×</button>` : ''}
    `;
    messagesContainer.appendChild(div);
    if (!skipScroll) messagesContainer.scrollTop = messagesContainer.scrollHeight;
}

function deleteMsg(id) {
    if (confirm('Удалить сообщение?')) socket.emit('delete_message', { messageId: id });
}

function switchChat(username) {
    currentChat = username;
    chatTitle.innerText = `Чат с ${username}`;
    inputArea.style.display = 'flex';
    messagesContainer.innerHTML = '';
    fetch(`/api/messages?with=${username}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    }).then(r => r.json()).then(msgs => {
        msgs.forEach(m => addMessageToChat(m, true));
        messagesContainer.scrollTop = messagesContainer.scrollHeight;
    });
}

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (text && currentChat) {
        socket.emit('send_message', { to: currentChat, text });
        input.value = '';
    }
}

// ========== ВСПОМОГАТЕЛЬНОЕ ==========
async function loadFriends() {
    const res = await fetch('/api/friends', {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
    });
    const friends = await res.json();
    const list = document.getElementById('friendsList');
    list.innerHTML = friends.map(f => `
        <div class="user-item" onclick="switchChat('${f.username}')">
            <span>${f.avatar}</span> <b>${f.username}</b>
        </div>
    `).join('');
}

function escapeHtml(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('messageInput').onkeypress = (e) => { if(e.key === 'Enter') sendMessage(); };
document.getElementById('logoutBtn').onclick = logout;

window.onload = () => {
    const t = localStorage.getItem('token');
    const u = localStorage.getItem('user');
    if (t && u) loginSuccess(t, JSON.parse(u));
};
