let socket;
let currentUser = null;
let currentChat = null;
let currentGroupId = null;
let typingTimeout;
let messagesContainer;
let replyingTo = null;
let unreadCounts = {};

const authDiv = document.getElementById('auth');
const chatDiv = document.getElementById('chat');
const sidebar = document.getElementById('sidebar');

// ========== Auth ==========
function showError(msg) {
    const el = document.getElementById('authError');
    el.innerText = msg;
    if (msg) { clearTimeout(el._t); el._t = setTimeout(() => el.innerText = '', 3000); }
}

async function register() {
    showError('');
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!username) return showError('Введите имя пользователя');
    if (username.length < 3) return showError('Минимум 3 символа');
    if (!password || password.length < 8) return showError('Пароль минимум 8 символов');
    const res = await fetch('/api/register', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
    const data = await res.json();
    if (res.ok) loginSuccess(data.token, data.user);
    else showError(data.error === 'Username taken' ? 'Это имя уже занято' : data.error);
}

async function login() {
    showError('');
    const username = document.getElementById('authUsername').value.trim();
    const password = document.getElementById('authPassword').value;
    if (!username) return showError('Введите имя пользователя');
    if (!password || password.length < 8) return showError('Пароль минимум 8 символов');
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username, password }) });
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
    loadUnread();
    document.getElementById('userInfo').innerHTML = `👤 ${user.username}`;
    document.querySelector('.chat-title').innerText = 'Выберите чат';
    document.getElementById('messageInput').placeholder = 'Выберите чат...';
}

function logout() {
    localStorage.removeItem('token'); localStorage.removeItem('user');
    if (socket) socket.disconnect();
    authDiv.style.display = 'flex'; chatDiv.style.display = 'none';
    currentUser = null; currentChat = null; currentGroupId = null;
}

// ========== Socket ==========
function initSocket(token) {
    socket = io({ auth: { token } });
    socket.on('connect', () => console.log('connected'));
    socket.on('history', () => {});

    socket.on('private_message', (msg) => {
        if (currentChat === msg.from || currentChat === msg.to) {
            addMessageToChat(msg);
            markRead(msg.from);
        } else {
            unreadCounts[msg.from] = (unreadCounts[msg.from] || 0) + 1;
            updateUnreadBadge(msg.from);
            showNotification(`💬 ${msg.from}: ${msg.text || '📷 Фото'}`);
        }
        notify();
    });

    socket.on('group_message', (msg) => {
        if (currentGroupId && currentGroupId === String(msg.groupId)) {
            addMessageToChat(msg);
        } else {
            showNotification(`💬 Сообщение в группе`);
        }
        notify();
    });

    socket.on('message_edited', (data) => {
        const el = document.querySelector(`.message[data-id="${data.messageId}"]`);
        if (!el) return;
        const t = el.querySelector('.message-text');
        if (t) t.innerHTML = formatText(data.newText);
        if (!el.querySelector('.edited-badge')) {
            const span = document.createElement('span');
            span.className = 'edited-badge';
            span.innerText = 'ред.';
            el.querySelector('.msg-meta')?.appendChild(span);
        }
    });

    socket.on('message_deleted', (data) => {
        const el = document.querySelector(`.message[data-id="${data.messageId}"]`);
        if (!el) return;
        if (data.hardDelete) {
            el.remove();
        } else {
            const t = el.querySelector('.message-text');
            if (t) t.innerHTML = '<em class="deleted-text">Сообщение удалено</em>';
            const img = el.querySelector('.msg-image');
            if (img) img.remove();
            el.querySelector('.message-actions')?.remove();
            el.querySelector('.reaction-bar')?.remove();
        }
    });

    socket.on('reaction_updated', (data) => {
        const el = document.querySelector(`.message[data-id="${data.messageId}"]`);
        if (!el) return;
        let bar = el.querySelector('.reaction-bar');
        if (!bar) {
            bar = document.createElement('div');
            bar.className = 'reaction-bar';
            el.querySelector('.message-bubble').appendChild(bar);
        }
        renderReactionBar(bar, data.reactions, data.messageId);
    });

    socket.on('messages_read', (data) => {
        if (currentChat === data.chatWith || data.chatWith === currentUser?.username) {
            document.querySelectorAll('.message.own .read-status').forEach(el => {
                el.innerHTML = '✓✓'; el.classList.add('read');
            });
        }
    });

    socket.on('private_message_sent', (data) => {
        // Сервер подтвердил — сообщение доставлено, галочка одна
        const el = document.querySelector(`.message[data-id="${data._id}"] .read-status`);
        if (el) { el.innerHTML = '✓'; }
    });

    socket.on('friend_status', (data) => updateFriendStatus(data.username, data.online));
    socket.on('friend_request', (data) => { showNotification(`👤 Запрос от ${data.from}`); loadFriendRequests(); });
    socket.on('friend_accepted', (data) => { showNotification(`✅ ${data.by} принял запрос`); loadFriends(); });

    socket.on('typing', (data) => {
        const isCurrent = data.groupId
            ? currentGroupId && String(currentGroupId) === String(data.groupId)
            : currentChat === data.from;
        if (!isCurrent) return;
        const ind = document.getElementById('typingIndicator');
        ind.innerHTML = `<span class="typing-dots"><span></span><span></span><span></span></span> ${data.from} печатает`;
        ind.classList.add('active');
        clearTimeout(typingTimeout);
        typingTimeout = setTimeout(() => { ind.innerHTML = ''; ind.classList.remove('active'); }, 2000);
    });

    socket.on('group_added', (data) => { showNotification(`👥 Добавлен в «${data.group.name}»`); loadGroups(); socket.emit('join_group_room', data.group._id); });
    socket.on('group_deleted', (data) => {
        if (currentGroupId === String(data.groupId)) { currentGroupId = null; document.querySelector('.chat-title').innerText = 'Выберите чат'; document.getElementById('messages').innerHTML = ''; }
        loadGroups();
    });
    socket.on('group_member_joined', () => loadGroups());
    socket.on('group_member_left', () => loadGroups());

    // ===== WebRTC сигнализация =====
    socket.on('incoming_call', async (data) => {
        if (peerConnection) { socket.emit('call_reject', { to: data.from }); return; }
        callWith = data.from;
        peerConnection = new RTCPeerConnection(iceServers);
        peerConnection.onicecandidate = (e) => {
            if (e.candidate) socket.emit('call_ice', { to: callWith, candidate: e.candidate });
        };
        peerConnection.ontrack = (e) => {
            document.getElementById('remoteAudio').srcObject = e.streams[0];
            document.getElementById('callStatus').innerText = 'Звонок';
        };
        peerConnection.onconnectionstatechange = () => {
            if (peerConnection?.connectionState === 'connected')
                document.getElementById('callStatus').innerText = 'Звонок';
        };
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.offer));
        showCallOverlay(data.from, data.avatar, 'Входящий звонок', true);
    });

    socket.on('call_answered', async (data) => {
        await peerConnection.setRemoteDescription(new RTCSessionDescription(data.answer));
        document.getElementById('callStatus').innerText = 'Звонок';
        document.getElementById('callMuteBtn').style.display = 'flex';
    });

    socket.on('call_ice', async (data) => {
        try { await peerConnection?.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e) {}
    });

    socket.on('call_rejected', () => {
        document.getElementById('callStatus').innerText = 'Недоступен';
        setTimeout(cleanupCall, 2000);
    });

    socket.on('call_ended', () => {
        document.getElementById('callStatus').innerText = 'Звонок завершён';
        setTimeout(cleanupCall, 1500);
    });
}

// ========== Сообщения ==========
function sendMessage() {
    const input = document.getElementById('messageInput');
    const text = input.value.trim();
    if (!text) return;
    const replyData = replyingTo ? { messageId: replyingTo.id, from: replyingTo.from, text: replyingTo.text } : null;
    if (currentGroupId) {
        socket.emit('send_group_message', { groupId: currentGroupId, text, replyTo: replyData });
    } else if (currentChat) {
        socket.emit('send_message', { to: currentChat, text, replyTo: replyData });
    }
    input.value = '';
    clearReply();
}

async function sendImage(file) {
    const formData = new FormData();
    formData.append('image', file);
    const token = localStorage.getItem('token');
    const res = await fetch('/api/upload', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` }, body: formData });
    if (!res.ok) return alert('Ошибка загрузки');
    const data = await res.json();
    const replyData = replyingTo ? { messageId: replyingTo.id, from: replyingTo.from, text: replyingTo.text } : null;
    if (currentGroupId) {
        socket.emit('send_group_message', { groupId: currentGroupId, text: '', imageUrl: data.imageUrl, replyTo: replyData });
    } else if (currentChat) {
        socket.emit('send_message', { to: currentChat, text: '', imageUrl: data.imageUrl, replyTo: replyData });
    }
    clearReply();
}

function setReply(id, from, text) {
    replyingTo = { id, from, text };
    const bar = document.getElementById('replyBar');
    document.getElementById('replyFrom').innerText = from;
    document.getElementById('replyText').innerText = text?.slice(0, 60) || '📷 Фото';
    bar.style.display = 'flex';
    document.getElementById('messageInput').focus();
}

function clearReply() {
    replyingTo = null;
    document.getElementById('replyBar').style.display = 'none';
}

async function markRead(fromUser) {
    const token = localStorage.getItem('token');
    await fetch('/api/messages/read', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ with: fromUser })
    });
    unreadCounts[fromUser] = 0;
    updateUnreadBadge(fromUser);
    // Сообщаем собеседнику что сообщения прочитаны — через сокет
    if (socket) socket.emit('mark_read', { chatWith: fromUser });
}

async function loadUnread() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/unread', { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) {
        unreadCounts = await res.json();
        Object.entries(unreadCounts).forEach(([user, count]) => updateUnreadBadge(user));
    }
}

function updateUnreadBadge(username) {
    const item = document.querySelector(`[data-chat-key="dm_${username}"]`);
    if (!item) return;
    let badge = item.querySelector('.unread-badge');
    const count = unreadCounts[username] || 0;
    if (count > 0) {
        if (!badge) { badge = document.createElement('span'); badge.className = 'unread-badge'; item.appendChild(badge); }
        badge.innerText = count > 99 ? '99+' : count;
    } else {
        badge?.remove();
    }
}

// ========== Рендер сообщения ==========
function formatText(str) {
    if (!str) return '';
    return escapeHtml(str)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>');
}

function renderReactionBar(bar, reactions, messageId) {
    bar.innerHTML = '';
    if (!reactions || reactions.length === 0) return;
    reactions.forEach(r => {
        if (r.users.length === 0) return;
        const btn = document.createElement('button');
        btn.className = 'reaction-btn' + (r.users.includes(currentUser.username) ? ' reacted' : '');
        btn.innerHTML = `${r.emoji} <span>${r.users.length}</span>`;
        btn.title = r.users.join(', ');
        btn.onclick = () => addReaction(messageId, r.emoji);
        bar.appendChild(btn);
    });
}

function addMessageToChat(msg) {
    const container = messagesContainer || document.getElementById('messages');
    messagesContainer = container;
    const isOwn = msg.from === currentUser.username;
    const div = document.createElement('div');
    div.className = `message ${isOwn ? 'own' : 'other'}`;
    div.setAttribute('data-id', msg._id);
    const _isReadByOther = msg.readBy && currentChat && msg.readBy.includes(currentChat);
    div.setAttribute('data-read', _isReadByOther ? 'true' : 'false');
    const color = msg.color || '#6ab0f3';
    const time = new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // Reply block
    let replyHtml = '';
    if (msg.replyTo && msg.replyTo.messageId) {
        replyHtml = `<div class="reply-preview" onclick="scrollToMessage('${msg.replyTo.messageId}')">
            <span class="reply-author">${escapeHtml(msg.replyTo.from)}</span>
            <span class="reply-content">${escapeHtml((msg.replyTo.text || '📷 Фото').slice(0, 50))}</span>
        </div>`;
    }

    // Image
    let imageHtml = '';
    if (msg.imageUrl) {
        imageHtml = `<img src="${escapeHtml(msg.imageUrl)}" class="msg-image" onclick="openImageModal('${escapeHtml(msg.imageUrl)}')" loading="lazy">`;
    }

    // Text
    let textHtml = '';
    if (msg.deleted) {
        textHtml = '<em class="deleted-text">Сообщение удалено</em>';
    } else if (msg.text) {
        textHtml = `<div class="message-text">${formatText(msg.text)}</div>`;
    }

    // Read status (only for own)
    const isRead = msg.readBy && msg.readBy.includes(currentChat || '');
    const readStatusHtml = isOwn ? `<span class="read-status ${isRead ? 'read' : ''}">✓</span>` : '';

    // Аватарка: берём из DOM текущих друзей для актуальности
    const senderAvatar = msg.avatar || '😀';

    div.innerHTML = `
        <div class="msg-avatar-wrap">
            ${!isOwn ? `<span class="msg-avatar">${escapeHtml(senderAvatar)}</span>` : ''}
        </div>
        <div class="msg-body">
            <div class="message-bubble">
                ${replyHtml}
                <div class="msg-sender" style="color:${color}">${isOwn ? '' : escapeHtml(msg.from)}</div>
                ${imageHtml}
                ${textHtml}
                <div class="msg-meta">
                    <span class="msg-time">${time}</span>
                    ${msg.edited ? '<span class="edited-badge">ред.</span>' : ''}
                    ${readStatusHtml}
                </div>
            </div>
            <div class="reaction-bar"></div>
        </div>
    `;

    // Реакции
    const bar = div.querySelector('.reaction-bar');
    if (msg.reactions && msg.reactions.length > 0) renderReactionBar(bar, msg.reactions, msg._id);

    // Контекстное меню по правой кнопке мыши
    const bubble = div.querySelector('.message-bubble');
    bubble.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        openMsgMenu(msg, div, isOwn, e);
    });
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
}

function renderMessages(messages) {
    messagesContainer = document.getElementById('messages');
    messagesContainer.innerHTML = '';
    messages.forEach(msg => addMessageToChat(msg));
}

function scrollToMessage(id) {
    const el = document.querySelector(`.message[data-id="${id}"]`);
    if (el) { el.scrollIntoView({ behavior: 'smooth', block: 'center' }); el.classList.add('highlight'); setTimeout(() => el.classList.remove('highlight'), 1500); }
}

// ========== Контекстное меню сообщения (TG-стиль) ==========
function openMsgMenu(msg, msgDiv, isOwn, e) {
    closeMsgMenu();
    const menu = document.createElement('div');
    menu.className = 'msg-context-menu';
    menu.id = 'msgContextMenu';

    const items = [];

    // Реакция — всегда
    if (!msg.deleted) {
        items.push({ icon: '😊', label: 'Реакция', action: () => {
            closeMsgMenu();
            openReactionPicker(msg._id, msgDiv.querySelector('.message-bubble'));
        }});
    }

    // Ответить — всегда
    items.push({ icon: '↩', label: 'Ответить', action: () => {
        closeMsgMenu();
        setReply(msg._id, msg.from, msg.text);
    }});

    // Редактировать — только своё и не удалённое
    if (isOwn && !msg.deleted && msg.text) {
        items.push({ icon: '✎', label: 'Редактировать', action: () => {
            closeMsgMenu();
            openEditModal(msg);
        }});
    }

    // Удалить — только своё и не удалённое
    if (isOwn && !msg.deleted) {
        items.push({ icon: '🗑', label: 'Удалить', danger: true, action: () => {
            closeMsgMenu();
            openDeleteModal(msg._id);
        }});
    }

    items.forEach(item => {
        const btn = document.createElement('button');
        btn.className = 'msg-menu-btn' + (item.danger ? ' danger' : '');
        btn.innerHTML = `<span class="msg-menu-icon">${item.icon}</span><span>${item.label}</span>`;
        btn.onclick = item.action;
        menu.appendChild(btn);
    });

    document.body.appendChild(menu);

    // Позиционирование
    const rect = msgDiv.querySelector('.message-bubble').getBoundingClientRect();
    const menuW = 180, menuH = items.length * 44 + 12;
    let top = rect.bottom + 6;
    let left = isOwn ? rect.right - menuW : rect.left;
    if (top + menuH > window.innerHeight - 10) top = rect.top - menuH - 6;
    if (left < 8) left = 8;
    if (left + menuW > window.innerWidth - 8) left = window.innerWidth - menuW - 8;
    menu.style.top = top + window.scrollY + 'px';
    menu.style.left = left + 'px';

    // Анимация
    requestAnimationFrame(() => menu.classList.add('open'));

    setTimeout(() => {
        document.addEventListener('click', closeMsgMenuOnOutside, { once: true });
    }, 50);
}

function closeMsgMenuOnOutside(e) {
    if (!document.getElementById('msgContextMenu')?.contains(e.target)) {
        closeMsgMenu();
    } else {
        document.addEventListener('click', closeMsgMenuOnOutside, { once: true });
    }
}

function closeMsgMenu() {
    document.getElementById('msgContextMenu')?.remove();
}

// Редактирование inline
let editingMsgId = null;

function startInlineEdit(msg) {
    editingMsgId = msg._id;
    const input = document.getElementById('messageInput');
    input.value = msg.text;
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);

    // Показываем бар редактирования (переиспользуем replyBar)
    document.getElementById('replyBar').style.display = 'flex';
    document.getElementById('replyFrom').innerText = '✎ Редактирование';
    document.getElementById('replyText').innerText = msg.text?.slice(0, 60) || '';

    // Подменяем sendMessage на сохранение правки
    document.getElementById('sendBtn').onclick = saveInlineEdit;
    input.onkeypress = (e) => { if (e.key === 'Enter') saveInlineEdit(); };
}

function saveInlineEdit() {
    const input = document.getElementById('messageInput');
    const newText = input.value.trim();
    if (newText && editingMsgId) {
        socket.emit('edit_message', { messageId: editingMsgId, newText });
    }
    cancelInlineEdit();
}

function cancelInlineEdit() {
    editingMsgId = null;
    document.getElementById('messageInput').value = '';
    clearReply();
    // Восстанавливаем обычный sendMessage
    document.getElementById('sendBtn').onclick = sendMessage;
    document.getElementById('messageInput').onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };
}

// Удаление с подтверждением
function openDeleteModal(messageId) {
    const modal = document.getElementById('deleteMsgModal');
    modal.classList.add('open');
    document.getElementById('deleteMsgConfirmBtn').onclick = () => {
        socket.emit('delete_message', { messageId });
        modal.classList.remove('open');
    };
    document.getElementById('deleteMsgCancelBtn').onclick = () => modal.classList.remove('open');
}

// ========== Реакции ==========
const quickReactions = ['👍','❤️','😂','😮','😢','🔥'];

function openReactionPicker(messageId, anchor) {
    document.querySelectorAll('.reaction-picker').forEach(p => p.remove());
    const picker = document.createElement('div');
    picker.className = 'reaction-picker';
    quickReactions.forEach(emoji => {
        const btn = document.createElement('button');
        btn.className = 'reaction-pick-btn';
        btn.innerText = emoji;
        btn.onclick = () => { addReaction(messageId, emoji); picker.remove(); };
        picker.appendChild(btn);
    });
    document.body.appendChild(picker);
    const rect = anchor.getBoundingClientRect();
    const pickerW = quickReactions.length * 44 + 12;
    let top = rect.top - 56 + window.scrollY;
    let left = rect.left;
    if (left + pickerW > window.innerWidth - 8) left = window.innerWidth - pickerW - 8;
    if (left < 8) left = 8;
    if (top < 8) top = rect.bottom + 8 + window.scrollY;
    picker.style.top = top + 'px';
    picker.style.left = left + 'px';
    setTimeout(() => document.addEventListener('click', () => picker.remove(), { once: true }), 50);
}

async function addReaction(messageId, emoji) {
    const token = localStorage.getItem('token');
    await fetch(`/api/messages/${messageId}/react`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ emoji })
    });
}

// ========== Изображения ==========
function openImageModal(url) {
    const modal = document.getElementById('imageModal');
    document.getElementById('imageModalImg').src = url;
    modal.classList.add('open');
}
function closeImageModal() { document.getElementById('imageModal').classList.remove('open'); }

// ========== Переключение чатов ==========
const chatDrafts = {};

function saveDraft() {
    const input = document.getElementById('messageInput');
    const key = currentGroupId ? 'group_' + currentGroupId : currentChat ? 'dm_' + currentChat : null;
    if (key) chatDrafts[key] = input.value;
}

function restoreDraft(key) {
    const input = document.getElementById('messageInput');
    input.value = chatDrafts[key] || '';
}

function switchChat(username) {
    saveDraft();
    currentChat = username; currentGroupId = null;
    document.querySelector('.chat-title').innerText = username;
    document.getElementById('groupInfoBtn').style.display = 'none';
    document.getElementById('messageInput').placeholder = 'Сообщение...';
    restoreDraft('dm_' + username);
    fetchHistoryForUser(username);
    markRead(username);
    document.querySelectorAll('.message.own .read-status').forEach(el => {
        el.innerHTML = '✓✓'; el.classList.add('read');
    });
    if (window.innerWidth <= 768) sidebar.classList.remove('open');
    setActiveChatItem('dm_' + username);
}

async function switchGroupChat(groupId, groupName) {
    saveDraft();
    currentGroupId = groupId; currentChat = null;
    document.querySelector('.chat-title').innerText = groupName;
    document.getElementById('groupInfoBtn').style.display = 'flex';
    document.getElementById('messageInput').placeholder = 'Сообщение в группу...';
    restoreDraft('group_' + groupId);
    if (window.innerWidth <= 768) sidebar.classList.remove('open');
    setActiveChatItem('group_' + groupId);
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/groups/${groupId}/messages`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) renderMessages(await res.json());
}

function setActiveChatItem(key) {
    document.querySelectorAll('.user-item, .group-item').forEach(el => el.classList.remove('active-chat'));
    document.querySelector(`[data-chat-key="${key}"]`)?.classList.add('active-chat');
}

async function fetchHistoryForUser(user) {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/messages?with=${user}`, { headers: { 'Authorization': `Bearer ${token}` } });
    const messages = await res.json();
    renderMessages(messages.filter(m =>
        (m.from === currentUser.username && m.to === user) || (m.from === user && m.to === currentUser.username)
    ));
    // После рендера — обновляем галочки если уже прочитано
    setTimeout(updateReadStatusInCurrentChat, 100);
}

function updateReadStatusInCurrentChat() {
    if (!currentChat) return;
    // Проверяем readBy у каждого сообщения через DOM data-атрибут
    document.querySelectorAll('.message.own').forEach(el => {
        const status = el.querySelector('.read-status');
        if (!status) return;
        // Если readBy включает собеседника — помечаем прочитанным
        const isRead = el.getAttribute('data-read') === 'true';
        if (isRead) { status.innerHTML = '✓✓'; status.classList.add('read'); }
    });
}

// ========== Друзья ==========
async function loadFriends() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/friends', { headers: { 'Authorization': `Bearer ${token}` } });
    const friends = await res.json();
    const container = document.getElementById('friendsList');
    container.innerHTML = '';
    if (friends.length === 0) { container.innerHTML = '<div class="empty-hint">Найдите друзей во вкладке Поиск</div>'; return; }
    friends.forEach(friend => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.setAttribute('data-chat-key', 'dm_' + friend.username);
        div.onclick = () => switchChat(friend.username);
        const count = unreadCounts[friend.username] || 0;

        // Последнее сообщение
        let lastMsgHtml = '';
        if (friend.lastMessage) {
            const prefix = friend.lastMessage.fromMe ? 'Вы: ' : '';
            const txt = escapeHtml((friend.lastMessage.text || '').slice(0, 35));
            const t = new Date(friend.lastMessage.timestamp);
            const now = new Date();
            const isToday = t.toDateString() === now.toDateString();
            const timeStr = isToday
                ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : t.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
            lastMsgHtml = `<div class="friend-last-msg"><span class="last-msg-text">${prefix}${txt}</span><span class="last-msg-time">${timeStr}</span></div>`;
        }

        div.innerHTML = `
            <div class="friend-avatar-wrap">
                <span class="user-avatar">${escapeHtml(friend.avatar || '😀')}</span>
                ${friend.online ? '<span class="friend-online-dot"></span>' : ''}
            </div>
            <div class="friend-info">
                <div class="friend-name-row">
                    <span class="user-name">${escapeHtml(friend.username)}</span>
                    ${count > 0 ? `<span class="unread-badge">${count > 99 ? '99+' : count}</span>` : ''}
                </div>
                ${lastMsgHtml}
            </div>
        `;
        div.querySelector('.friend-info').insertAdjacentHTML('afterend',
            `<button onclick="event.stopPropagation(); startCall('${escapeHtml(friend.username)}')"
             style="background:none; border:none; font-size:18px; cursor:pointer; padding:4px 6px; border-radius:8px; color:var(--text-secondary);"
             title="Позвонить">📞</button>`
        );
        container.appendChild(div);
    });
}

async function loadFriendRequests() {
    const token = localStorage.getItem('token');
    const requests = await (await fetch('/api/friend-requests', { headers: { 'Authorization': `Bearer ${token}` } })).json();
    const container = document.getElementById('requestsList');
    container.innerHTML = '';
    if (requests.length === 0) { container.innerHTML = '<div class="empty-hint">Нет входящих запросов</div>'; return; }
    requests.forEach(from => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `<span class="user-name">${escapeHtml(from)}</span>
            <div><button class="accept-btn" data-from="${from}">Принять</button>
            <button class="reject-btn" data-from="${from}">Отклонить</button></div>`;
        container.appendChild(div);
    });
    document.querySelectorAll('.accept-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await fetch('/api/friend-request/accept', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ from: btn.dataset.from }) });
            loadFriendRequests(); loadFriends();
        });
    });
    document.querySelectorAll('.reject-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            await fetch('/api/friend-request/reject', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ from: btn.dataset.from }) });
            loadFriendRequests();
        });
    });
}

function updateFriendStatus(username, online) {
    document.querySelectorAll('#friendsList .user-item').forEach(div => {
        if (div.querySelector('.user-name')?.innerText === username) {
            const wrap = div.querySelector('.friend-avatar-wrap');
            const dot = div.querySelector('.friend-online-dot');
            if (online && !dot && wrap) wrap.insertAdjacentHTML('beforeend', '<span class="friend-online-dot"></span>');
            else if (!online && dot) dot.remove();
        }
    });
}

// ========== Поиск ==========
document.getElementById('searchUserInput').addEventListener('input', async (e) => {
    const q = e.target.value;
    if (q.length < 2) { document.getElementById('searchResults').innerHTML = ''; return; }
    const token = localStorage.getItem('token');
    const users = await (await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { headers: { 'Authorization': `Bearer ${token}` } })).json();
    const container = document.getElementById('searchResults');
    container.innerHTML = '';
    users.forEach(user => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `<span class="user-avatar">${escapeHtml(user.avatar || '😀')}</span>
            <span class="user-name">${escapeHtml(user.username)}</span>
            <button class="friend-request-btn" data-username="${user.username}">Добавить</button>`;
        container.appendChild(div);
    });
    document.querySelectorAll('.friend-request-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const res = await fetch('/api/friend-request', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` }, body: JSON.stringify({ to: btn.dataset.username }) });
            const data = await res.json();
            btn.innerText = '✓'; btn.disabled = true;
        });
    });
});

// ========== Группы ==========
async function loadGroups() {
    const token = localStorage.getItem('token');
    const groups = await (await fetch('/api/groups', { headers: { 'Authorization': `Bearer ${token}` } })).json();
    const container = document.getElementById('groupsList');
    container.innerHTML = '';
    if (groups.length === 0) { container.innerHTML = '<div class="empty-hint">Нет групп. Создайте первую!</div>'; return; }
    groups.forEach(group => {
        const div = document.createElement('div');
        div.className = 'group-item user-item';
        div.setAttribute('data-chat-key', 'group_' + group._id);
        div.onclick = () => switchGroupChat(group._id, group.name);
        div.innerHTML = `
            <span class="user-avatar">${escapeHtml(group.avatar || '👥')}</span>
            <div class="user-info-row" style="flex-direction:column;align-items:flex-start;gap:2px;">
                <span class="user-name">${escapeHtml(group.name)}</span>
                <span class="group-meta">${group.members.length} уч. · ${group.type === 'public' ? 'публичная' : 'закрытая'}</span>
            </div>
            ${group.owner === currentUser.username ? '<span class="crown">👑</span>' : ''}
        `;
        container.appendChild(div);
    });
}

function openCreateGroupModal() {
    document.getElementById('createGroupModal').classList.add('open');
    loadFriendsForGroupModal();
}
function closeCreateGroupModal() {
    document.getElementById('createGroupModal').classList.remove('open');
    document.getElementById('newGroupName').value = '';
    document.getElementById('newGroupDesc').value = '';
    document.getElementById('groupMemberCheckboxes').innerHTML = '';
    document.querySelector('input[name="groupType"][value="private"]').checked = true;
    document.getElementById('groupTypeSelect').value = 'private';
    document.getElementById('groupAvatarPreview').innerText = '👥';
}

function getGroupInviteLink() {
    const code = document.getElementById('groupInfoCode')?.innerText?.trim();
    if (!code) return;
    const link = code;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(link).then(() => {
            const btn = document.querySelector('#groupInfoModal .secondary-btn');
            const orig = btn.innerText;
            btn.innerText = '✓ Скопировано';
            setTimeout(() => btn.innerText = orig, 2000);
        }).catch(() => fallbackCopyLink(link));
    } else {
        fallbackCopyLink(link);
    }
}

function fallbackCopyLink(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try { document.execCommand('copy'); } catch(e) {}
    document.body.removeChild(ta);
}

async function loadFriendsForGroupModal() {
    const token = localStorage.getItem('token');
    const friends = await (await fetch('/api/friends', { headers: { 'Authorization': `Bearer ${token}` } })).json();
    const container = document.getElementById('groupMemberCheckboxes');
    container.innerHTML = '';
    if (friends.length === 0) { container.innerHTML = '<div class="empty-hint">Нет друзей для добавления</div>'; return; }
    friends.forEach(f => {
        const label = document.createElement('label');
        label.className = 'member-checkbox-label';
        label.innerHTML = `<input type="checkbox" value="${escapeHtml(f.username)}"><span>${escapeHtml(f.avatar || '😀')} ${escapeHtml(f.username)}</span>`;
        container.appendChild(label);
    });
}

async function createGroup() {
    const name = document.getElementById('newGroupName').value.trim();
    if (!name) return alert('Введите название');
    const description = document.getElementById('newGroupDesc').value.trim();
    const type = document.querySelector('input[name="groupType"]:checked').value;
    const avatar = document.getElementById('groupAvatarPreview').innerText;
    const members = [...document.querySelectorAll('#groupMemberCheckboxes input:checked')].map(cb => cb.value);
    const token = localStorage.getItem('token');
    const res = await fetch('/api/groups', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ name, description, type, avatar, members }) });
    const data = await res.json();
    if (res.ok) {
        closeCreateGroupModal();
        socket.emit('join_group_room', data.group._id);
        loadGroups();
        switchGroupChat(data.group._id, data.group.name);
        setTimeout(() => showInviteCode(data.group.inviteCode, data.group.name, data.group.type), 300);
    } else alert(data.error);
}

function showInviteCode(code, name, type) {
    document.getElementById('inviteCodeDisplay').innerText = code;
    document.getElementById('inviteCodeGroupName').innerText = name;
    document.getElementById('inviteCodeHint').innerText = type === 'public' ? 'Публичная группа. Код для прямого приглашения:' : 'Закрытая группа — только по коду:';
    document.getElementById('inviteCodeModal').classList.add('open');
}
function closeInviteModal() { document.getElementById('inviteCodeModal').classList.remove('open'); }
function copyInviteCode() {
    const code = document.getElementById('inviteCodeDisplay').innerText.trim();
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).then(() => {
            const btn = document.getElementById('copyCodeBtn');
            btn.innerText = '✓ Скопировано';
            setTimeout(() => btn.innerText = 'Скопировать', 2000);
        }).catch(() => fallbackCopy(code));
    } else {
        fallbackCopy(code);
    }
}

function copyGroupInfoCode() {
    const code = document.getElementById('groupInfoCode')?.innerText?.trim();
    if (!code) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(code).catch(() => fallbackCopy(code));
    } else {
        fallbackCopy(code);
    }
}

function fallbackCopy(text) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;top:0;left:0;';
    document.body.appendChild(ta);
    ta.focus(); ta.select();
    try {
        document.execCommand('copy');
        const btn = document.getElementById('copyCodeBtn');
        btn.innerText = '✓ Скопировано';
        setTimeout(() => btn.innerText = 'Скопировать', 2000);
    } catch(e) {}
    document.body.removeChild(ta);
}

async function joinByCode() {
    const code = document.getElementById('joinCodeInput').value.trim().toUpperCase();
    if (!code) return;
    const token = localStorage.getItem('token');
    const res = await fetch('/api/groups/join', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ inviteCode: code }) });
    const data = await res.json();
    if (res.ok) {
        document.getElementById('joinCodeInput').value = '';
        socket.emit('join_group_room', data.group._id);
        loadGroups();
        switchGroupChat(data.group._id, data.group.name);
    } else alert(data.error);
}

document.getElementById('searchGroupInput').addEventListener('input', async (e) => {
    const q = e.target.value;
    if (q.length < 1) { document.getElementById('publicGroupResults').innerHTML = ''; return; }
    const token = localStorage.getItem('token');
    const groups = await (await fetch(`/api/groups/public?q=${encodeURIComponent(q)}`, { headers: { 'Authorization': `Bearer ${token}` } })).json();
    const container = document.getElementById('publicGroupResults');
    container.innerHTML = '';
    if (groups.length === 0) { container.innerHTML = '<div class="empty-hint">Ничего не найдено</div>'; return; }
    groups.forEach(group => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `<span class="user-avatar">${escapeHtml(group.avatar || '👥')}</span>
            <div style="flex:1;"><div class="user-name">${escapeHtml(group.name)}</div><div style="font-size:11px;color:var(--text-secondary);">${group.members.length} участн.</div></div>
            <button class="friend-request-btn" data-id="${group._id}" data-name="${escapeHtml(group.name)}">Вступить</button>`;
        container.appendChild(div);
    });
    document.querySelectorAll('#publicGroupResults .friend-request-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const res = await fetch(`/api/groups/${btn.dataset.id}/join`, { method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
            const data = await res.json();
            if (res.ok) { btn.innerText = '✓'; btn.disabled = true; socket.emit('join_group_room', btn.dataset.id); loadGroups(); switchGroupChat(btn.dataset.id, btn.dataset.name); }
            else alert(data.error);
        });
    });
});

async function showGroupInfo() {
    if (!currentGroupId) return;
    const token = localStorage.getItem('token');
    const groups = await (await fetch('/api/groups', { headers: { 'Authorization': `Bearer ${token}` } })).json();
    const group = groups.find(g => String(g._id) === String(currentGroupId));
    if (!group) return;
    document.getElementById('groupInfoAvatar').innerText = group.avatar || '👥';
    document.getElementById('groupInfoName').innerText = group.name;
    document.getElementById('groupInfoType').innerText = group.type === 'public' ? '🌍 Публичная' : '🔒 Закрытая';
    document.getElementById('groupInfoCode').innerText = group.inviteCode;
    document.getElementById('groupInfoMembers').innerHTML = group.members.map(m => `<span class="member-tag">${m === group.owner ? '👑 ' : ''}${escapeHtml(m)}</span>`).join('');
    const isOwner = group.owner === currentUser.username;
    document.getElementById('deleteGroupBtn').style.display = isOwner ? 'block' : 'none';
    document.getElementById('leaveGroupBtn').style.display = !isOwner ? 'block' : 'none';
    document.getElementById('groupInfoModal').classList.add('open');
}
function closeGroupInfoModal() { document.getElementById('groupInfoModal').classList.remove('open'); }
async function deleteGroup() {
    if (!confirm('Удалить группу для всех?')) return;
    await fetch(`/api/groups/${currentGroupId}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
    closeGroupInfoModal(); currentGroupId = null; document.querySelector('.chat-title').innerText = 'Выберите чат'; document.getElementById('messages').innerHTML = ''; loadGroups();
}
async function leaveGroup() {
    if (!confirm('Выйти из группы?')) return;
    const res = await fetch(`/api/groups/${currentGroupId}/leave`, { method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
    const data = await res.json();
    if (res.ok) { closeGroupInfoModal(); currentGroupId = null; document.querySelector('.chat-title').innerText = 'Выберите чат'; document.getElementById('messages').innerHTML = ''; loadGroups(); }
    else alert(data.error);
}

// ========== Профиль ==========
async function loadProfile() {
    const token = localStorage.getItem('token');
    const data = await (await fetch('/api/me', { headers: { 'Authorization': `Bearer ${token}` } })).json();
    document.getElementById('avatarPreview').innerText = data.avatar || '😀';
    document.getElementById('colorInput').value = data.color || '#6ab0f3';
}

async function updateProfile(avatar, color) {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/me/update', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }, body: JSON.stringify({ avatar, color }) });
    if (res.ok) { currentUser.avatar = avatar; currentUser.color = color; alert('Профиль обновлён'); }
    else alert('Ошибка обновления');
}

// ========== Emoji ==========
const emojiCategories = [
    { icon: '😀', emojis: ['😀','😃','😄','😁','😆','😅','😂','🤣','😊','😇','🙂','😉','😌','😍','🥰','😘','😋','😛','😜','🤪','😎','🥳','😏','😒','😔','😟','😣','😖','😫','😩','🥺','😢','😭','😤','😠','😡','🤬','🤯','😳','🥵','🥶','😱','😨','😰','🤗','🤔','🤫','🤥','😶','😐','😑','😬','🙄','😯','😲','🥱','😴','🤤','😵','🤢','🤮','🤧','😷','🤒','🤕','🤑','🤠','😈','👿','👹','👺','🤡','💩','👻','💀','👽','🤖'] },
    { icon: '👍', emojis: ['👍','👎','👌','✌️','🤞','🤟','🤘','🤙','👈','👉','👆','👇','☝️','✋','🤚','🖐️','🖖','👋','🤏','✍️','💅','💪','🙌','👏','🤝','🙏'] },
    { icon: '🐶', emojis: ['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼','🐨','🐯','🦁','🐮','🐷','🐸','🐵','🙈','🙉','🙊','🐔','🐧','🐦','🐤','🦆','🦅','🦉','🦇','🐺','🐗','🐴','🦄','🐝','🐛','🦋','🐌','🐞','🐜','🐢','🐍','🦎','🐙','🦑','🦐','🦞','🦀','🐟','🐬','🐳','🦈'] },
    { icon: '🍎', emojis: ['🍎','🍐','🍊','🍋','🍌','🍉','🍇','🍓','🍒','🍑','🥭','🍍','🥥','🥝','🍅','🍆','🥑','🥦','🥬','🥒','🌶️','🌽','🥕','🧄','🥔','🍔','🍟','🍕','🌭','🥪','🌮','🌯','🍜','🍝','🍣','🍱','🍛','🍲','🍰','🎂','🧁','🍩','🍪','☕','🍵','🧃','🥤','🧋','🍺','🍷'] },
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
        btn.addEventListener('click', () => { document.querySelectorAll('#emojiCategories .emoji-cat-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); renderEmojiGrid(cat.emojis); });
        catsContainer.appendChild(btn);
    });
    renderEmojiGrid(emojiCategories[0].emojis);
    function renderEmojiGrid(emojis) {
        grid.innerHTML = '';
        emojis.forEach(emoji => { const span = document.createElement('span'); span.innerText = emoji; span.addEventListener('click', () => { input.value += emoji; input.focus(); }); grid.appendChild(span); });
    }
    toggleBtn.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('open'); });
    document.addEventListener('click', (e) => { if (!panel.contains(e.target) && e.target !== toggleBtn) panel.classList.remove('open'); });
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
        btn.addEventListener('click', () => { document.querySelectorAll('#avatarEmojiCategories .emoji-cat-btn').forEach(b => b.classList.remove('active')); btn.classList.add('active'); renderGrid(cat.emojis); });
        catsContainer.appendChild(btn);
    });
    function renderGrid(emojis) { grid.innerHTML = ''; emojis.forEach(e => { const span = document.createElement('span'); span.innerText = e; span.addEventListener('click', () => { avatarPreview.innerText = e; panel.classList.remove('open'); }); grid.appendChild(span); }); }
    renderGrid(emojiCategories[0].emojis);
    pickerBtn.addEventListener('click', (e) => { e.stopPropagation(); panel.classList.toggle('open'); });
    document.addEventListener('click', (e) => { if (!panel.contains(e.target) && e.target !== pickerBtn) panel.classList.remove('open'); });

    const colorInput = document.getElementById('colorInput');
    const colorPreview = document.getElementById('colorPreview');
    const colorHex = document.getElementById('colorHex');
    function updateColor(hex) { colorPreview.style.background = hex; colorHex.innerText = hex; colorInput.value = hex; document.querySelectorAll('.color-preset').forEach(p => p.classList.toggle('active', p.dataset.color === hex)); }
    updateColor(colorInput.value || '#6ab0f3');
    colorPreview.addEventListener('click', () => colorInput.click());
    colorHex.addEventListener('click', () => colorInput.click());
    colorInput.addEventListener('input', () => updateColor(colorInput.value));
    document.querySelectorAll('.color-preset').forEach(p => p.addEventListener('click', () => updateColor(p.dataset.color)));
}

// ========== Утилиты ==========
function escapeHtml(str) {
    if (!str) return '';
    return String(str).replace(/[&<>"]/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));
}
function notify() { document.title = '✉️ Новое'; setTimeout(() => document.title = 'Мессенджер', 2000); }
function showNotification(text) {
    if (Notification.permission === 'granted') new Notification(text);
    else if (Notification.permission !== 'denied') Notification.requestPermission();
}

// ========== Typing ==========
let typingTimer;
document.getElementById('messageInput').addEventListener('input', () => {
    if (typingTimer) clearTimeout(typingTimer);
    if (!socket) return;
    if (currentGroupId) socket.emit('typing', { groupId: currentGroupId });
    else if (currentChat) socket.emit('typing', { to: currentChat });
    typingTimer = setTimeout(() => {}, 1500);
});

// ========== Вкладки ==========
document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        const tabId = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(`${tabId}-tab`).classList.add('active');
        if (tabId === 'friends') loadFriends();
        if (tabId === 'requests') loadFriendRequests();
        if (tabId === 'groups') loadGroups();
        if (tabId === 'settings') initThemePanel();
    });
});

document.getElementById('menuToggleBtn').addEventListener('click', () => sidebar.classList.toggle('open'));
document.getElementById('saveProfileBtn').addEventListener('click', () => updateProfile(document.getElementById('avatarPreview').innerText, document.getElementById('colorInput').value));

// ========== Загрузка файла ==========
document.getElementById('imageUploadInput').addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) { sendImage(file); e.target.value = ''; }
});

// ========== Старт ==========
// ========== ТЕМЫ ==========
const themes = [
    { id: 'dark',  name: 'Тёмная',   sidebar: 'rgba(13,14,26,0.9)', main: '#0a0f1e',  own: 'rgba(99,160,255,0.3)',  other: 'rgba(255,255,255,0.1)' },
    { id: 'light', name: 'Светлая',  sidebar: 'rgba(255,255,255,0.8)', main: '#f0f4fb', own: 'rgba(99,140,255,0.25)', other: 'rgba(255,255,255,0.8)' },
    { id: 'gray',  name: 'Серая',    sidebar: 'rgba(21,22,24,0.9)', main: '#151618',  own: 'rgba(80,100,160,0.35)', other: 'rgba(255,255,255,0.08)' },
    { id: 'green', name: 'Зелёная',  sidebar: 'rgba(6,13,15,0.9)',  main: '#091412',  own: 'rgba(0,168,100,0.35)', other: 'rgba(255,255,255,0.08)' },
];

function applyTheme(themeId) {
    document.documentElement.setAttribute('data-theme', themeId);
    localStorage.setItem('theme', themeId);
    document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === themeId);
    });
}

function initThemePanel() {
    const grid = document.getElementById('themeGrid');
    if (!grid || grid.children.length > 0) return; // guard против дублирования
    const currentTheme = localStorage.getItem('theme') || 'dark';
    themes.forEach(t => {
        const card = document.createElement('div');
        card.className = 'theme-card' + (t.id === currentTheme ? ' active' : '');
        card.dataset.theme = t.id;
        card.onclick = () => applyTheme(t.id);
        card.innerHTML = `
            <div class="theme-preview">
                <div class="theme-preview-sidebar" style="background:${t.sidebar}"></div>
                <div class="theme-preview-main" style="background:${t.main}">
                    <div class="theme-preview-msg other" style="background:${t.other}"></div>
                    <div class="theme-preview-msg own" style="background:${t.own}"></div>
                </div>
            </div>
            <div class="theme-name">${t.name}</div>
        `;
        grid.appendChild(card);
    });
}

window.onload = () => {
    // Применяем сохранённую тему
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
        currentUser = JSON.parse(savedUser);
        authDiv.style.display = 'none'; chatDiv.style.display = 'flex';
        initSocket(token); loadFriends(); loadFriendRequests(); loadGroups(); loadProfile(); loadUnread();
        document.getElementById('userInfo').innerHTML = `👤 ${currentUser.username}`;
        document.querySelector('.chat-title').innerText = 'Выберите чат';
        document.getElementById('messageInput').placeholder = 'Выберите чат...';
        initAvatarPicker();
        initThemePanel();
    }
    if (Notification.permission !== 'granted') Notification.requestPermission();
    initEmojiPicker();
    if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', () => {
            const main = document.querySelector('.main');
            if (main && window.innerWidth <= 768) { main.style.height = window.visualViewport.height + 'px'; document.getElementById('messages').scrollTop = document.getElementById('messages').scrollHeight; }
        });
    }
};

document.getElementById('sendBtn').onclick = sendMessage;
document.getElementById('messageInput').onkeypress = (e) => { if (e.key === 'Enter') sendMessage(); };
document.getElementById('logoutBtn').onclick = logout;

// ========== WebRTC Звонки ==========
let peerConnection = null;
let localStream = null;
let callWith = null;
let isMuted = false;

const iceServers = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };

function showCallOverlay(username, avatar, status, showAccept) {
    document.getElementById('callAvatar').innerText = avatar || '😀';
    document.getElementById('callUsername').innerText = username;
    document.getElementById('callStatus').innerText = status;
    document.getElementById('callAcceptBtn').style.display = showAccept ? 'flex' : 'none';
    document.getElementById('callMuteBtn').style.display = 'none';
    document.getElementById('callOverlay').style.display = 'flex';
}

function hideCallOverlay() {
    document.getElementById('callOverlay').style.display = 'none';
}

async function startCall(username) {
    callWith = username;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection(iceServers);
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    peerConnection.ontrack = (e) => {
        document.getElementById('remoteAudio').srcObject = e.streams[0];
        document.getElementById('callStatus').innerText = 'Звонок';
    };
    peerConnection.onicecandidate = (e) => {
        if (e.candidate) socket.emit('call_ice', { to: callWith, candidate: e.candidate });
    };
    peerConnection.onconnectionstatechange = () => {
        if (peerConnection?.connectionState === 'connected') {
            document.getElementById('callStatus').innerText = 'Звонок';
            document.getElementById('callMuteBtn').style.display = 'flex';
        }
    };
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call_user', { to: username, offer });
    showCallOverlay(username, '📞', 'Вызов...', false);
}

async function acceptCall() {
    document.getElementById('callAcceptBtn').style.display = 'none';
    document.getElementById('callMuteBtn').style.display = 'flex';
    document.getElementById('callStatus').innerText = 'Соединение...';
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    peerConnection.ontrack = (e) => { document.getElementById('remoteAudio').srcObject = e.streams[0]; };
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    socket.emit('call_answer', { to: callWith, answer });
}

function endCall() {
    if (callWith) socket.emit('call_end', { to: callWith });
    cleanupCall();
}

function cleanupCall() {
    peerConnection?.close();
    peerConnection = null;
    localStream?.getTracks().forEach(t => t.stop());
    localStream = null;
    callWith = null;
    isMuted = false;
    document.getElementById('remoteAudio').srcObject = null;
    hideCallOverlay();
}

function toggleMute() {
    if (!localStream) return;
    isMuted = !isMuted;
    localStream.getAudioTracks().forEach(t => t.enabled = !isMuted);
    document.getElementById('callMuteBtn').innerText = isMuted ? '🔇' : '🎤';
}
