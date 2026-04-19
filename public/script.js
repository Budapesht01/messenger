let socket;
let currentUser = null;
let currentChat = null;      // username для личных
let currentGroupId = null;   // _id группы
let typingTimeout;
let messagesContainer;

const authDiv = document.getElementById('auth');
const chatDiv = document.getElementById('chat');
const sidebar = document.getElementById('sidebar');

// ========== Аутентификация ==========
function showError(msg) {
    const el = document.getElementById('authError');
    el.innerText = msg;
    if (msg) {
        clearTimeout(el._hideTimer);
        el._hideTimer = setTimeout(() => { el.innerText = ''; }, 3000);
    }
}

async function register() {
    showError('');
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!username) return showError('Введите имя пользователя');
    if (username.length < 3) return showError('Имя должно быть не менее 3 символов');
    if (!password) return showError('Введите пароль');
    if (password.length < 8) return showError('Пароль должен быть не менее 8 символов');
    const res = await fetch('/api/register', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) loginSuccess(data.token, data.user);
    else showError(data.error === 'Username taken' ? 'Это имя уже занято' : data.error);
}

async function login() {
    showError('');
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!username) return showError('Введите имя пользователя');
    if (!password) return showError('Введите пароль');
    if (password.length < 8) return showError('Пароль должен быть не менее 8 символов');
    const res = await fetch('/api/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
    });
    const data = await res.json();
    if (res.ok) loginSuccess(data.token, data.user);
    else showError(data.error === 'Invalid credentials' ? 'Неверное имя или пароль' : data.error);
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
    loadGroups();
    loadProfile();
    document.getElementById('userInfo').innerHTML = `👤 ${user.username}`;
    document.querySelector('.chat-title').innerText = 'Выберите чат';
    document.getElementById('messageInput').placeholder = 'Выберите чат...';
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (socket) socket.disconnect();
    authDiv.style.display = 'flex';
    chatDiv.style.display = 'none';
    currentUser = null;
    currentChat = null;
    currentGroupId = null;
}

// ========== Socket ==========
function initSocket(token) {
    socket = io({ auth: { token } });

    socket.on('connect', () => console.log('Socket connected'));

    socket.on('history', () => {});

    socket.on('private_message', (msg) => {
        if (currentChat === msg.from || currentChat === msg.to) {
            addMessageToChat(msg);
        } else {
            showNotification(`💬 Сообщение от ${msg.from}`);
        }
        notify();
    });

    socket.on('group_message', (msg) => {
        if (currentGroupId && currentGroupId === String(msg.groupId)) {
            addMessageToChat(msg);
        } else {
            showNotification(`💬 Новое сообщение в группе`);
        }
        notify();
    });

    socket.on('message_edited', (data) => {
        const { messageId, newText } = data;
        const el = document.querySelector(`.message[data-id="${messageId}"]`);
        if (el) {
            const t = el.querySelector('.message-text');
            if (t) t.innerHTML = escapeHtml(newText);
            if (!el.querySelector('.edited-badge')) {
                const span = document.createElement('span');
                span.className = 'edited-badge';
                span.innerText = ' (ред.)';
                el.querySelector('.username').after(span);
            }
        }
    });

    socket.on('message_deleted', (data) => {
        const el = document.querySelector(`.message[data-id="${data.messageId}"]`);
        if (el) {
            const t = el.querySelector('.message-text');
            if (t) t.innerHTML = '<em>Сообщение удалено</em>';
            const a = el.querySelector('.message-actions');
            if (a) a.style.display = 'none';
        }
    });

    socket.on('friend_status', (data) => updateFriendStatus(data.username, data.online, data.lastSeen));
    socket.on('friend_request', (data) => { showNotification(`👤 Запрос от ${data.from}`); loadFriendRequests(); });
    socket.on('friend_accepted', (data) => { showNotification(`✅ ${data.by} принял запрос`); loadFriends(); });

    socket.on('typing', (data) => {
        const isCurrentChat = data.groupId
            ? currentGroupId && String(currentGroupId) === String(data.groupId)
            : currentChat === data.from;
        if (!isCurrentChat) return;
        const indicator = document.getElementById('typingIndicator');
        indicator.innerHTML = `✏️ ${data.from} печатает...`;
        indicator.classList.add('active');
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => {
            indicator.innerHTML = '';
            indicator.classList.remove('active');
        }, 2000);
    });

    // Группы
    socket.on('group_added', (data) => {
        showNotification(`👥 Вас добавили в группу «${data.group.name}»`);
        loadGroups();
        socket.emit('join_group_room', data.group._id);
    });
    socket.on('group_deleted', (data) => {
        if (currentGroupId === String(data.groupId)) {
            currentGroupId = null;
            document.querySelector('.chat-title').innerText = 'Выберите чат';
            document.getElementById('messages').innerHTML = '';
        }
        loadGroups();
    });
    socket.on('group_member_joined', () => loadGroups());
    socket.on('group_member_left', () => loadGroups());
}

// ========== Сообщения ==========
function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;
    if (currentGroupId) {
        socket.emit('send_group_message', { groupId: currentGroupId, text });
    } else if (currentChat) {
        socket.emit('send_message', { to: currentChat, text });
    }
    input.value = '';
}

function addMessageToChat(msg) {
    const container = messagesContainer || document.getElementById('messages');
    messagesContainer = container;
    const div = document.createElement('div');
    div.className = `message ${msg.from === currentUser.username ? 'own' : 'other'}`;
    div.setAttribute('data-id', msg._id);
    const color = msg.color || '#6ab0f3';
    div.innerHTML = `
        <div class="message-bubble">
            <div class="message-header">
                <span class="username" style="color:${color}">${escapeHtml(msg.from)}</span>
                <span class="time">${new Date(msg.timestamp).toLocaleTimeString()}</span>
                ${msg.edited ? '<span class="edited-badge"> (ред.)</span>' : ''}
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
            const newText = prompt('Редактировать:', msg.text);
            if (newText && newText.trim()) socket.emit('edit_message', { messageId: msg._id, newText: newText.trim() });
        });
        div.querySelector('.delete-msg')?.addEventListener('click', (e) => {
            e.stopPropagation();
            if (confirm('Удалить для всех?')) socket.emit('delete_message', { messageId: msg._id });
        });
    }
}

function renderMessages(messages) {
    messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = '';
    messages.forEach(msg => addMessageToChat(msg));
}

// ========== Переключение чатов ==========
function switchChat(username) {
    currentChat = username;
    currentGroupId = null;
    document.querySelector('.chat-title').innerText = `Чат с ${username}`;
    document.getElementById('messageInput').placeholder = 'Сообщение...';
    document.getElementById('groupInfoBtn').style.display = 'none';
    fetchHistoryForUser(username);
    if (window.innerWidth <= 768) sidebar.classList.remove('open');
    setActiveChatItem('dm_' + username);
}

async function switchGroupChat(groupId, groupName) {
    currentGroupId = groupId;
    currentChat = null;
    document.querySelector('.chat-title').innerText = groupName;
    document.getElementById('messageInput').placeholder = 'Сообщение в группу...';
    document.getElementById('groupInfoBtn').style.display = 'flex';
    if (window.innerWidth <= 768) sidebar.classList.remove('open');
    setActiveChatItem('group_' + groupId);

    const token = localStorage.getItem('token');
    const res = await fetch(`/api/groups/${groupId}/messages`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
        const messages = await res.json();
        renderMessages(messages);
    }
}

function setActiveChatItem(key) {
    document.querySelectorAll('.user-item, .group-item').forEach(el => el.classList.remove('active-chat'));
    const el = document.querySelector(`[data-chat-key="${key}"]`);
    if (el) el.classList.add('active-chat');
}

async function fetchHistoryForUser(user) {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/messages?with=${user}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const messages = await res.json();
    const filtered = messages.filter(m =>
        (m.from === currentUser.username && m.to === user) ||
        (m.from === user && m.to === currentUser.username)
    );
    renderMessages(filtered);
}

// ========== Друзья ==========
async function loadFriends() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/friends', { headers: { 'Authorization': `Bearer ${token}` } });
    const friends = await res.json();
    const container = document.getElementById('friendsList');
    container.innerHTML = '';
    if (friends.length === 0) {
        container.innerHTML = '<div class="empty-hint">👥 Найдите друзей во вкладке Поиск</div>';
        return;
    }
    friends.forEach(friend => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.setAttribute('data-chat-key', 'dm_' + friend.username);
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
    const res = await fetch('/api/friend-requests', { headers: { 'Authorization': `Bearer ${token}` } });
    const requests = await res.json();
    const container = document.getElementById('requestsList');
    container.innerHTML = '';
    if (requests.length === 0) {
        container.innerHTML = '<div class="empty-hint">📭 Нет входящих запросов</div>';
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
            await fetch('/api/friend-request/accept', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ from: btn.getAttribute('data-from') })
            });
            loadFriendRequests(); loadFriends();
        });
    });
    document.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await fetch('/api/friend-request/reject', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ from: btn.getAttribute('data-from') })
            });
            loadFriendRequests();
        });
    });
}

function updateFriendStatus(username, online, lastSeen) {
    document.querySelectorAll('#friendsList .user-item').forEach(div => {
        const nameSpan = div.querySelector('.user-name');
        if (nameSpan && nameSpan.innerText === username) {
            const dot = div.querySelector('.online-dot');
            if (online) {
                if (!dot) div.insertAdjacentHTML('beforeend', '<span class="online-dot">●</span>');
                else dot.style.display = 'inline';
            } else {
                if (dot) dot.style.display = 'none';
            }
        }
    });
}

// ========== Поиск ==========
document.getElementById('searchUserInput').addEventListener('input', async (e) => {
    const q = e.target.value;
    if (q.length < 2) { document.getElementById('searchResults').innerHTML = ''; return; }
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
            <button class="friend-request-btn" data-username="${user.username}">➕</button>
        `;
        container.appendChild(div);
    });
    document.querySelectorAll('.friend-request-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const res2 = await fetch('/api/friend-request', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ to: btn.getAttribute('data-username') })
            });
            const data = await res2.json();
            btn.innerText = '✓';
            btn.disabled = true;
            setTimeout(() => alert(data.message || data.error), 100);
        });
    });
});

// ========== ГРУППЫ ==========
async function loadGroups() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/groups', { headers: { 'Authorization': `Bearer ${token}` } });
    const groups = await res.json();
    const container = document.getElementById('groupsList');
    container.innerHTML = '';
    if (groups.length === 0) {
        container.innerHTML = '<div class="empty-hint">👥 Нет групп. Создайте первую!</div>';
        return;
    }
    groups.forEach(group => {
        const div = document.createElement('div');
        div.className = 'group-item user-item';
        div.setAttribute('data-chat-key', 'group_' + group._id);
        div.onclick = () => switchGroupChat(group._id, group.name);
        const badge = group.type === 'public'
            ? '<span class="group-badge public">публичная</span>'
            : '<span class="group-badge private">закрытая</span>';
        div.innerHTML = `
            <span class="user-avatar">${escapeHtml(group.avatar || '👥')}</span>
            <div style="flex:1; min-width:0;">
                <div class="user-name">${escapeHtml(group.name)}</div>
                <div style="font-size:11px; color:var(--text-secondary);">${group.members.length} участн. ${badge}</div>
            </div>
            ${group.owner === currentUser.username ? '<span style="font-size:10px;color:var(--accent)">👑</span>' : ''}
        `;
        container.appendChild(div);
    });
}

// Открыть модалку создания группы
function openCreateGroupModal() {
    document.getElementById('createGroupModal').classList.add('open');
    loadFriendsForGroupModal();
}

function closeCreateGroupModal() {
    document.getElementById('createGroupModal').classList.remove('open');
    document.getElementById('newGroupName').value = '';
    document.getElementById('newGroupDesc').value = '';
    document.getElementById('groupMemberCheckboxes').innerHTML = '';
    // Сбросить radio на "закрытая"
    const privateRadio = document.querySelector('input[name="groupType"][value="private"]');
    if (privateRadio) privateRadio.checked = true;
    document.getElementById('groupAvatarPreview').innerText = '👥';
}

async function loadFriendsForGroupModal() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/friends', { headers: { 'Authorization': `Bearer ${token}` } });
    const friends = await res.json();
    const container = document.getElementById('groupMemberCheckboxes');
    container.innerHTML = '';
    if (friends.length === 0) {
        container.innerHTML = '<div class="empty-hint">Нет друзей для добавления</div>';
        return;
    }
    friends.forEach(f => {
        const label = document.createElement('label');
        label.className = 'member-checkbox-label';
        label.innerHTML = `
            <input type="checkbox" value="${escapeHtml(f.username)}">
            <span>${escapeHtml(f.avatar || '😀')} ${escapeHtml(f.username)}</span>
        `;
        container.appendChild(label);
    });
}

async function createGroup() {
    const name = document.getElementById('newGroupName').value.trim();
    const description = document.getElementById('newGroupDesc').value.trim();
    const typeRadio = document.querySelector('input[name="groupType"]:checked');
    const type = typeRadio ? typeRadio.value : 'private';
    const avatar = document.getElementById('groupAvatarPreview').innerText;
    if (!name) return alert('Введите название группы');

    const checked = [...document.querySelectorAll('#groupMemberCheckboxes input:checked')];
    const members = checked.map(cb => cb.value);

    const token = localStorage.getItem('token');
    const res = await fetch('/api/groups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ name, description, type, avatar, members })
    });
    const data = await res.json();
    if (res.ok) {
        closeCreateGroupModal();
        socket.emit('join_group_room', data.group._id);
        loadGroups();
        switchGroupChat(data.group._id, data.group.name);

        // Показать инвайт-код
        const code = data.group.inviteCode;
        setTimeout(() => {
            showInviteCode(code, data.group.name, data.group.type);
        }, 300);
    } else {
        alert(data.error);
    }
}

function showInviteCode(code, name, type) {
    const modal = document.getElementById('inviteCodeModal');
    document.getElementById('inviteCodeDisplay').innerText = code;
    document.getElementById('inviteCodeGroupName').innerText = name;
    const hint = type === 'public'
        ? '🌍 Публичная группа — её можно найти через поиск. Код для прямого входа:'
        : '🔒 Закрытая группа — вступить можно только по этому коду:';
    document.getElementById('inviteCodeHint').innerText = hint;
    modal.classList.add('open');
}

function closeInviteModal() {
    document.getElementById('inviteCodeModal').classList.remove('open');
}

function copyInviteCode() {
    const code = document.getElementById('inviteCodeDisplay').innerText;
    navigator.clipboard.writeText(code).then(() => {
        const btn = document.getElementById('copyCodeBtn');
        btn.innerText = '✓ Скопировано!';
        setTimeout(() => btn.innerText = '📋 Скопировать код', 2000);
    });
}

// Вступить по коду
async function joinByCode() {
    const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
    if (!code) return alert('Введите код');
    const token = localStorage.getItem('token');
    const res = await fetch('/api/groups/join', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ inviteCode: code })
    });
    const data = await res.json();
    if (res.ok) {
        document.getElementById('joinCodeInput').value = '';
        socket.emit('join_group_room', data.group._id);
        loadGroups();
        switchGroupChat(data.group._id, data.group.name);
    } else {
        alert(data.error);
    }
}

// Поиск публичных групп
document.getElementById('searchGroupInput').addEventListener('input', async (e) => {
    const q = e.target.value;
    if (q.length < 1) { document.getElementById('publicGroupResults').innerHTML = ''; return; }
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/groups/public?q=${encodeURIComponent(q)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const groups = await res.json();
    const container = document.getElementById('publicGroupResults');
    container.innerHTML = '';
    if (groups.length === 0) {
        container.innerHTML = '<div class="empty-hint">Ничего не найдено</div>';
        return;
    }
    groups.forEach(group => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `
            <span class="user-avatar">${escapeHtml(group.avatar || '👥')}</span>
            <div style="flex:1;">
                <div class="user-name">${escapeHtml(group.name)}</div>
                <div style="font-size:11px;color:var(--text-secondary);">${group.members.length} участн.</div>
            </div>
            <button class="friend-request-btn" data-id="${group._id}" data-name="${escapeHtml(group.name)}">Вступить</button>
        `;
        container.appendChild(div);
    });
    document.querySelectorAll('#publicGroupResults .friend-request-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.getAttribute('data-id');
            const name = btn.getAttribute('data-name');
            const token2 = localStorage.getItem('token');
            const res2 = await fetch(`/api/groups/${id}/join`, {
                method: 'POST', headers: { 'Authorization': `Bearer ${token2}` }
            });
            const data = await res2.json();
            if (res2.ok) {
                btn.innerText = '✓';
                btn.disabled = true;
                socket.emit('join_group_room', id);
                loadGroups();
                switchGroupChat(id, name);
            } else {
                alert(data.error);
            }
        });
    });
});

// Показать инфо о текущей группе
async function showGroupInfo() {
    if (!currentGroupId) return;
    const token = localStorage.getItem('token');
    const res = await fetch('/api/groups', { headers: { 'Authorization': `Bearer ${token}` } });
    const groups = await res.json();
    const group = groups.find(g => String(g._id) === String(currentGroupId));
    if (!group) return;

    const modal = document.getElementById('groupInfoModal');
    document.getElementById('groupInfoName').innerText = group.name;
    document.getElementById('groupInfoAvatar').innerText = group.avatar || '👥';
    document.getElementById('groupInfoType').innerText = group.type === 'public' ? '🌍 Публичная' : '🔒 Закрытая';
    const inviteLink = group.inviteCode;
    document.getElementById('groupInfoCode').innerText = inviteLink;
    document.getElementById('groupInfoMembers').innerHTML = group.members
        .map(m => `<span class="member-tag">${m === group.owner ? '👑 ' : ''}${escapeHtml(m)}</span>`)
        .join('');

    const isOwner = group.owner === currentUser.username;
    document.getElementById('deleteGroupBtn').style.display = isOwner ? 'block' : 'none';
    document.getElementById('leaveGroupBtn').style.display = !isOwner ? 'block' : 'none';

    modal.classList.add('open');
}

function closeGroupInfoModal() {
    document.getElementById('groupInfoModal').classList.remove('open');
}

async function getGroupInviteLink() {
    if (!currentGroupId) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/groups/${currentGroupId}/invite`, {
        headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error);
    const code = data.inviteCode;
    navigator.clipboard.writeText(code).then(() => {
        showNotification('🔗 Код скопирован: ' + code);
    });
}

async function deleteGroup() {
    if (!confirm('Удалить группу для всех?')) return;
    const token = localStorage.getItem('token');
    await fetch(`/api/groups/${currentGroupId}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
    });
    closeGroupInfoModal();
    currentGroupId = null;
    document.querySelector('.chat-title').innerText = 'Выберите чат';
    document.getElementById('messages').innerHTML = '';
    loadGroups();
}

async function leaveGroup() {
    if (!confirm('Выйти из группы?')) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/groups/${currentGroupId}/leave`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
    });
    const data = await res.json();
    if (res.ok) {
        closeGroupInfoModal();
        currentGroupId = null;
        document.querySelector('.chat-title').innerText = 'Выберите чат';
        document.getElementById('messages').innerHTML = '';
        loadGroups();
    } else {
        alert(data.error);
    }
}

// ========== Профиль ==========
async function loadProfile() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/me', { headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    document.getElementById('avatarPreview').innerText = data.avatar || '😀';
    document.getElementById('colorInput').value = data.color || '#6ab0f3';
}

async function updateProfile(avatar, color) {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/me/update', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ avatar, color })
    });
    if (res.ok) {
        currentUser.avatar = avatar;
        currentUser.color = color;
        alert('Профиль обновлён');
    } else alert('Ошибка обновления');
}

// ========== Emoji ==========
const emojiCategories = [
    { icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😋','😛','😜','🤪','😎','🥳','😏','😒','😔','😟','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','🤗','🤔','🤫','🤥','😶','😐','😑','😬','🙄','😯','😲','🥱','😴','🤤','😵','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','👽','🤖','😺','😸','😹','😻','😼','😽','🙀','😿','😾'] },
    { icon: '👍', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤏','✍️','💅','💪','🙌','👏','🤝','🙏','👐','🤲'] },
    { icon: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🐢','🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐡','🐠','🐟','🐬','🐳','🐋','🦈'] },
    { icon: '🍎', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🧄','🥔','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🍜','🍝','🍣','🍱','🍛','🍲','🍰','🎂','🧁','🍩','🍪','☕','🍵','🧃','🥤','🧋','🍺','🍻','🥂','🍷'] },
    { icon: '⚽', emojis: ['⚽','🏀','🏈','⚾','🥎','🎾','🏐','🏉','🎱','🏓','🏸','🥊','🥋','🎽','🛹','⛸️','🎿','🏆','🥇','🥈','🥉','🏅','🎮','🕹️','🎲','♟️','🎯','🎳'] },
    { icon: '❤️', emojis: ['❤️','🧡','💛','💚','💙','💜','🖤','🤍','🤎','💔','❣️','💕','💞','💓','💗','💖','💘','💝','✨','🌟','⭐','🔥','💫','🌈','☀️','🌙','⚡','❄️','🌊','🎉','🎊','🎈','🎁','🏆','🌺','🌸','🌹','💐','🍀','🌴'] },
];

function initEmojiPicker() {
    const panel = document.getElementById('emojiPickerPanel');
    const toggleBtn = document.getElementById('emojiToggleBtn');
    const grid = document.getElementById('emojiGrid');
    const catsContainer = document.getElementById('emojiCategories');
    const input = document.getElementById('messageInput');

    emojiCategories.forEach((cat, i) => {
        const btn = document.createElement('button');
        btn.className = 'emoji-cat-btn' + (i === 0 ? ' active' : '');
        btn.innerText = cat.icon;
        btn.addEventListener('click', () => {
            document.querySelectorAll('#emojiCategories .emoji-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderEmojiGrid(cat.emojis);
        });
        catsContainer.appendChild(btn);
    });
    renderEmojiGrid(emojiCategories[0].emojis);

    function renderEmojiGrid(emojis) {
        grid.innerHTML = '';
        emojis.forEach(emoji => {
            const span = document.createElement('span');
            span.innerText = emoji;
            span.addEventListener('click', () => { input.value += emoji; input.focus(); });
            grid.appendChild(span);
        });
    }

    toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('open'); });
    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && e.target !== toggleBtn) panel.classList.remove('open');
    });
}

function initAvatarPicker() {
    const avatarPreview = document.getElementById('avatarPreview');
    const pickerBtn = document.getElementById('pickAvatarBtn');
    const panel = document.getElementById('avatarEmojiPanel');
    const grid = document.getElementById('avatarEmojiGrid');
    const catsContainer = document.getElementById('avatarEmojiCategories');
    if (!avatarPreview || !pickerBtn) return;

    emojiCategories.forEach((cat, i) => {
        const btn = document.createElement('button');
        btn.className = 'emoji-cat-btn' + (i === 0 ? ' active' : '');
        btn.innerText = cat.icon;
        btn.addEventListener('click', () => {
            document.querySelectorAll('#avatarEmojiCategories .emoji-cat-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderAvatarGrid(cat.emojis);
        });
        catsContainer.appendChild(btn);
    });
    renderAvatarGrid(emojiCategories[0].emojis);

    function renderAvatarGrid(emojis) {
        grid.innerHTML = '';
        emojis.forEach(emoji => {
            const span = document.createElement('span');
            span.innerText = emoji;
            span.addEventListener('click', () => { avatarPreview.innerText = emoji; panel.classList.remove('open'); });
            grid.appendChild(span);
        });
    }

    pickerBtn.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('open'); });
    document.addEventListener('click', (e) => {
        if (!panel.contains(e.target) && e.target !== pickerBtn) panel.classList.remove('open');
    });

    const colorInput = document.getElementById('colorInput');
    const colorPreview = document.getElementById('colorPreview');
    const colorHex = document.getElementById('colorHex');
    const presets = document.querySelectorAll('.color-preset');

    function updateColor(hex) {
        colorPreview.style.background = hex;
        colorHex.innerText = hex;
        colorInput.value = hex;
        presets.forEach(p => p.classList.toggle('active', p.getAttribute('data-color') === hex));
    }
    updateColor(colorInput.value || '#6ab0f3');
    colorPreview.addEventListener('click', () => colorInput.click());
    colorHex.addEventListener('click', () => colorInput.click());
    colorInput.addEventListener('input', () => updateColor(colorInput.value));
    presets.forEach(p => p.addEventListener('click', () => updateColor(p.getAttribute('data-color'))));
}

// ========== Утилиты ==========
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, m => m === '&' ? '&amp;' : m === '<' ? '&lt;' : '&gt;');
}

function notify() {
    document.title = '✉️ Новое сообщение';
    setTimeout(() => { document.title = 'Мессенджер'; }, 2000);
}

function showNotification(text) {
    if (Notification.permission === 'granted') new Notification(text);
    else if (Notification.permission !== 'denied') Notification.requestPermission();
}

// ========== Typing ==========
let typingTimer;
document.getElementById('messageInput').addEventListener('input', () => {
    if (typingTimer) clearTimeout(typingTimer);
    if (!socket) return;
    if (currentGroupId) {
        socket.emit('typing', { groupId: currentGroupId });
    } else if (currentChat) {
        socket.emit('typing', { to: currentChat });
    }
    typingTimer = setTimeout(() => {}, 1500);
});

// ========== Вкладки ==========
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-tab');
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`${tabId}-tab`).classList.add('active');
        if (tabId === 'friends') loadFriends();
        if (tabId === 'requests') loadFriendRequests();
        if (tabId === 'groups') loadGroups();
    });
});

document.getElementById('menuToggleBtn').addEventListener('click', () => sidebar.classList.toggle('open'));
document.getElementById('saveProfileBtn').addEventListener('click', () => {
    const avatar = document.getElementById('avatarPreview').innerText;
    const color = document.getElementById('colorInput').value;
    updateProfile(avatar, color);
});

// ========== Старт ==========
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
        loadGroups();
        loadProfile();
        document.getElementById('userInfo').innerHTML = `👤 ${currentUser.username}`;
        document.querySelector('.chat-title').innerText = 'Выберите чат';
        document.getElementById('messageInput').placeholder = 'Выберите чат...';
        initAvatarPicker();
    }
    if (Notification.permission !== 'granted') Notification.requestPermission();
    initEmojiPicker();

    // Мобильная клавиатура: прокручиваем вниз при фокусе на поле ввода
    const msgInput = document.getElementById('messageInput');
    msgInput.addEventListener('focus', () => {
        if (window.innerWidth <= 768) {
            setTimeout(() => {
                const msgs = document.getElementById('messages');
                msgs.scrollTop = msgs.scrollHeight;
                msgInput.scrollIntoView({ behavior: 'smooth', block: 'end' });
            }, 350);
        }
    });

    // visualViewport API — подстраиваем высоту при открытии клавиатуры
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const main = document.querySelector('.main');
            if (main && window.innerWidth <= 768) {
                main.style.height = window.visualViewport.height + 'px';
                const msgs = document.getElementById('messages');
                msgs.scrollTop = msgs.scrollHeight;
            }
        });
    }
};

document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('messageInput').onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };
document.getElementById('logoutBtn').onclick = logout;
