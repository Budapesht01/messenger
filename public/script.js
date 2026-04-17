let socket;
let currentUser = null;
let currentChat = 'all';
let typingTimeout;
let messagesContainer;

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
    // не показываем историю пока не выбран чат
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

function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text || currentChat === 'all') return;
    socket.emit('send_message', { to: currentChat, text });
    input.value = '';
}

function addMessageToChat(msg) {
    const container = messagesContainer;
    const div = document.createElement('div');
    div.className = `message ${msg.from === currentUser.username ? 'own' : 'other'}`;
    div.setAttribute('data-id', msg._id);
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
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--accent); font-size:14px;">👥 Найдите друзей во вкладке Поиск!</div>';
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
        container.innerHTML = '<div style="text-align:center; padding:20px; color:var(--accent); font-size:14px;">📭 Нет входящих запросов</div>';
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
        document.getElementById('avatarPreview').innerText = avatar;
    } else {
        alert('Ошибка обновления');
    }
}

// ========== Выбор аватара ==========
const commonEmojis = [
    { icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😋','😛','😜','🤪','😎','🥳','😏','😒','😔','😟','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','🤗','🤔','🤫','🤥','😶','😐','😑','😬','🙄','😯','😲','🥱','😴','🤤','😵','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','👽','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'] },
    { icon: '👍', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤏','✍️','💅','💪','🙌','👏','🤝','🙏','👐','🤲','💏','💑','👪','🧑','👶','👧','👦','👩','👨','🧓','👴','👵','👮','🕵️','💂','👷','🤴','👸','🧙','🧚','🧜','🧝','🧛','🧟','🧞','🧠','👁️','👅','👄','💋','🦷','👂','👃','🦶','🦵','💪'] },
    { icon: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🐘','🦏','🦛','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐈','🐓','🦃','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿️','🦔'] },
    { icon: '🍎', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🍲','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍙','🍚','🍘','🍥','🥮','🍡','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','☕','🍵','🧉','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾'] },
    { icon: '⚽', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🏊','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🎗️','🎫','🎟️','🎪','🤹','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🕹️'] },
    { icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','🕉️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🔕'] },
];

function initAvatarPicker() {
    const avatarPreview = document.getElementById('avatarPreview');
    const pickerBtn = document.getElementById('pickAvatarBtn');
    if (!avatarPreview || !pickerBtn) return;
    const avatarMenu = document.createElement('div');
    avatarMenu.className = 'emoji-menu';
    avatarMenu.style.cssText = 'display:none; position:absolute; background:var(--bg-sidebar); border-radius:12px; padding:8px; box-shadow:0 4px 12px rgba(0,0,0,0.3); z-index:1000; width:280px;';
    avatarMenu.innerHTML = `<div style="display:grid; grid-template-columns:repeat(8,1fr); gap:6px; max-height:200px; overflow-y:auto;">${commonEmojis.map(e => `<span style="font-size:24px; cursor:pointer; text-align:center;">${e}</span>`).join('')}</div>`;
    document.body.appendChild(avatarMenu);
    avatarMenu.querySelectorAll('span').forEach(span => {
        span.addEventListener('click', () => {
            avatarPreview.innerText = span.innerText;
            avatarMenu.style.display = 'none';
        });
    });
    pickerBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const rect = pickerBtn.getBoundingClientRect();
        avatarMenu.style.left = rect.left + 'px';
        avatarMenu.style.top = (rect.bottom + 5) + 'px';
        avatarMenu.style.display = avatarMenu.style.display === 'none' ? 'block' : 'none';
    });
    document.addEventListener('click', (e) => {
        if (!avatarMenu.contains(e.target) && e.target !== pickerBtn) {
            avatarMenu.style.display = 'none';
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
    // показываем только личные сообщения между двумя пользователями
    const filtered = messages.filter(m => 
        (m.from === currentUser.username && m.to === user) ||
        (m.from === user && m.to === currentUser.username)
    );
    renderMessages(filtered);
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
        document.querySelector('.chat-title').innerText = 'Выберите чат';
        document.getElementById('messageInput').placeholder = 'Выберите чат для отправки...';
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

// ========== Emoji Picker ==========
const emojiCategories = [
    { icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😋','😛','😜','🤪','😎','🥳','😏','😒','😔','😟','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','🤗','🤔','🤫','🤥','😶','😐','😑','😬','🙄','😯','😲','🥱','😴','🤤','😵','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','👽','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'] },
    { icon: '👍', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤏','✍️','💅','💪','🙌','👏','🤝','🙏','👐','🤲','💏','💑','👪','🧑','👶','👧','👦','👩','👨','🧓','👴','👵','👮','🕵️','💂','👷','🤴','👸','🧙','🧚','🧜','🧝','🧛','🧟','🧞','🧠','👁️','👅','👄','💋','🦷','👂','👃','🦶','🦵','💪'] },
    { icon: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🦟','🦗','🕷️','🦂','🐢','🐍','🦎','🦖','🦕','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈','🐊','🐅','🐆','🦓','🦍','🐘','🦏','🦛','🐪','🐫','🦒','🦘','🐃','🐂','🐄','🐎','🐖','🐏','🐑','🦙','🐐','🦌','🐕','🐩','🦮','🐈','🐓','🦃','🦚','🦜','🦢','🦩','🕊️','🐇','🦝','🦨','🦡','🦦','🦥','🐁','🐀','🐿️','🦔'] },
    { icon: '🍎', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍈','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🧄','🧅','🥔','🍠','🥐','🥯','🍞','🥖','🥨','🧀','🥚','🍳','🧈','🥞','🧇','🥓','🥩','🍗','🍖','🦴','🌭','🍔','🍟','🍕','🫓','🥪','🥙','🧆','🌮','🌯','🫔','🥗','🥘','🫕','🍲','🍛','🍜','🍝','🍠','🍢','🍣','🍤','🍙','🍚','🍘','🍥','🥮','🍡','🧁','🍰','🎂','🍮','🍭','🍬','🍫','🍿','🍩','🍪','🌰','🥜','🍯','🧃','🥤','🧋','☕','🍵','🧉','🍺','🍻','🥂','🍷','🥃','🍸','🍹','🍾'] },
    { icon: '⚽', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🥏','🎱','🪀','🏓','🏸','🏒','🥊','🥋','🎽','🛹','🛼','🛷','⛸️','🥌','🎿','⛷️','🏂','🪂','🏋️','🤼','🤸','⛹️','🤺','🏊','🚣','🧗','🚵','🚴','🏆','🥇','🥈','🥉','🏅','🎖️','🎗️','🎫','🎟️','🎪','🤹','🎭','🎨','🎬','🎤','🎧','🎼','🎹','🥁','🎷','🎺','🎸','🪕','🎻','🎲','♟️','🎯','🎳','🎮','🕹️'] },
    { icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','💟','☮️','✝️','☯️','🕉️','☦️','🛐','⛎','♈','♉','♊','♋','♌','♍','♎','♏','♐','♑','♒','♓','🆔','⚛️','🉑','☢️','☣️','📴','📳','🈶','🈚','🈸','🈺','🈷️','✴️','🆚','💮','🉐','㊙️','㊗️','🈴','🈵','🈹','🈲','🅰️','🅱️','🆎','🆑','🅾️','🆘','❌','⭕','🛑','⛔','📛','🚫','💯','💢','♨️','🚷','🚯','🚳','🚱','🔞','📵','🔕'] },
];

function initEmojiPicker() {
    const panel = document.getElementById('emojiPickerPanel');
    const toggleBtn = document.getElementById('emojiToggleBtn');
    const grid = document.getElementById('emojiGrid');
    const catsContainer = document.getElementById('emojiCategories');
    const input = document.getElementById('messageInput');

    // Рендер категорий
    emojiCategories.forEach((cat, i) => {
        const btn = document.createElement('button');
        btn.className = 'emoji-cat-btn' + (i === 0 ? ' active' : '');
        btn.innerText = cat.icon;
        btn.addEventListener('click', () => {
            document.querySelectorAll('.emoji-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderEmojiGrid(cat.emojis);
        });
        catsContainer.appendChild(btn);
    });

    // Первая категория по умолчанию
    renderEmojiGrid(emojiCategories[0].emojis);

    function renderEmojiGrid(emojis) {
        grid.innerHTML = '';
        emojis.forEach(emoji => {
            const span = document.createElement('span');
            span.innerText = emoji;
            span.addEventListener('click', () => {
                input.value += emoji;
                input.focus();
            });
            grid.appendChild(span);
        });
    }

    // Открыть/закрыть
    toggleBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        panel.classList.toggle('open');
    });

    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && e.target !== toggleBtn) {
            panel.classList.remove('open');
        }
    });
}

// Инициализация при загрузке
window.addEventListener('load', () => {
    initEmojiPicker();
});
