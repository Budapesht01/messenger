let socket;
let currentUser = null;
let currentChat = 'all';
let typingTimeout;
let messagesContainer;
let emojiPicker = null;

// DOM элементы
const authDiv = document.getElementById('auth');
const chatDiv = document.getElementById('chat');
const sidebar = document.getElementById('sidebar');

// ========== Аутентификация ==========
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
    loadProfile();
    document.getElementById('userInfo').innerHTML = `👤 ${user.username}`;
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (socket) socket.disconnect();
    authDiv.style.display = 'flex';
    chatDiv.style.display = 'none';
    currentUser = null;
    currentChat = 'all';
}

// ========== Socket ==========
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
    socket.on('message_edited', (data) => {
        const { messageId, newText } = data;
        const messageDiv = document.querySelector(`.message[data-id="${messageId}"]`);
        if (messageDiv) {
            const textDiv = messageDiv.querySelector('.message-text');
            if (textDiv) {
                textDiv.innerHTML = escapeHtml(newText);
                let editedSpan = messageDiv.querySelector('.edited-badge');
                if (!editedSpan) {
                    editedSpan = document.createElement('span');
                    editedSpan.className = 'edited-badge';
                    editedSpan.innerText = ' (ред.)';
                    messageDiv.querySelector('.username').after(editedSpan);
                }
            }
        }
    });
    socket.on('message_deleted', (data) => {
        const { messageId } = data;
        const messageDiv = document.querySelector(`.message[data-id="${messageId}"]`);
        if (messageDiv) {
            messageDiv.classList.add('deleted-message');
            const textDiv = messageDiv.querySelector('.message-text');
            if (textDiv) textDiv.innerHTML = '<em>Сообщение удалено</em>';
            const actions = messageDiv.querySelector('.message-actions');
            if (actions) actions.style.display = 'none';
        }
    });
    socket.on('friend_status', (data) => {
        updateFriendStatus(data.username, data.online, data.lastSeen);
    });
    socket.on('friend_request', (data) => {
        showNotification(`Запрос в друзья от ${data.from}`);
        loadFriendRequests();
    });
    socket.on('friend_accepted', (data) => {
        showNotification(`${data.by} принял(а) ваш запрос в друзья!`);
        loadFriends();
    });
    socket.on('typing', (data) => {
        document.getElementById('typingIndicator').innerHTML = `${data.from} печатает...`;
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            document.getElementById('typingIndicator').innerHTML = '';
        }, 2000);
    });
}

// ========== Сообщения ==========
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
    div.className = `message ${msg.from === currentUser.username ? 'own' : 'other'}`;
    div.setAttribute('data-id', msg._id);
    const avatar = msg.avatar || '😀';
    const color = msg.color || '#6ab0f3';
    div.innerHTML = `
        <div class="message-bubble">
            <div class="message-header">
                <span class="username" style="color:${color}">${escapeHtml(msg.from)}</span>
                <span class="time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
                ${msg.edited ? '<span class="edited-badge">ред.</span>' : ''}
            </div>
            <div class="message-text">${escapeHtml(msg.text)}</div>
        </div>
        <div class="message-actions">
            ${msg.from === currentUser.username ? `
                <button class="edit-msg" data-id="${msg._id}">✏️</button>
                <button class="delete-msg" data-id="${msg._id}">🗑️</button>
            ` : ''}
        </div>
    `;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;

    if (msg.from === currentUser.username) {
        div.querySelector('.edit-msg')?.addEventListener('click', (e) => {
            e.stopPropagation();
            const newText = prompt('Редактировать сообщение:', msg.text);
            if (newText && newText.trim()) {
                socket.emit('edit_message', { messageId: msg._id, newText: newText.trim() });
            }
        });
        div.querySelector('.delete-msg')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Удалить сообщение для всех?')) {
                socket.emit('delete_message', { messageId: msg._id });
            }
        });
    }
}

function renderMessages(messages) {
    messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = '';
    messages.forEach(msg => addMessageToChat(msg));
}

// ========== Друзья и запросы ==========
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
    const res = await fetch('/api/friend-requests', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const requests = await res.json();
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

function updateFriendStatus(username, online, lastSeen) {
    const friendDivs = document.querySelectorAll('#friendsList .user-item');
    friendDivs.forEach(div => {
        const nameSpan = div.querySelector('.user-name');
        if (nameSpan && nameSpan.innerText === username) {
            const dot = div.querySelector('.online-dot');
            if (online) {
                if (!dot) div.insertAdjacentHTML('beforeend', '<span class="online-dot">●</span>');
                else dot.style.display = 'inline';
            } else {
                if (dot) dot.style.display = 'none';
            }
            if (!online && lastSeen) {
                div.setAttribute('title', `Был(а) в сети ${new Date(lastSeen).toLocaleString()}`);
            }
        }
    });
}

// ========== Поиск пользователей ==========
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

// ========== Настройки профиля ==========
async function loadProfile() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/me', {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    document.getElementById('avatarPreview').innerText = data.avatar || '😀';
    document.getElementById('colorInput').value = data.color || '#6ab0f3';
}

async function updateProfile(avatar, color) {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/me/update', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ avatar, color })
    });
    if (res.ok) {
        alert('Профиль обновлён');
        currentUser.avatar = avatar;
        currentUser.color = color;
        // Обновляем превью
        document.getElementById('avatarPreview').innerText = avatar;
    } else {
        alert('Ошибка обновления');
    }
}

// ========== Эмодзи-пикер ==========
function initEmojiPicker() {
    if (!window.EmojiPicker) return;
    emojiPicker = new window.EmojiPicker({
        dataSource: 'https://cdn.jsdelivr.net/npm/emoji-picker-element@1.18.0/data/emojis.json',
        locale: 'ru'
    });
    const container = document.getElementById('emojiPickerContainer');
    container.appendChild(emojiPicker);
    emojiPicker.addEventListener('emoji-click', event => {
        const input = document.getElementById('messageInput');
        input.value += event.detail.unicode;
        input.focus();
        container.style.display = 'none';
    });
    document.getElementById('emojiBtn').addEventListener('click', () => {
        if (container.style.display === 'none') {
            container.style.display = 'block';
        } else {
            container.style.display = 'none';
        }
    });
    // Закрывать при клике вне
    document.addEventListener('click', (e) => {
        if (!container.contains(e.target) && e.target.id !== 'emojiBtn') {
            container.style.display = 'none';
        }
    });
}

// ========== Смена чата ==========
function switchChat(username) {
    currentChat = username;
    updateChatHeader();
    fetchHistoryForUser(username);
    if (window.innerWidth <= 768) {
        sidebar.classList.remove('open');
    }
}

function updateChatHeader() {
    const titleElem = document.querySelector('.chat-title');
    if (currentChat === 'all') {
        titleElem.innerText = 'Общий чат';
    } else {
        titleElem.innerText = `Чат с ${currentChat}`;
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

// ========== Утилиты ==========
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

// ========== Индикатор печатания ==========
let typingTimer;
document.getElementById('messageInput').addEventListener('input', () => {
    if (typingTimer) clearTimeout(typingTimer);
    if (socket) socket.emit('typing', { to: currentChat });
    typingTimer = setTimeout(() => {}, 1000);
});

// ========== Переключение вкладок ==========
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

// ========== Мобильное меню ==========
document.getElementById('menuToggleBtn').addEventListener('click', () => {
    sidebar.classList.toggle('open');
});

// ========== Сохранение профиля ==========
document.getElementById('saveProfileBtn').addEventListener('click', () => {
    const avatar = document.getElementById('avatarPreview').innerText;
    const color = document.getElementById('colorInput').value;
    updateProfile(avatar, color);
});

// Выбор аватара через эмодзи-пикер
let avatarPicker = null;
function initAvatarPicker() {
    if (!window.EmojiPicker) return;
    avatarPicker = new window.EmojiPicker({
        dataSource: 'https://cdn.jsdelivr.net/npm/emoji-picker-element@1.18.0/data/emojis.json',
        locale: 'ru'
    });
    const pickerContainer = document.createElement('div');
    pickerContainer.style.position = 'absolute';
    pickerContainer.style.zIndex = 1000;
    pickerContainer.style.background = 'var(--bg-sidebar)';
    pickerContainer.style.borderRadius = '12px';
    pickerContainer.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    pickerContainer.style.display = 'none';
    pickerContainer.appendChild(avatarPicker);
    document.body.appendChild(pickerContainer);
    document.getElementById('pickAvatarBtn').addEventListener('click', (e) => {
        const rect = e.target.getBoundingClientRect();
        pickerContainer.style.left = rect.left + 'px';
        pickerContainer.style.top = (rect.bottom + 5) + 'px';
        pickerContainer.style.display = pickerContainer.style.display === 'none' ? 'block' : 'none';
    });
    avatarPicker.addEventListener('emoji-click', event => {
        document.getElementById('avatarPreview').innerText = event.detail.unicode;
        pickerContainer.style.display = 'none';
    });
    document.addEventListener('click', (e) => {
        if (!pickerContainer.contains(e.target) && e.target.id !== 'pickAvatarBtn') {
            pickerContainer.style.display = 'none';
        }
    });
}

// ========== Загрузка при старте ==========
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
        loadProfile();
        document.getElementById('userInfo').innerHTML = `👤 ${currentUser.username}`;
        initEmojiPicker();
        initAvatarPicker();
    }
    if (Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
};

document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('messageInput').onkeypress = (e) => {
    if (e.key === 'Enter') sendMessage();
};
document.getElementById('logoutBtn').onclick = logout;
