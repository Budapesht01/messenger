let socket;
let currentUser = null;
let currentChat = 'all';
let typingTimeout;
let messagesContainer;

// DOM элементы
const authDiv = document.getElementById('auth');
const chatDiv = document.getElementById('chat');

// Функции аутентификации
function showError(msg) {
    document.getElementById('authError').innerText = msg;
}

async function register() {
    const username = document.getElementById('authUsername').value;
    const password = document.getElementById('authPassword').value;
    const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
        loginSuccess(data.token, data.user);
    } else {
        showError(data.error);
    }
}

async function login() {
    const username = document.getElementById('authUsername').value;
    const password = document.getElementById('authPassword').value;
    const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) {
        loginSuccess(data.token, data.user);
    } else {
        showError(data.error);
    }
}

function loginSuccess(token, user) {
    localStorage.setItem('token', token);
    localStorage.setItem('user', JSON.stringify(user));
    currentUser = user;
    authDiv.style.display = 'none';
    chatDiv.style.display = 'flex';
    initSocket(token);
    loadFriends();
    loadFriendRequests();
    document.getElementById('userInfo').innerHTML = `👤 ${user.username}`;
}

// Socket
function initSocket(token) {
    socket = io({
        auth: { token }
    });
    socket.on('connect', () => {
        console.log('Socket connected');
    });
    socket.on('history', (messages) => {
        renderMessages(messages);
    });
    socket.on('public_message', (msg) => {
        addMessageToChat(msg);
        notify(msg);
    });
    socket.on('private_message', (msg) => {
        if (currentChat === msg.from || currentChat === msg.to) {
            addMessageToChat(msg);
        } else {
            showNotification(`Новое сообщение от ${msg.from}`);
        }
        notify(msg);
    });
    socket.on('user_list', (users) => {
        // не используется напрямую, но можно для обновления друзей
    });
    socket.on('typing', (data) => {
        document.getElementById('typingIndicator').innerHTML = `${data.from} печатает...`;
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            document.getElementById('typingIndicator').innerHTML = '';
        }, 2000);
    });
    socket.on('friend_request', (data) => {
        showNotification(`Запрос в друзья от ${data.from}`);
        loadFriendRequests(); // обновляем список запросов
    });
    socket.on('friend_accepted', (data) => {
        showNotification(`${data.by} принял(а) ваш запрос в друзья!`);
        loadFriends();
    });
}

// Сообщения
function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;
    const to = currentChat === 'all' ? 'all' : currentChat;
    socket.emit('send_message', { to, text });
    input.value = '';
}

function addMessageToChat(msg) {
    const container = messagesContainer;
    const div = document.createElement('div');
    div.className = 'message';
    if (msg.to !== 'all') div.classList.add('private');
    if (msg.from === 'system') div.classList.add('system');
    div.innerHTML = `
        <span class="username" style="color:${getUserColor(msg.from)}">${escapeHtml(msg.from)}</span>
        <span class="time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
        <div>${escapeHtml(msg.text)}</div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function renderMessages(messages) {
    messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = '';
    messages.forEach(msg => addMessageToChat(msg));
}

function getUserColor(username) {
    return '#2c3e50';
}

// Друзья и запросы
async function loadFriends() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/friends', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const friends = await res.json();
    const container = document.getElementById('friendsList');
    container.innerHTML = '';
    if (friends.length === 0) {
        container.innerHTML = '<div class="info">Нет друзей. Найдите их в поиске!</div>';
        return;
    }
    friends.forEach(friend => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.onclick = () => switchChat(friend.username);
        div.innerHTML = `
            <span class="user-avatar">${escapeHtml(friend.avatar || '😀')}</span>
            <span class="user-name">${escapeHtml(friend.username)}</span>
            ${friend.online ? '<span class="online-dot">●</span>' : ''}
        `;
        container.appendChild(div);
    });
}

async function loadFriendRequests() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const allUsers = await res.json();
    const currentUserObj = allUsers.find(u => u.username === currentUser.username);
    const requests = currentUserObj ? currentUserObj.friendRequests || [] : [];
    const container = document.getElementById('requestsList');
    container.innerHTML = '';
    if (requests.length === 0) {
        container.innerHTML = '<div class="info">Нет входящих запросов.</div>';
        return;
    }
    requests.forEach(from => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `
            <span class="user-name">${escapeHtml(from)}</span>
            <div>
                <button class="accept-btn" data-from="${from}">Принять</button>
                <button class="reject-btn" data-from="${from}">Отклонить</button>
            </div>
        `;
        container.appendChild(div);
    });
    document.querySelectorAll('.accept-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const from = btn.getAttribute('data-from');
            await fetch('/api/friend-request/accept', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ from })
            });
            loadFriendRequests();
            loadFriends();
        });
    });
    document.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const from = btn.getAttribute('data-from');
            await fetch('/api/friend-request/reject', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ from })
            });
            loadFriendRequests();
        });
    });
}

// Поиск пользователей
document.getElementById('searchUserInput').addEventListener('input', async (e) => {
    const q = e.target.value;
    if (q.length < 2) {
        document.getElementById('searchResults').innerHTML = '';
        return;
    }
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const users = await res.json();
    const container = document.getElementById('searchResults');
    container.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `
            <span class="user-avatar">${escapeHtml(user.avatar || '😀')}</span>
            <span class="user-name">${escapeHtml(user.username)}</span>
            <button class="friend-request-btn" data-username="${user.username}">➕ Добавить</button>
        `;
        container.appendChild(div);
    });
    document.querySelectorAll('.friend-request-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const to = btn.getAttribute('data-username');
            const res = await fetch('/api/friend-request', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ to })
            });
            const data = await res.json();
            alert(data.message || data.error);
        });
    });
});

function switchChat(username) {
    currentChat = username;
    updateChatHeader();
    fetchHistoryForUser(username);
}

function updateChatHeader() {
    const header = document.getElementById('chatHeader');
    if (currentChat === 'all') {
        header.innerText = 'Общий чат';
    } else {
        header.innerText = `Чат с ${currentChat}`;
    }
}

async function fetchHistoryForUser(user) {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/messages?with=${user}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const messages = await res.json();
    renderMessages(messages);
}

// Утилиты
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function notify(msg) {
    const audio = new Audio('https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3');
    audio.play().catch(e => console.log('Audio play failed'));
    document.title = '✉️ Новое сообщение';
    setTimeout(() => { document.title = 'Мессенджер'; }, 2000);
}

function showNotification(text) {
    if (Notification.permission === 'granted') {
        new Notification(text);
    } else if (Notification.permission !== 'denied') {
        Notification.requestPermission();
    }
}

// Индикатор печатания
let typingTimer;
document.getElementById('messageInput').addEventListener('input', () => {
    if (typingTimer) clearTimeout(typingTimer);
    socket.emit('typing', { to: currentChat });
    typingTimer = setTimeout(() => {}, 1000);
});

// Переключение вкладок
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`${tabId}-tab`).classList.add('active');
        if (tabId === 'friends') loadFriends();
        if (tabId === 'requests') loadFriendRequests();
    });
});

// Загрузка при старте
window.onload = () => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
        currentUser = JSON.parse(savedUser);
        authDiv.style.display = 'none';
        chatDiv.style.display = 'flex';
        initSocket(token);
        loadFriends();
        loadFriendRequests();
        document.getElementById('userInfo').innerHTML = `👤 ${currentUser.username}`;
    }
    if (Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
};

document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('messageInput').onkeypress = (e) => {
    if (e.key === 'Enter') sendMessage();
};
