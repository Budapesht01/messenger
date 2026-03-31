let socket;
let currentUser = null;
let currentChat = 'all'; // 'all' или username
let typingTimeout;
let messagesContainer;

const authDiv = document.getElementById('auth');
const chatDiv = document.getElementById('chat');

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
    loadUsers();
}

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
            // Уведомление о новом личном сообщении
            showNotification(`Новое сообщение от ${msg.from}`);
        }
        notify(msg);
    });
    socket.on('user_list', (users) => {
        renderUsersList(users);
    });
    socket.on('typing', (data) => {
        document.getElementById('typingIndicator').innerHTML = `${data.from} печатает...`;
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            document.getElementById('typingIndicator').innerHTML = '';
        }, 2000);
    });
}

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
    const usernameColor = getUserColor(msg.from);
    div.innerHTML = `
        <span class="username" style="color:${usernameColor}">${escapeHtml(msg.from)}</span>
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

function renderUsersList(users) {
    const container = document.getElementById('usersContainer');
    container.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = `user-item ${user.online ? 'online' : ''}`;
        div.setAttribute('data-username', user.username);
        div.onclick = () => switchChat(user.username);
        div.innerHTML = `
            <span class="user-avatar">${escapeHtml(user.avatar || '😀')}</span>
            <span class="user-name">${escapeHtml(user.username)}</span>
            ${user.online ? '<span class="online-dot">●</span>' : ''}
        `;
        container.appendChild(div);
    });
    // Обновляем активный чат в заголовке
    updateChatHeader();
}

function switchChat(username) {
    currentChat = username;
    updateChatHeader();
    // Загрузить историю личных сообщений с этим пользователем
    // (можно запросить через API, но для простоты используем уже полученные сообщения)
    // В реальном проекте стоит сделать запрос на сервер для получения истории личного чата.
    // Здесь мы просто фильтруем уже имеющиеся в DOM сообщения? Проще перезапросить.
    // Для демонстрации: отправим запрос на сервер.
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
    // Получаем историю сообщений с этим пользователем через API
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

function getUserColor(username) {
    // можно вытащить из списка пользователей, но для простоты вернём чёрный
    return '#2c3e50';
}

function notify(msg) {
    // Звук (простой)
    const audio = new Audio('https://www.soundjay.com/misc/sounds/bell-ringing-05.mp3');
    audio.play().catch(e => console.log('Audio play failed'));
    // Мигание вкладки
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

// Отправка индикатора печатания
let typingTimer;
document.getElementById('messageInput').addEventListener('input', () => {
    if (typingTimer) clearTimeout(typingTimer);
    socket.emit('typing', { to: currentChat });
    typingTimer = setTimeout(() => {
        // Можно отправить остановку печатания, но не обязательно
    }, 1000);
});

// Загрузка пользователей
async function loadUsers() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/users', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const users = await res.json();
    renderUsersList(users);
}

// Поиск сообщений
document.getElementById('searchInput').addEventListener('input', async (e) => {
    const q = e.target.value;
    if (q.length < 2) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const messages = await res.json();
    renderMessages(messages);
});

// Проверка сохранённого токена при загрузке
window.onload = () => {
    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
        currentUser = JSON.parse(savedUser);
        authDiv.style.display = 'none';
        chatDiv.style.display = 'flex';
        initSocket(token);
        loadUsers();
    }
    if (Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
};

document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('messageInput').onkeypress = (e) => {
    if (e.key === 'Enter') sendMessage();
};