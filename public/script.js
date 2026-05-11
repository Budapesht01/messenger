let socket;

function closeModal(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove('open');
}

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

// === Навигация по формам ===
function showLoginForm() {
    document.getElementById('loginForm').style.display = '';
    document.getElementById('regStep1').style.display = 'none';
    document.getElementById('regStep2').style.display = 'none';
    document.getElementById('forgotStep1').style.display = 'none';
    document.getElementById('forgotStep2').style.display = 'none';
    document.getElementById('authTitle').innerText = 'Добро пожаловать';
    showError('');
}
function showRegStep1() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('regStep1').style.display = '';
    document.getElementById('regStep2').style.display = 'none';
    document.getElementById('authTitle').innerText = 'Регистрация';
    showError('');
}
function showForgotStep1() {
    document.getElementById('loginForm').style.display = 'none';
    document.getElementById('forgotStep1').style.display = '';
    document.getElementById('forgotStep2').style.display = 'none';
    document.getElementById('authTitle').innerText = 'Сброс пароля';
    showError('');
}

// === Регистрация ===
async function sendRegCode() {
    const email = document.getElementById('regEmail').value.trim();
    if (!email) return showError('Введите email');
    const res = await fetch('/api/register/send-code', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const data = await res.json();
    if (res.ok) {
        document.getElementById('regStep1').style.display = 'none';
        document.getElementById('regStep2').style.display = '';
        showError('');
    } else showError(data.error);
}
async function verifyAndRegister() {
    const email = document.getElementById('regEmail').value.trim();
    const code = document.getElementById('regCode').value.trim();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value;
    if (!code) return showError('Введите код');
    if (!username || username.length < 3) return showError('Ник минимум 3 символа');
    if (!password || password.length < 8) return showError('Пароль минимум 8 символов');
    const res = await fetch('/api/register/verify', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, username, password }) });
    const data = await res.json();
    if (res.ok) loginSuccess(data.token, data.user);
    else showError(data.error === 'Username taken' ? 'Ник занят' : data.error === 'Invalid code' ? 'Неверный код' : data.error === 'Code expired' ? 'Код истёк, запросите новый' : data.error);
}

// === Вход ===
async function login() {
    showError('');
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    if (!email) return showError('Введите email');
    if (!password || password.length < 8) return showError('Пароль минимум 8 символов');
    const res = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const data = await res.json();
    if (res.ok) loginSuccess(data.token, data.user);
    else showError('Неверный email или пароль');
}

// === Сброс пароля ===
async function sendResetCode() {
    const email = document.getElementById('forgotEmail').value.trim();
    if (!email) return showError('Введите email');
    const res = await fetch('/api/password/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
    const data = await res.json();
    if (res.ok) {
        document.getElementById('forgotStep1').style.display = 'none';
        document.getElementById('forgotStep2').style.display = '';
        showError('');
    } else showError(data.error === 'Email not found' ? 'Email не найден' : data.error);
}

async function resetPassword() {
    const email = document.getElementById('forgotEmail').value.trim();
    const code = document.getElementById('resetCode').value.trim();
    const newPassword = document.getElementById('resetNewPassword').value;
    if (!code) return showError('Введите код');
    if (!newPassword || newPassword.length < 8) return showError('Пароль минимум 8 символов');
    const res = await fetch('/api/password/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, code, newPassword }) });
    const data = await res.json();
    if (res.ok) { showLoginForm(); showError('Пароль изменён, войдите заново'); }
    else showError(data.error === 'Invalid code' ? 'Неверный код' : data.error === 'Code expired' ? 'Код истёк' : data.error);
}

// === Смена пароля из настроек ===
function showChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.add('open');
    document.getElementById('changePwdBody').style.display = '';
    document.getElementById('changePwdStep2').style.display = 'none';
    document.getElementById('changePwdCode').value = '';
    document.getElementById('changePwdNew').value = '';
}
function closeChangePasswordModal() {
    document.getElementById('changePasswordModal').classList.remove('open');
}
async function sendChangePwdCode() {
    const res = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
    const me = await res.json();
    const r = await fetch('/api/password/forgot', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: me.email }) });
    if (r.ok) {
        document.getElementById('changePwdBody').style.display = 'none';
        document.getElementById('changePwdStep2').style.display = '';
    }
}
async function confirmChangePassword() {
    const res = await fetch('/api/me', { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } });
    const me = await res.json();
    const code = document.getElementById('changePwdCode').value.trim();
    const newPassword = document.getElementById('changePwdNew').value;
    if (!code) return alert('Введите код');
    if (!newPassword || newPassword.length < 8) return alert('Пароль минимум 8 символов');
    const r = await fetch('/api/password/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: me.email, code, newPassword }) });
    if (r.ok) { closeChangePasswordModal(); alert('Пароль изменён!'); logout(); }
    else { const d = await r.json(); alert(d.error); }
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
        const isOwn = msg.from === currentUser?.username;
        const chatPartner = isOwn ? msg.to : msg.from;
        if (currentChat === chatPartner) {
            // Не добавлять дубликат если сообщение уже есть в DOM
            if (msg._id && document.querySelector(`.message[data-id="${msg._id}"]`)) return;
            addMessageToChat(msg);
            if (isOwn) updateFriendPreview(chatPartner, msg);
            if (!isOwn) markRead(msg.from);
        } else if (!isOwn) {
            unreadCounts[msg.from] = (unreadCounts[msg.from] || 0) + 1;
            updateUnreadBadge(msg.from);
            showNotification(`💬 ${msg.from}: ${msg.audioUrl ? 'Голосовое сообщение' : msg.text || '📷 Фото'}`);
        }
        notify();
        updateFriendPreview(chatPartner, msg);
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
        const reader = data.by;
        if (currentChat === reader || data.chatWith === currentUser?.username) {
            document.querySelectorAll('.message.own .read-status').forEach(el => {
                el.innerHTML = '✓✓'; el.classList.add('read');
            });
        }
        // Обновить галочку в превью списка друзей
        const item = document.querySelector(`.user-item[data-chat-key="dm_${reader}"]`);
        if (item) {
            const check = item.querySelector('.last-msg-time-wrap span:first-child');
            if (check) { check.innerHTML = '✓✓'; check.style.color = 'var(--accent)'; }
        }
    });

    socket.on('private_message_sent', (data) => {
        // Сервер подтвердил — сообщение доставлено, галочка одна
        const el = document.querySelector(`.message[data-id="${data._id}"] .read-status`);
        if (el) { el.innerHTML = '✓'; }
        updateFriendPreview(data.to || currentChat, data);
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
        await flushIceCandidates();
    });

    socket.on('call_ice', async (data) => {
        if (!peerConnection || !peerConnection.remoteDescription) {
            iceCandidateQueue.push(data.candidate);
        } else {
            try { await peerConnection.addIceCandidate(new RTCIceCandidate(data.candidate)); } catch(e) {}
        }
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
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (currentChat || currentGroupId)) {
        currentChat = null;
        currentGroupId = null;
        document.getElementById('noChatSelected').style.display = 'flex';
        document.getElementById('inputArea').style.display = 'none';
        document.querySelector('.chat-title').innerText = 'Выберите чат';
        document.getElementById('chatMenuWrap').style.display = 'none';
        document.getElementById('groupMenuWrap').style.display = 'none';
        document.getElementById('messages').innerHTML = '';
        document.getElementById('noChatSelected').style.display = 'flex';
        document.getElementById('inputArea').style.display = 'none';
        if (window.innerWidth <= 425) {
            sidebar.classList.add('open');
        }
    }
});

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && currentChat) markRead(currentChat);
});
window.addEventListener('focus', () => {
    if (currentChat) markRead(currentChat);
});
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

async function apiFetch(url, options = {}) {
    const token = localStorage.getItem('token');
    const res = await fetch(url, {
        ...options,
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (res.status === 401 || res.status === 403) {
        const data = await res.json().catch(() => ({}));
        if (data.error?.includes('revoked') || data.error?.includes('expired')) {
            logout();
            return null;
        }
    }
    return res;
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

    // Forwarded block
    let forwardedHtml = '';
    if (msg.forwardedFrom) {
        forwardedHtml = `<div class="forwarded-header">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><polyline points="15,10 20,15 15,20"/><path d="M4 4v7a4 4 0 004 4h12"/></svg>
            <span>Переслано от <b>${escapeHtml(msg.forwardedFrom)}</b></span>
        </div>`;
    }

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
    if (msg.audioUrl) {
        const aid = 'va_' + Math.random().toString(36).substr(2,8);
        imageHtml = `
        <div class="voice-player" id="${aid}">
            <button class="vp-play" onclick="vpToggle('${aid}')">
                <svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>
            </button>
            <div class="vp-body">
                <div class="vp-bar" onclick="vpSeek('${aid}',event)"><div class="vp-progress"></div></div>
                <span class="vp-time">${msg.audioDuration ? vpFmt(msg.audioDuration) : '0:00'}</span>
            </div>
            <audio src="${escapeHtml(msg.audioUrl)}" preload="auto" data-duration="${msg.audioDuration || 0}" onloadedmetadata="vpMeta('${aid}',this)" ontimeupdate="vpUpdate('${aid}',this)" onended="vpEnded('${aid}')"></audio>
        </div>`;
    } else if (msg.imageUrl) {
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
                ${forwardedHtml}
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
    bubble.addEventListener('click', (e) => {
        if (selectMode) { e.stopPropagation(); toggleSelectMode(msg._id); }
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
    items.push({ icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="9,14 4,9 9,4"/><path d="M20 20v-7a4 4 0 00-4-4H4"/></svg>`, label: 'Ответить', action: () => { closeMsgMenu(); setReply(msg._id, msg.from, msg.text); }});
    items.push({ icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>`, label: 'Реакция', action: () => { closeMsgMenu(); openReactionPicker(msg._id, msgDiv.querySelector('.message-bubble')); }});
    items.push({ icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><line x1="12" y1="17" x2="12" y2="22"/><path d="M5 17h14v-1.76a2 2 0 00-1.11-1.79l-1.78-.9A2 2 0 0115 10.76V6h1a2 2 0 000-4H8a2 2 0 000 4h1v4.76a2 2 0 01-1.11 1.79l-1.78.9A2 2 0 005 15.24V17z"/></svg>`, label: msg.pinned ? 'Открепить' : 'Закрепить', action: () => { closeMsgMenu(); togglePin(msg._id); }});
    items.push({ icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="15,10 20,15 15,20"/><path d="M4 4v7a4 4 0 004 4h12"/></svg>`, label: 'Переслать', action: () => { closeMsgMenu(); openForwardModal(msg._id); }});
    if (msg.text) items.push({ icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><rect x="9" y="2" width="6" height="4" rx="1"/><path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/></svg>`, label: 'Копировать текст', action: () => { closeMsgMenu(); navigator.clipboard.writeText(msg.text); }});
    items.push({ icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="20,6 9,17 4,12"/></svg>`, label: 'Выделить', action: () => { closeMsgMenu(); toggleSelectMode(msg._id); }});
    if (isOwn && msg.text) items.push({ icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>`, label: 'Редактировать', action: () => { closeMsgMenu(); openEditModal(msg); }});
    if (isOwn) items.push({ icon: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 011-1h4a1 1 0 011 1v2"/></svg>`, label: 'Удалить', danger: true, action: () => { closeMsgMenu(); openDeleteModal(msg._id); }});
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

// Закрепление
async function togglePin(msgId) {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/messages/${msgId}/pin`, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) {
        const data = await res.json();
        const bubble = document.querySelector(`.message[data-id="${msgId}"] .message-bubble`);
        if (bubble) {
            bubble.classList.toggle('pinned-msg', data.pinned);
            let pin = bubble.querySelector('.pin-badge');
            if (data.pinned && !pin) {
                pin = document.createElement('span');
                pin.className = 'pin-badge';
                pin.innerText = '📌';
                bubble.appendChild(pin);
            } else if (!data.pinned && pin) pin.remove();
        }
    }
}

// Пересылка
let forwardMsgId = null;

function openForwardModal(msgId) {
    forwardMsgId = msgId;
    let panel = document.getElementById('forwardPanel');
    if (!panel) {
        panel = document.createElement('div');
        panel.id = 'forwardPanel';
        panel.className = 'forward-panel';
        panel.innerHTML = `
            <div class="forward-panel-header">
                <button class="forward-panel-close" onclick="closeForwardPanel()">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                </button>
                <span>Переслать кому</span>
            </div>
            <div id="forwardFriendList" class="forward-panel-list"></div>`;
        document.querySelector('.main').appendChild(panel);
    } else {
        document.getElementById('forwardFriendList').innerHTML = '';
    }
    buildForwardList();
    panel.classList.add('open');
    document.getElementById('forwardOverlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'forwardOverlay';
    overlay.className = 'forward-overlay';
    overlay.onclick = closeForwardPanel;
    document.querySelector('.main').appendChild(overlay);
}

function closeForwardPanel() {
    document.getElementById('forwardPanel')?.classList.remove('open');
    document.getElementById('forwardOverlay')?.remove();
}

async function buildForwardList() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/friends', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const friends = await res.json();
    const list = document.getElementById('forwardFriendList');
    list.innerHTML = '';
    friends.forEach(f => {
        const btn = document.createElement('button');
        btn.className = 'forward-friend-btn';
        btn.innerHTML = `<span class="forward-friend-avatar">${f.avatar || '😀'}</span><span style="color:${f.color||'inherit'}">${escapeHtml(f.username)}</span>`;
        btn.onclick = async () => {
            const t = localStorage.getItem('token');
            const fwdRes = await fetch('/api/messages/forward', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + t }, body: JSON.stringify({ messageId: forwardMsgId, to: f.username }) });
if (fwdRes.ok) {
    const fwdMsg = await fwdRes.json();
    if (currentChat === f.username) addMessageToChat(fwdMsg);
}
closeForwardPanel();
        };
        list.appendChild(btn);
    });
}
let selectedMessages = new Set();
let selectMode = false;

function toggleSelectMode(msgId) {
    selectMode = true;
    const el = document.querySelector(`.message[data-id="${msgId}"]`);
    if (selectedMessages.has(msgId)) {
        selectedMessages.delete(msgId);
        if (el) el.classList.remove('selected-msg');
        if (selectedMessages.size === 0) { cancelSelect(); return; }
    } else {
        selectedMessages.add(msgId);
        if (el) el.classList.add('selected-msg');
    }
    showSelectBar();
}

function showSelectBar() {
    let bar = document.getElementById('selectBar');
    if (!bar) {
        bar = document.createElement('div');
        bar.id = 'selectBar';
        bar.className = 'select-bar';
bar.innerHTML = `<span id="selectCount">1 сообщ.</span><div style="display:flex;gap:8px"><button onclick="forwardSelected()">Переслать</button><button onclick="deleteSelected()" style="color:var(--danger,#f36a6a)">Удалить</button><button onclick="cancelSelect()">✕</button></div>`;        document.querySelector('.main').appendChild(bar);
    }
    document.getElementById('selectCount').innerText = `${selectedMessages.size} сообщ.`;
}

function cancelSelect() {
    selectMode = false;
    selectedMessages.clear();
    document.querySelectorAll('.selected-msg').forEach(el => el.classList.remove('selected-msg'));
    document.getElementById('selectBar')?.remove();
}

async function deleteSelected() {
    const token = localStorage.getItem('token');
    for (const id of selectedMessages) {
        await fetch(`/api/messages/${id}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
        document.querySelector(`.message[data-id="${id}"]`)?.remove();
    }
    cancelSelect();
}

function forwardSelected() {
    const ids = [...selectedMessages];
    cancelSelect();
    if (ids.length > 0) openForwardModal(ids[0]);
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
    document.getElementById('noChatSelected').style.display = 'none';
    document.getElementById('inputArea').style.display = 'flex';
    const ch1 = document.getElementById('chatHeader'); if (ch1) ch1.style.display = '';
    const cvp1 = document.getElementById('channelViewPanel'); if (cvp1) cvp1.style.display = 'none';
    document.querySelector('.chat-title').innerText = username;
    document.getElementById('groupInfoBtn').style.display = 'none';
    document.getElementById('chatMenuWrap').style.display = 'flex';
    document.getElementById('groupMenuWrap').style.display = 'none';
    document.getElementById('messageInput').placeholder = 'Сообщение...';
    restoreDraft('dm_' + username);
    fetchHistoryForUser(username); // галочки рендерятся из реального readBy внутри
    markRead(username);
    sidebar.classList.remove('open');
    setActiveChatItem('dm_' + username);
    if (window.innerWidth <= 768) document.getElementById('backBtn').style.display = 'flex';
}

async function switchGroupChat(groupId, groupName) {
    saveDraft();
    currentGroupId = groupId; currentChat = null;
    document.getElementById('noChatSelected').style.display = 'none';
    document.getElementById('inputArea').style.display = 'flex';
    const ch2 = document.getElementById('chatHeader'); if (ch2) ch2.style.display = '';
    const cvp2 = document.getElementById('channelViewPanel'); if (cvp2) cvp2.style.display = 'none';
    document.querySelector('.chat-title').innerText = groupName;
    document.getElementById('groupInfoBtn').style.display = 'none';
    document.getElementById('groupMenuWrap').style.display = 'flex';
    document.getElementById('chatMenuWrap').style.display = 'none';
    document.getElementById('messageInput').placeholder = 'Сообщение в группу...';
    restoreDraft('group_' + groupId);
    sidebar.classList.remove('open');
    setActiveChatItem('group_' + groupId);
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/groups/${groupId}/messages`, { headers: { 'Authorization': `Bearer ${token}` } });
    if (res.ok) renderMessages(await res.json());
    if (window.innerWidth <= 768) document.getElementById('backBtn').style.display = 'flex';
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
            const lm = friend.lastMessage;
            const txt = escapeHtml((lm.audioUrl ? 'Голосовое сообщение' : lm.imageUrl ? '📷 Фото' : lm.text || '').slice(0, 35));
            const t = new Date(friend.lastMessage.timestamp);
            const now = new Date();
            const isToday = t.toDateString() === now.toDateString();
            const timeStr = isToday
                ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : t.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
            const isRead = lm.fromMe && lm.readBy && lm.readBy.includes(friend.username);
            const checkHtml = lm.fromMe ? `<span style="font-size:10px;color:${isRead ? 'var(--accent)' : 'var(--text-secondary)'};margin-right:2px;">${isRead ? '✓✓' : '✓'}</span>` : '';
            lastMsgHtml = `<div class="friend-last-msg"><span class="last-msg-text">${prefix}${txt}</span><span class="last-msg-time-wrap">${checkHtml}<span class="last-msg-time">${timeStr}</span></span></div>`;
        }

        div.innerHTML = `
            <div class="friend-avatar-wrap">
                <span class="user-avatar">${escapeHtml(friend.avatar || '😀')}</span>
                ${friend.online ? '<span class="friend-online-dot"></span>' : ''}
            </div>
            <div class="friend-info">
                <div class="friend-name-row">
                    <span class="${friend.username === 'Budapesht' ? 'user-name creator-name' : 'user-name'}">${escapeHtml(friend.username)}${friend.username === 'Budapesht' ? '<span class="creator-crown">👑<span class="creator-tooltip">Creator</span></span>' : ''}</span>
                    ${count > 0 ? `<span class="unread-badge">${count > 99 ? '99+' : count}</span>` : ''}
                </div>
                ${lastMsgHtml}
            </div>
        `;
        container.appendChild(div);
    });
}

async function loadFriendRequests() {
    const token = localStorage.getItem('token');
    const requests = await (await fetch('/api/friend-requests', { headers: { 'Authorization': `Bearer ${token}` } })).json();
    const container = document.getElementById('requestsList');
    container.innerHTML = '';

    // Бейдж на вкладке
    const badge = document.getElementById('requestsBadge');
    if (requests.length > 0) {
        badge.innerText = requests.length;
        badge.style.display = 'inline';
    } else {
        badge.style.display = 'none';
    }

    if (requests.length === 0) { container.innerHTML = '<div class="empty-hint">Нет входящих запросов</div>'; return; }
    requests.forEach(from => {
        const div = document.createElement('div');
        div.className = 'user-item';
        div.innerHTML = `<span class="user-name">${escapeHtml(from)}</span>
            <div style="display:flex; gap:6px; margin-left:auto;">
                <button class="accept-btn" data-from="${from}" title="Принять" style="width:32px; height:32px; border-radius:50%; border:none; background:rgba(34,197,94,0.15); color:#22c55e; font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center;">✓</button>
                <button class="reject-btn" data-from="${from}" title="Отклонить" style="width:32px; height:32px; border-radius:50%; border:none; background:rgba(239,68,68,0.12); color:#ef4444; font-size:16px; cursor:pointer; display:flex; align-items:center; justify-content:center;">✕</button>
            </div>`;
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
    const q = e.target.value.trim();
    const results = document.getElementById('searchResults');
    if (!q) { results.innerHTML = ''; return; }
    const token = localStorage.getItem('token');
    const filter = document.querySelector('.search-filter-btn.active')?.dataset.filter || 'all';
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const data = await res.json();
    results.innerHTML = '';

    const showUsers = filter === 'all' || filter === 'users';
    const showGroups = filter === 'all' || filter === 'groups';
    const showChannels = filter === 'all' || filter === 'channels';

    if (showUsers && data.users.length > 0) {
        results.innerHTML += `<div class="search-section-title">Люди</div>`;
        data.users.forEach(u => {
            const div = document.createElement('div');
            div.className = 'user-item search-result-item';
            div.innerHTML = `<span style="font-size:22px;">${u.avatar||'😀'}</span><div class="user-item-info"><span class="user-item-name" style="color:${u.color}">${escapeHtml(u.username)}</span><span class="user-item-status">${u.online ? 'онлайн' : 'оффлайн'}</span></div>`;
            div.onclick = () => sendFriendRequest(u.username);
            results.appendChild(div);
        });
    }
    if (showGroups && data.groups.length > 0) {
        const h = document.createElement('div'); h.className = 'search-section-title'; h.textContent = 'Группы'; results.appendChild(h);
        data.groups.forEach(g => {
            const div = document.createElement('div');
            div.className = 'user-item search-result-item';
            div.innerHTML = `<span style="font-size:22px;">${g.avatar||'👥'}</span><div class="user-item-info"><span class="user-item-name">${escapeHtml(g.name)}</span><span class="user-item-status">${g.members?.length||0} участников</span></div>`;
            results.appendChild(div);
        });
    }
    if (showChannels && data.channels.length > 0) {
        const h = document.createElement('div'); h.className = 'search-section-title'; h.textContent = 'Каналы'; results.appendChild(h);
        data.channels.forEach(ch => {
            const div = document.createElement('div');
            div.className = 'user-item search-result-item';
            div.innerHTML = `<span style="font-size:22px;">${ch.avatar||'📢'}</span><div class="user-item-info"><span class="user-item-name">${escapeHtml(ch.name)}</span><span class="user-item-status">${ch.subscribers?.length||0} подписчиков</span></div>`;
            div.onclick = () => { document.querySelector('[data-tab="channels"]').click(); setTimeout(() => openChannel(ch), 100); };
            results.appendChild(div);
        });
    }
    if (results.innerHTML === '') results.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:13px;">Ничего не найдено</div>';
});

document.addEventListener('DOMContentLoaded', () => {
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

document.getElementById('searchGroupInput')?.addEventListener('input', async (e) => {
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
    if (res.ok) {
        currentUser.avatar = avatar;
        currentUser.color = color;
        // Обновить цвет ника у всех своих сообщений в DOM
        document.querySelectorAll('.message.own .msg-sender').forEach(el => {
            el.style.color = color;
        });
        showToast('Профиль обновлён');
    } else {
        showToast('Ошибка обновления', true);
    }
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
// ===== TOAST =====
function showToast(text, isError = false) {
    const existing = document.getElementById('toastMsg');
    if (existing) existing.remove();
    const t = document.createElement('div');
    t.id = 'toastMsg';
    t.innerText = text;
    t.style.cssText = `position:fixed; bottom:28px; left:50%; transform:translateX(-50%);
        background:${isError ? '#ef4444' : 'var(--accent)'}; color:#fff;
        padding:10px 22px; border-radius:20px; font-size:13px; font-weight:500;
        z-index:99999; box-shadow:0 4px 20px rgba(0,0,0,0.3);
        animation:fadeInUp 0.2s ease;`;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 2500);
}
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

const themeColors = { dark: '#0a0f1e', light: '#f0f4fb', gray: '#151618', green: '#091412' };

function applyTheme(themeId) {
    document.documentElement.setAttribute('data-theme', themeId);
    localStorage.setItem('theme', themeId);
    const meta = document.getElementById('themeColorMeta');
    if (meta) meta.setAttribute('content', themeColors[themeId] || '#0a0f1e');
    document.querySelectorAll('.theme-card').forEach(card => {
        card.classList.toggle('active', card.dataset.theme === themeId);
    });
}

function initThemePanel() {
    if (window.innerWidth <= 768) sidebar.classList.add('open');
    const grid = document.getElementById('themeGrid');
    if (!grid) return;
    grid.innerHTML = ''; // guard против дублирования
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
    // Убираем splash screen
const splash = document.getElementById('splashScreen');
if (splash) {
    // Запускаем анимацию входа
    requestAnimationFrame(() => {
        document.getElementById('splashLogo').style.opacity = '1';
        document.getElementById('splashLogo').style.transform = 'scale(1) translateY(0)';
        document.getElementById('splashTitle').style.opacity = '1';
        document.getElementById('splashTitle').style.transform = 'translateY(0)';
        document.getElementById('splashSub').style.opacity = '1';
        document.getElementById('splashSub').style.transform = 'translateY(0)';
        document.getElementById('splashDots').style.opacity = '1';
    });
    // Убираем через 1.8 сек
    setTimeout(() => {
        splash.style.opacity = '0';
        setTimeout(() => splash.remove(), 500);
    }, 1800);
}
    // Применяем сохранённую тему
    const savedTheme = localStorage.getItem('theme') || 'dark';
    document.documentElement.setAttribute('data-theme', savedTheme);

    const token = localStorage.getItem('token');
    const savedUser = localStorage.getItem('user');
    if (token && savedUser) {
        currentUser = JSON.parse(savedUser);
        authDiv.style.display = 'none'; chatDiv.style.display = 'flex';
        initSocket(token); loadFriends(); loadFriendRequests(); loadGroups(); loadProfile(); loadUnread();
        const isAdmin = currentUser.username === 'Budapesht';
const userInfoEl = document.getElementById('userInfo');
if (userInfoEl) userInfoEl.innerHTML = `👤 ${currentUser.username}`;
if (isAdmin) {
    document.getElementById('burgerUsername').textContent = currentUser.username + ' ⚙️';
}        document.querySelector('.chat-title').innerText = 'Выберите чат';
        document.getElementById('messageInput').placeholder = 'Выберите чат...';
        initAvatarPicker();
        initThemePanel();
        if (window.innerWidth <= 768) sidebar.classList.add('open');
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
let iceCandidateQueue = [];

const iceServers = { iceServers: [
    { urls: 'stun:stun.relay.metered.ca:80' },
    {
        urls: 'turn:global.relay.metered.ca:80',
        username: 'f1e5775431e6d374bfd767cd',
        credential: 'СЮДА_СВОЙ_CREDENTIAL'
    },
    {
        urls: 'turn:global.relay.metered.ca:80?transport=tcp',
        username: 'f1e5775431e6d374bfd767cd',
        credential: 'foYdt5C8+xkLxK8N'
    },
    {
        urls: 'turn:global.relay.metered.ca:443',
        username: 'f1e5775431e6d374bfd767cd',
        credential: 'foYdt5C8+xkLxK8N'
    },
    {
        urls: 'turns:global.relay.metered.ca:443?transport=tcp',
        username: 'f1e5775431e6d374bfd767cd',
        credential: 'foYdt5C8+xkLxK8N'
    }
]};

async function flushIceCandidates() {
    while (iceCandidateQueue.length) {
        const c = iceCandidateQueue.shift();
        try { await peerConnection.addIceCandidate(new RTCIceCandidate(c)); } catch(e) {}
    }
}

let callTimerInterval = null;
let callSeconds = 0;

function startCallTimer() {
    callSeconds = 0;
    document.getElementById('callTimer').style.display = 'block';
    callTimerInterval = setInterval(() => {
        callSeconds++;
        const m = Math.floor(callSeconds / 60);
        const s = String(callSeconds % 60).padStart(2, '0');
        document.getElementById('callTimer').innerText = `${m}:${s}`;
    }, 1000);
}

function stopCallTimer() {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
    document.getElementById('callTimer').style.display = 'none';
    document.getElementById('callTimer').innerText = '0:00';
}

function showCallOverlay(username, avatar, status, showAccept) {
    document.getElementById('callAvatar').innerText = avatar || '😀';
    document.getElementById('callUsername').innerText = username;
    document.getElementById('callStatus').innerText = status;
    document.getElementById('callAcceptBtn').style.display = showAccept ? 'flex' : 'none';
    document.getElementById('callMuteBtn').style.display = 'none';
    document.getElementById('callTimer').style.display = 'none';
    document.getElementById('callOverlay').style.display = 'flex';
}

function hideCallOverlay() {
    document.getElementById('callOverlay').style.display = 'none';
}

async function startCall(username) {
    iceCandidateQueue = [];
    callWith = username;
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    peerConnection = new RTCPeerConnection(iceServers);
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    peerConnection.ontrack = (e) => {
        document.getElementById('remoteAudio').srcObject = e.streams[0];
    };
    peerConnection.onicecandidate = (e) => {
        if (e.candidate) socket.emit('call_ice', { to: callWith, candidate: e.candidate });
    };
    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection?.connectionState;
        if (state === 'connected') {
            document.getElementById('callStatus').innerText = '';
            document.getElementById('callMuteBtn').style.display = 'flex';
            startCallTimer();
        }
        if (state === 'failed' || state === 'disconnected') {
            document.getElementById('callStatus').innerText = 'Соединение прервано';
            setTimeout(cleanupCall, 2000);
        }
    };
    const offer = await peerConnection.createOffer();
    await peerConnection.setLocalDescription(offer);
    socket.emit('call_user', { to: username, offer });
    showCallOverlay(username, '📞', 'Вызов...', false);
}

async function acceptCall() {
    document.getElementById('callAcceptBtn').style.display = 'none';
    document.getElementById('callAcceptLabel').style.display = 'none';
    document.getElementById('callMuteLabel').style.display = 'none';
    document.getElementById('callStatus').innerText = 'Соединение...';
    localStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    localStream.getTracks().forEach(t => peerConnection.addTrack(t, localStream));
    peerConnection.ontrack = (e) => {
        document.getElementById('remoteAudio').srcObject = e.streams[0];
    };
    peerConnection.onconnectionstatechange = () => {
        const state = peerConnection?.connectionState;
        if (state === 'connected') {
            document.getElementById('callStatus').innerText = 'Звонок';
            document.getElementById('callMuteBtn').style.display = 'flex';
        }
        if (state === 'failed' || state === 'disconnected') {
            document.getElementById('callStatus').innerText = 'Соединение прервано';
            setTimeout(cleanupCall, 2000);
        }
    };
    const answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);
    await flushIceCandidates();
    socket.emit('call_answer', { to: callWith, answer });
}

function endCall() {
    if (callWith) socket.emit('call_end', { to: callWith });
    cleanupCall();
}

function cleanupCall() {
    stopCallTimer();
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
    document.getElementById('callMuteBtn').classList.toggle('muted', isMuted);
    document.getElementById('callMuteLabel').innerText = isMuted ? 'Без звука' : 'Микрофон';
}

// ========== АДМИН ПАНЕЛЬ ==========
async function openAdminPanel() {
    const token = localStorage.getItem('token');
    const panel = document.getElementById('adminPanel');
    panel.style.display = 'flex';

    // Статистика
    const stats = await (await fetch('/api/admin/stats', { headers: { 'Authorization': `Bearer ${token}` } })).json();
    document.getElementById('adminStats').innerHTML = [
        { label: 'Пользователей', value: stats.usersCount, icon: '👤' },
        { label: 'Групп', value: stats.groupsCount, icon: '👥' },
        { label: 'Сообщений', value: stats.messagesCount, icon: '💬' }
    ].map(s => `
        <div style="background:rgba(255,255,255,0.04); border-radius:10px; padding:12px; text-align:center; border:1px solid rgba(255,255,255,0.06);">
            <div style="font-size:24px;">${s.icon}</div>
            <div style="font-size:20px; font-weight:700; color:var(--text-primary);">${s.value}</div>
            <div style="font-size:11px; color:var(--text-secondary);">${s.label}</div>
        </div>
    `).join('');

    // Пользователи
    const users = await (await fetch('/api/admin/users', { headers: { 'Authorization': `Bearer ${token}` } })).json();
    document.getElementById('adminUsersList').innerHTML = users.map(u => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:8px; background:rgba(255,255,255,0.03); margin-bottom:4px;">
            <span style="font-size:20px;">${u.avatar || '😀'}</span>
            <span style="flex:1; font-size:13px; color:var(--text-primary);">${escapeHtml(u.username)}</span>
            <span style="font-size:11px; color:${u.online ? '#22c55e' : 'var(--text-secondary)'};">${u.online ? '● online' : 'ofline'}</span>
            ${u.username !== 'Budapesht' ? `<button onclick="adminDeleteUser('${escapeHtml(u.username)}')" style="background:rgba(239,68,68,0.1); border:none; color:#ef4444; border-radius:6px; padding:3px 8px; cursor:pointer; font-size:12px;">🗑</button>` : '<span style="font-size:11px; color:gold;">👑</span>'}
        </div>
    `).join('');

    // Группы
    const groups = await (await fetch('/api/admin/groups', { headers: { 'Authorization': `Bearer ${token}` } })).json();
    document.getElementById('adminGroupsList').innerHTML = groups.length === 0 ? '<div style="color:var(--text-secondary); font-size:13px;">Нет групп</div>' : groups.map(g => `
        <div style="display:flex; align-items:center; gap:10px; padding:8px 10px; border-radius:8px; background:rgba(255,255,255,0.03); margin-bottom:4px;">
            <span style="font-size:20px;">${g.avatar || '👥'}</span>
            <span style="flex:1; font-size:13px; color:var(--text-primary);">${escapeHtml(g.name)}</span>
            <span style="font-size:11px; color:var(--text-secondary);">${g.members?.length || 0} уч.</span>
            <button onclick="adminDeleteGroup('${g._id}')" style="background:rgba(239,68,68,0.1); border:none; color:#ef4444; border-radius:6px; padding:3px 8px; cursor:pointer; font-size:12px;">🗑</button>
        </div>
    `).join('');
}

async function adminDeleteUser(username) {
    if (!confirm(`Удалить пользователя ${username}? Это действие необратимо.`)) return;
    const res = await fetch(`/api/admin/users/${username}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
    if (res.ok) openAdminPanel();
    else alert('Ошибка удаления');
}

async function adminDeleteGroup(id) {
    if (!confirm('Удалить группу?')) return;
    const res = await fetch(`/api/admin/groups/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
    if (res.ok) { openAdminPanel(); loadGroups(); }
    else alert('Ошибка удаления');
}

// ===== CHAT DROPDOWN MENU =====
function toggleChatMenu() {
    const dropdown = document.getElementById('chatDropdown');
    const btn = document.getElementById('chatMenuBtn');
    const messages = document.getElementById('messages');
    if (dropdown.classList.contains('open')) {
        dropdown.classList.remove('open');
        messages.classList.remove('menu-open');
        return;
    }
    const rect = btn.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 6) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
    dropdown.classList.add('open');
    messages.classList.add('menu-open');
}
function closeChatMenu() {
    document.getElementById('chatDropdown').classList.remove('open');
    document.getElementById('messages').classList.remove('menu-open');
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('#chatMenuWrap')) closeChatMenu();
});

// ===== CONFIRM MODAL =====
let confirmCallback = null;
function showConfirm(title, text, onOk, danger = true) {
    document.getElementById('confirmTitle').innerText = title;
    document.getElementById('confirmText').innerText = text;
    const btn = document.getElementById('confirmOkBtn');
    btn.style.background = danger ? '#ef4444' : 'var(--accent)';
    btn.style.boxShadow = danger ? 'none' : '';
    confirmCallback = onOk;
    document.getElementById('confirmModal').classList.add('open');
}
function closeConfirm() {
    document.getElementById('confirmModal').classList.remove('open');
    confirmCallback = null;
}
document.getElementById('confirmOkBtn').onclick = () => {
    if (confirmCallback) confirmCallback();
    closeConfirm();
};

// ===== ДЕЙСТВИЯ В ЧАТЕ =====
async function clearChatHistory() {
    if (!currentChat) return;
    showConfirm(
        'Очистить чат',
        `Все сообщения с ${currentChat} будут удалены без возможности восстановления.`,
        async () => {
            await fetch(`/api/messages/clear?with=${encodeURIComponent(currentChat)}`, {
                method: 'DELETE',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
            });
            document.getElementById('messages').innerHTML = '';
        }
    );
}

function removeFriendCurrent() {
    if (!currentChat) return;
    showConfirm(
        'Удалить из друзей',
        `Удалить ${currentChat} из списка друзей?`,
        async () => {
            await fetch('/api/friend/remove', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ username: currentChat })
            });
            currentChat = null;
            document.querySelector('.chat-title').innerText = 'Выберите чат';
            document.getElementById('messages').innerHTML = '';
            document.getElementById('chatMenuWrap').style.display = 'none';
            loadFriends();
        }
    );
}

// ===== GROUP MENU =====
function toggleGroupMenu() {
    const dropdown = document.getElementById('groupDropdown');
    const btn = document.querySelector('#groupMenuWrap .chat-call-btn');
    const messages = document.getElementById('messages');
    if (dropdown.classList.contains('open')) {
        dropdown.classList.remove('open');
        messages.classList.remove('menu-open');
        return;
    }
    const rect = btn.getBoundingClientRect();
    dropdown.style.top = (rect.bottom + 6) + 'px';
    dropdown.style.right = (window.innerWidth - rect.right) + 'px';
    dropdown.classList.add('open');
    messages.classList.add('menu-open');
}
function closeGroupMenu() {
    document.getElementById('groupDropdown').classList.remove('open');
    document.getElementById('messages').classList.remove('menu-open');
}
document.addEventListener('click', (e) => {
    if (!e.target.closest('#groupMenuWrap')) closeGroupMenu();
});
// ========== ЛОКАЛИЗАЦИЯ ==========
const translations = {
    ru: {
        'Друзья': 'Друзья', 'Группы': 'Группы', 'Поиск': 'Поиск',
        'Запросы': 'Запросы', 'Профиль': 'Профиль', 'Аватар:': 'Аватар:',
        'Цвет ника:': 'Цвет ника:', 'Тема оформления': 'Тема оформления',
        'Сохранить': 'Сохранить', 'Выйти из аккаунта': 'Выйти из аккаунта',
        'Выбрать эмодзи': 'Выбрать эмодзи', 'Выберите чат': 'Выберите чат',
        'Сообщение...': 'Сообщение...', '+ Создать группу': '+ Создать группу',
        'Код приглашения...': 'Код приглашения...', 'Поиск пользователей...': 'Поиск пользователей...',
        'Нет входящих запросов': 'Нет входящих запросов', 'Язык': 'Язык',
        'Позвонить': 'Позвонить', 'Очистить чат': 'Очистить чат',
        'Удалить из друзей': 'Удалить из друзей', 'О группе': 'О группе',
    },
    en: {
        'Друзья': 'Friends', 'Группы': 'Groups', 'Поиск': 'Search',
        'Запросы': 'Requests', 'Профиль': 'Profile', 'Аватар:': 'Avatar:',
        'Цвет ника:': 'Nick color:', 'Тема оформления': 'Theme',
        'Сохранить': 'Save', 'Выйти из аккаунта': 'Log out',
        'Выбрать эмодзи': 'Pick emoji', 'Выберите чат': 'Select a chat',
        'Сообщение...': 'Message...', '+ Создать группу': '+ Create group',
        'Код приглашения...': 'Invite code...', 'Поиск пользователей...': 'Search users...',
        'Нет входящих запросов': 'No incoming requests', 'Язык': 'Language',
        'Позвонить': 'Call', 'Очистить чат': 'Clear chat',
        'Удалить из друзей': 'Remove friend', 'О группе': 'Group info',
    }
};

let currentLang = localStorage.getItem('lang') || 'ru';

function t(key) {
    return translations[currentLang][key] || key;
}

function applyLang() {
    // Все элементы с data-i18n атрибутом
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (el.tagName === 'INPUT') el.placeholder = t(key);
        else el.innerText = t(key);
    });
    // Плейсхолдер поля ввода сообщения
    const msgInput = document.getElementById('messageInput');
    if (msgInput && !currentChat && !currentGroupId) msgInput.placeholder = t('Сообщение...');
    // Кнопки дропдауна
    document.querySelectorAll('.chat-dropdown-item[data-i18n]').forEach(el => {
        el.childNodes[el.childNodes.length - 1].textContent = ' ' + t(el.getAttribute('data-i18n'));
    });
}

function toggleLang() {
    currentLang = currentLang === 'ru' ? 'en' : 'ru';
    localStorage.setItem('lang', currentLang);
    applyLang();
    document.getElementById('langToggleBtn').innerText = currentLang === 'ru' ? 'EN' : 'RU';
}

// Инициализация при загрузке
document.addEventListener('DOMContentLoaded', () => {
    applyLang();
    const btn = document.getElementById('langToggleBtn');
    if (btn) btn.innerText = currentLang === 'ru' ? 'EN' : 'RU';
});


// ========== PWA Service Worker ==========
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js')
      .then(reg => console.log('SW registered:', reg.scope))
      .catch(err => console.log('SW error:', err));
  });
}

// ========== Голосовые сообщения ==========

let voiceRecorder = null;
let voiceChunks = [];
let voiceTimerInterval = null;
let voiceSeconds = 0;
let voiceIsRecording = false;

function toggleVoiceRecord() {
    if (voiceIsRecording) {
        stopVoiceRecord();
    } else {
        startVoiceRecord();
    }
}

async function startVoiceRecord() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        voiceChunks = [];
        voiceIsRecording = true;

        // Показываем панель записи
        document.getElementById('voiceRecordingBar').style.display = 'flex';
        document.getElementById('messageInput').style.display = 'none';
        document.getElementById('voiceBtn').classList.add('recording');

        // Таймер
        voiceSeconds = 0;
        document.getElementById('voiceTimer').textContent = '0:00';
        voiceTimerInterval = setInterval(() => {
            voiceSeconds++;
            const m = Math.floor(voiceSeconds / 60);
            const s = voiceSeconds % 60;
            document.getElementById('voiceTimer').textContent = `${m}:${s.toString().padStart(2,'0')}`;
        }, 1000);

        // Анимация волн по уровню звука
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioCtx.createAnalyser();
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        analyser.fftSize = 32;
        const dataArr = new Uint8Array(analyser.frequencyBinCount);
        const waves = document.querySelectorAll('.vwave');
        function animateWaves() {
            if (!voiceIsRecording) return;
            analyser.getByteFrequencyData(dataArr);
            const avg = dataArr.reduce((a,b) => a+b,0) / dataArr.length;
            waves.forEach((w, i) => {
                const scale = 0.3 + (avg / 255) * 1.5 * (i === 2 ? 1 : 0.6 + Math.random() * 0.4);
                w.style.transform = `scaleY(${Math.min(scale, 2)})`;
                w.style.opacity = 0.6 + (avg / 255) * 0.4;
            });
            requestAnimationFrame(animateWaves);
        }
        animateWaves();

        voiceRecorder = new MediaRecorder(stream);
        voiceRecorder.ondataavailable = e => voiceChunks.push(e.data);
        voiceRecorder.onstop = async () => {
            stream.getTracks().forEach(t => t.stop());
            audioCtx.close();
            const blob = new Blob(voiceChunks, { type: 'audio/webm' });
            console.log('[VOICE] blob size:', blob.size);
            if (blob.size < 100) return;
            const formData = new FormData();
            formData.append('image', blob, 'voice.webm');
            const token = localStorage.getItem('token');
            const res = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: formData });
            const data = await res.json();
            console.log('[VOICE] upload response:', JSON.stringify(data));
            console.log('[VOICE] currentChat:', currentChat, 'currentGroupId:', currentGroupId);
            if (!data.imageUrl) { console.error('[VOICE] no imageUrl!'); return; }
            console.log('[VOICE] emitting with audioUrl:', data.imageUrl);
            const replyData = (typeof currentReplyId !== 'undefined' && currentReplyId) ? { messageId: currentReplyId, from: currentReplyFrom, text: currentReplyText } : null;
            if (currentGroupId) {
                socket.emit('send_group_message', { groupId: currentGroupId, text: '', audioUrl: data.imageUrl, audioDuration: voiceSeconds, replyTo: replyData });
            } else if (currentChat) {
                socket.emit('send_message', { to: currentChat, text: '', audioUrl: data.imageUrl, audioDuration: voiceSeconds, replyTo: replyData });
            }
            clearReply();
        };
        voiceRecorder.start(100);
    } catch (e) {
        alert('Нет доступа к микрофону');
        resetVoiceUI();
    }
}

function stopVoiceRecord() {
    if (voiceRecorder && voiceRecorder.state === 'recording') {
        voiceRecorder.stop();
    }
    resetVoiceUI();
}

function cancelVoiceRecord() {
    if (voiceRecorder && voiceRecorder.state === 'recording') {
        voiceRecorder.ondataavailable = null;
        voiceRecorder.onstop = null;
        voiceRecorder.stop();
    }
    voiceChunks = [];
    resetVoiceUI();
}

function resetVoiceUI() {
    voiceIsRecording = false;
    clearInterval(voiceTimerInterval);
    document.getElementById('voiceRecordingBar').style.display = 'none';
    document.getElementById('messageInput').style.display = '';
    document.getElementById('voiceBtn').classList.remove('recording');
    document.getElementById('voiceTimer').textContent = '0:00';
}

// ===== Voice Player =====
function vpToggle(id) {
    const el = document.getElementById(id);
    const audio = el.querySelector('audio');
    const btn = el.querySelector('.vp-play');
    if (audio.paused) {
        // Остановить все другие
        document.querySelectorAll('.voice-player audio').forEach(a => { if (a !== audio) { a.pause(); const b = a.closest('.voice-player')?.querySelector('.vp-play'); if(b) b.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>'; }});
        audio.play();
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
    } else {
        audio.pause();
        btn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>';
    }
}
function vpUpdate(id, audio) {
    const el = document.getElementById(id);
    if (!el) return;
    const dur = isFinite(audio.duration) ? audio.duration : 0;
    const pct = dur ? (audio.currentTime / dur * 100) : 0;
    el.querySelector('.vp-progress').style.width = pct + '%';
    // Пока играет — показываем текущее время, иначе длительность
    el.querySelector('.vp-time').textContent = audio.paused ? vpFmt(dur) : vpFmt(audio.currentTime);
}
function vpMeta(id, audio) {
    const el = document.getElementById(id);
    if (!el) return;
    const fallback = parseInt(audio.dataset.duration || '0');
    const dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : fallback;
    if (dur) el.querySelector('.vp-time').textContent = vpFmt(dur);
}
function vpEnded(id) {
    const el = document.getElementById(id);
    if (!el) return;
    el.querySelector('.vp-play').innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor" width="20" height="20"><path d="M8 5v14l11-7z"/></svg>';
    el.querySelector('.vp-progress').style.width = '0%';
    const audio = el.querySelector('audio');
    if (audio) { audio.currentTime = 0; el.querySelector('.vp-time').textContent = vpFmt(audio.duration); }
}
function vpSeek(id, e) {
    const el = document.getElementById(id);
    const audio = el.querySelector('audio');
    const bar = el.querySelector('.vp-bar');
    const rect = bar.getBoundingClientRect();
    audio.currentTime = ((e.clientX - rect.left) / rect.width) * audio.duration;
}
function vpFmt(s) {
    if (!s || !isFinite(s) || isNaN(s)) return '0:00';
    const m = Math.floor(s/60), sec = Math.floor(s%60);
    return `${m}:${sec.toString().padStart(2,'0')}`;
}

function updateFriendPreview(username, msg) {
    const item = document.querySelector(`.user-item[data-chat-key="dm_${username}"]`);
    if (!item) return;
    const isOwn = msg.from === currentUser?.username;
    const prefix = isOwn ? 'Вы: ' : '';
    const txt = msg.audioUrl ? 'Голосовое сообщение' : msg.imageUrl ? 'Фото' : (msg.text || '').slice(0, 35);
    const t = new Date(msg.timestamp || Date.now());
    const now = new Date();
    const timeStr = t.toDateString() === now.toDateString()
        ? t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : t.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
    let el = item.querySelector('.friend-last-msg');
    if (!el) {
        el = document.createElement('div');
        el.className = 'friend-last-msg';
        item.querySelector('.user-info-text')?.appendChild(el);
    }
    const isReadLive = isOwn && msg.readBy && msg.readBy.includes(username);
    const checkLive = isOwn ? `<span style="font-size:10px;color:${isReadLive ? 'var(--accent)' : 'var(--text-secondary)'};">${isReadLive ? '✓✓' : '✓'}</span>` : '';
    el.innerHTML = `<span class="last-msg-text">${prefix}${escapeHtml(txt)}</span><span class="last-msg-time-wrap">${checkLive}<span class="last-msg-time">${timeStr}</span></span>`;
}

// ===== Бургер меню =====
function toggleBurgerMenu() {
    const d = document.getElementById('burgerDropdown');
    d.style.display = d.style.display === 'none' ? 'block' : 'none';
    if (d.style.display === 'block') {
        if (currentUser) {
            document.getElementById('burgerAvatar').textContent = currentUser.avatar || '😀';
            document.getElementById('burgerUsername').textContent = currentUser.username;
            document.getElementById('burgerStatus').textContent = 'онлайн';
        }
        document.addEventListener('click', closeBurgerOnOutside);
    }
}
function closeBurgerMenu() {
    document.getElementById('burgerDropdown').style.display = 'none';
    document.removeEventListener('click', closeBurgerOnOutside);
}
function closeBurgerOnOutside(e) {
    const d = document.getElementById('burgerDropdown');
    const b = document.getElementById('burgerBtn');
    if (!d.contains(e.target) && !b.contains(e.target)) closeBurgerMenu();
}
function onSidebarSearch(val) {
    // Фильтрует по друзьям и группам
    const v = val.toLowerCase();
    document.querySelectorAll('#friendsList .user-item').forEach(el => {
        el.style.display = el.dataset.chatKey?.toLowerCase().includes(v) || el.innerText.toLowerCase().includes(v) ? '' : 'none';
    });
    document.querySelectorAll('#groupsList .user-item').forEach(el => {
        el.style.display = el.innerText.toLowerCase().includes(v) ? '' : 'none';
    });
}

// ===== Избранное (сообщения самому себе) =====
function openFavorites() {
    if (!currentUser) return;
    switchChat(currentUser.username);
    document.querySelector('.chat-title').innerText = '⭐ Избранное';
}

function closeChat() {
    currentChat = null;
    currentGroupId = null;
    document.getElementById('noChatSelected').style.display = 'flex';
    document.getElementById('inputArea').style.display = 'none';
    document.getElementById('backBtn').style.display = 'none';
    document.getElementById('chatMenuWrap').style.display = 'none';
    document.getElementById('groupMenuWrap').style.display = 'none';
    document.querySelector('.chat-title').innerText = 'Выберите чат';
    document.getElementById('messagesList').innerHTML = '';
    document.querySelectorAll('.user-item').forEach(el => el.classList.remove('active-chat'));
    if (window.innerWidth <= 768) sidebar.classList.add('open');
}

function switchToTab(tabId) {
    document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    // Hide channel view when switching away
    if (tabId !== 'channels') {
        const panel = document.getElementById('channelViewPanel');
        if (panel) panel.style.display = 'none';
        currentChannelId = null;
        const ch3 = document.getElementById('chatHeader');
        if (ch3) ch3.style.display = '';
        if (!currentChat && !currentGroupId) {
            document.getElementById('noChatSelected').style.display = 'flex';
        }
    }
    const tab = document.getElementById(`${tabId}-tab`);
    if (tab) tab.classList.add('active');
    const btn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
    if (btn) btn.classList.add('active');
    if (tabId === 'settings') initThemePanel();
    if (tabId === 'friends') loadFriends();
}

function openSettingsPanel() {
    const panel = document.getElementById('settingsPanel');
    panel.style.display = 'block';
    setTimeout(() => panel.classList.add('open'), 10);
    if (currentUser) {
        document.getElementById('settingsAvatar').textContent = currentUser.avatar || '😀';
        document.getElementById('settingsUsername').textContent = currentUser.username;
    }
    initThemePanel();
}
function closeSettingsPanel() {
    const panel = document.getElementById('settingsPanel');
    panel.classList.remove('open');
    setTimeout(() => panel.style.display = 'none', 250);
}

// ========== CHANNELS ==========
let currentChannelId = null;
let currentChannelOwner = null;
let currentPostId = null;

async function loadChannels() {
    const token = localStorage.getItem('token');
    const res = await fetch('/api/channels', { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const channels = await res.json();
    const list = document.getElementById('channelsList');
    if (!list) return;
    list.innerHTML = '';
    // If no channel open, make sure panel is hidden
    if (!currentChannelId) {
        const panel = document.getElementById('channelViewPanel');
        if (panel) panel.style.display = 'none';
    }
    if (channels.length === 0) {
        list.innerHTML = '<div style="padding:20px; text-align:center; color:var(--text-secondary); font-size:13px;">Каналов пока нет</div>';
        return;
    }
    channels.forEach(ch => {
        const div = document.createElement('div');
        div.className = 'channel-item';
        div.innerHTML = `
            <span class="channel-avatar">${ch.avatar || '📢'}</span>
            <div class="channel-info">
                <div class="channel-name">${escapeHtml(ch.name)}</div>
                <div class="channel-desc">${escapeHtml(ch.description || '')}</div>
            </div>
            <div class="channel-meta">
                <span class="channel-subs">${ch.subscribers.length} подп.</span>
            </div>`;
        div.dataset.id = ch._id;
        div.onclick = () => openChannel(ch);
        list.appendChild(div);
    });
}

function openCreateChannelModal() {
    document.getElementById('channelNameInput').value = '';
    document.getElementById('channelDescInput').value = '';
    document.getElementById('channelAvatarInput').value = '';
    document.getElementById('createChannelModal').classList.add('open');
}

async function createChannel() {
    const token = localStorage.getItem('token');
    const name = document.getElementById('channelNameInput').value.trim();
    const description = document.getElementById('channelDescInput').value.trim();
    const avatar = document.getElementById('channelAvatarInput').value.trim() || '📢';
    if (!name) return;
    const res = await fetch('/api/channels', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ name, description, avatar })
    });
    if (res.ok) {
        closeModal('createChannelModal');
        loadChannels();
    }
}

async function openChannel(ch) {
    currentChannelId = ch._id;
    currentChannelOwner = ch.owner;

    // Mark active
    document.querySelectorAll('.channel-item').forEach(el => el.classList.remove('active-channel'));
    const activeEl = document.querySelector(`.channel-item[data-id="${ch._id}"]`);
    if (activeEl) activeEl.classList.add('active-channel');

    document.getElementById('channelViewAvatar').textContent = ch.avatar || '📢';
    document.getElementById('channelViewName').textContent = ch.name;
    document.getElementById('channelViewSubs').textContent = ch.subscribers.length + ' подписчиков';

    const isOwner = currentUser && ch.owner === currentUser.username;
    const isSubbed = currentUser && ch.subscribers.includes(currentUser.username);
    const subBtn = document.getElementById('channelSubBtn');
    subBtn.textContent = isSubbed ? 'Отписаться' : 'Подписаться';
    subBtn.className = isSubbed ? 'secondary-btn' : 'primary-btn';
    document.getElementById('channelPostBtn').style.display = isOwner ? 'flex' : 'none';
    document.getElementById('channelStatsBtn').style.display = isOwner ? 'flex' : 'none';
    document.getElementById('channelDeleteBtn').style.display = isOwner ? 'flex' : 'none';
    document.getElementById('postEditor').style.display = 'none';

    // Show channel in .main area
    document.getElementById('noChatSelected').style.display = 'none';
    document.getElementById('inputArea').style.display = 'none';
    const chatHeader = document.getElementById('chatHeader');
    if (chatHeader) chatHeader.style.display = 'none';
    document.getElementById('channelViewPanel').style.display = 'flex';
    document.getElementById('channelView').style.display = 'flex';
    await loadChannelPosts();
}

async function loadChannelPosts() {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/channels/${currentChannelId}/posts`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const posts = await res.json();
    const list = document.getElementById('channelPostsList');
    list.innerHTML = '';
    if (posts.length === 0) {
        list.innerHTML = '<div style="padding:30px; text-align:center; color:var(--text-secondary); font-size:13px;">Постов пока нет</div>';
        return;
    }
    posts.forEach(post => renderPost(post, list));
}

const REACTION_EMOJIS = ['❤️','🔥','👍','😂','😮','😢','👏','🎉'];

function renderPost(post, container) {
    const isOwner = currentUser && currentChannelOwner === currentUser.username;
    const isLiked = currentUser && post.likes.includes(currentUser.username);
    const time = new Date(post.createdAt).toLocaleString('ru', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
    const reactions = post.reactions || [];
    const reactionsHtml = reactions.filter(r => r.users.length > 0).map(r => {
        const mine = currentUser && r.users.includes(currentUser.username);
        return `<button class="post-reaction-pill ${mine ? 'mine' : ''}" onclick="toggleReaction('${post._id}', '${r.emoji}', this)">${r.emoji} <span>${r.users.length}</span></button>`;
    }).join('');

    const div = document.createElement('div');
    div.className = 'channel-post';
    div.dataset.id = post._id;
    div.innerHTML = `
        ${post.imageUrl ? `<img src="${post.imageUrl}" class="post-image" alt="" onclick="openImageModal('${post.imageUrl}')">` : ''}
        ${post.text ? `<div class="post-text">${escapeHtml(post.text)}</div>` : ''}
        ${reactionsHtml ? `<div class="post-reactions">${reactionsHtml}</div>` : ''}
        <div class="post-footer">
            <div class="post-footer-left">
                <span class="post-views-count">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="13" height="13"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                    ${post.views || 0}
                </span>
                <span class="post-time">${time}</span>
            </div>
            <div class="post-actions">
                <button class="post-react-trigger" onclick="toggleReactionPicker('${post._id}', this)">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><circle cx="12" cy="12" r="10"/><path d="M8 13s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>
                </button>
                <button class="post-like-btn ${isLiked ? 'liked' : ''}" onclick="toggleLike('${post._id}', this)">
                    <svg viewBox="0 0 24 24" fill="${isLiked ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z"/></svg>
                    <span>${post.likes.length}</span>
                </button>
                <button class="post-comment-btn" onclick="openComments('${post._id}')">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>
                    <span id="commentCount_${post._id}">0</span>
                </button>
                ${isOwner ? `<button class="post-delete-btn" onclick="deletePost('${post._id}', this)" title="Удалить пост"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><polyline points="3,6 5,6 21,6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6"/></svg></button>` : ''}
            </div>
        </div>`;
    container.appendChild(div);
    // Count comments async
    fetch(`/api/posts/${post._id}/comments`, { headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } })
        .then(r => r.json()).then(comments => {
            const el = document.getElementById(`commentCount_${post._id}`);
            if (el) el.textContent = comments.length;
        }).catch(() => {});
    // Track view
    fetch(`/api/posts/${post._id}/view`, { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('token') } }).catch(() => {});
}

function toggleReactionPicker(postId, btn) {
    document.querySelectorAll('.post-reaction-picker').forEach(p => p.remove());
    const picker = document.createElement('div');
    picker.className = 'post-reaction-picker';
    picker.innerHTML = REACTION_EMOJIS.map(e => `<button onclick="toggleReaction('${postId}', '${e}', this.closest('.channel-post').querySelector('.post-reactions') || null); this.closest('.post-reaction-picker').remove();">${e}</button>`).join('');
    btn.parentNode.insertBefore(picker, btn.nextSibling);
    setTimeout(() => document.addEventListener('click', function h(e) {
        if (!picker.contains(e.target) && e.target !== btn) { picker.remove(); document.removeEventListener('click', h); }
    }), 10);
}

async function toggleReaction(postId, emoji, refEl) {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/posts/${postId}/react`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ emoji }) });
    if (!res.ok) return;
    const data = await res.json();
    // Re-render reactions on post
    const postEl = document.querySelector(`.channel-post[data-id="${postId}"]`);
    if (!postEl) return;
    let reactDiv = postEl.querySelector('.post-reactions');
    const newReactions = data.reactions.filter(r => r.users.length > 0);
    if (newReactions.length === 0) { if (reactDiv) reactDiv.remove(); return; }
    if (!reactDiv) {
        reactDiv = document.createElement('div');
        reactDiv.className = 'post-reactions';
        postEl.querySelector('.post-text, .post-image')?.after(reactDiv) || postEl.querySelector('.post-footer').before(reactDiv);
    }
    reactDiv.innerHTML = newReactions.map(r => {
        const mine = currentUser && r.users.includes(currentUser.username);
        return `<button class="post-reaction-pill ${mine ? 'mine' : ''}" onclick="toggleReaction('${postId}', '${r.emoji}', this)">${r.emoji} <span>${r.users.length}</span></button>`;
    }).join('');
}

async function deletePost(postId, btn) {
    if (!confirm('Удалить этот пост?')) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/posts/${postId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) {
        btn.closest('.channel-post')?.remove();
    }
}

async function deleteChannel() {
    if (!confirm('Удалить канал? Это действие нельзя отменить.')) return;
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/channels/${currentChannelId}`, { method: 'DELETE', headers: { Authorization: 'Bearer ' + token } });
    if (res.ok) {
        document.getElementById('channelViewPanel').style.display = 'none';
        document.getElementById('noChatSelected').style.display = 'flex';
        currentChannelId = null;
        loadChannels();
    }
}

async function openChannelStats() {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/channels/${currentChannelId}/stats`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const s = await res.json();
    const body = document.getElementById('channelStatsBody');
    body.innerHTML = `
        <div class="stats-row"><span>Подписчиков</span><strong>${s.subscribers}</strong></div>
        <div class="stats-row"><span>Постов</span><strong>${s.posts}</strong></div>
        <div class="stats-row"><span>Просмотров</span><strong>${s.totalViews}</strong></div>
        <div class="stats-row"><span>Лайков</span><strong>${s.totalLikes}</strong></div>
        <div class="stats-row"><span>Комментариев</span><strong>${s.totalComments}</strong></div>`;
    document.getElementById('channelStatsModal').classList.add('open');
}

async function toggleLike(postId, btn) {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/posts/${postId}/like`, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const data = await res.json();
    btn.classList.toggle('liked', data.liked);
    btn.querySelector('svg').setAttribute('fill', data.liked ? 'currentColor' : 'none');
    btn.querySelector('span').textContent = data.count;
}

async function toggleSubscribe() {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/channels/${currentChannelId}/subscribe`, { method: 'POST', headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const data = await res.json();
    const btn = document.getElementById('channelSubBtn');
    btn.textContent = data.subscribed ? 'Отписаться' : 'Подписаться';
    btn.className = data.subscribed ? 'secondary-btn' : 'primary-btn';
    document.getElementById('channelViewSubs').textContent = data.count + ' подписчиков';
    loadChannels();
}

function openPostEditor() {
    const ed = document.getElementById('postEditor');
    ed.style.display = ed.style.display === 'none' ? 'block' : 'none';
}

async function submitPost() {
    const token = localStorage.getItem('token');
    const text = document.getElementById('postTextInput').value.trim();
    const fileInput = document.getElementById('postImageInput');
    let imageUrl = null;

    if (fileInput.files[0]) {
        const formData = new FormData();
        formData.append('image', fileInput.files[0]);
        const uploadRes = await fetch('/api/upload', { method: 'POST', headers: { Authorization: 'Bearer ' + token }, body: formData });
        if (uploadRes.ok) {
            const uploadData = await uploadRes.json();
            imageUrl = uploadData.imageUrl;
        }
    }

    if (!text && !imageUrl) return;
    const res = await fetch(`/api/channels/${currentChannelId}/posts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ text, imageUrl })
    });
    if (res.ok) {
        document.getElementById('postTextInput').value = '';
        document.getElementById('postImageInput').value = '';
        document.getElementById('postImagePreview').style.display = 'none';
        document.getElementById('postImageName').textContent = '';
        document.getElementById('postEditor').style.display = 'none';
        await loadChannelPosts();
    }
}

async function openComments(postId) {
    currentPostId = postId;
    document.getElementById('commentInput').value = '';
    document.getElementById('commentsModal').classList.add('open');
    await loadComments();
}

async function loadComments() {
    const token = localStorage.getItem('token');
    const res = await fetch(`/api/posts/${currentPostId}/comments`, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) return;
    const comments = await res.json();
    const list = document.getElementById('commentsList');
    list.innerHTML = '';
    if (comments.length === 0) {
        list.innerHTML = '<div style="text-align:center; color:var(--text-secondary); font-size:13px; padding:16px;">Комментариев пока нет</div>';
        return;
    }
    comments.forEach(c => {
        const div = document.createElement('div');
        div.className = 'comment-item';
        div.innerHTML = `
            <span class="comment-avatar">${c.avatar || '😀'}</span>
            <div class="comment-body">
                <span class="comment-author" style="color:${c.color}">${escapeHtml(c.from)}</span>
                <span class="comment-text">${escapeHtml(c.text)}</span>
            </div>`;
        list.appendChild(div);
    });
    list.scrollTop = list.scrollHeight;
}

async function submitComment() {
    const token = localStorage.getItem('token');
    const text = document.getElementById('commentInput').value.trim();
    if (!text) return;
    const res = await fetch(`/api/posts/${currentPostId}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify({ text })
    });
    if (res.ok) {
        document.getElementById('commentInput').value = '';
        await loadComments();
    }
}

// Подгружаем каналы при переключении на таб
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            if (btn.dataset.tab === 'channels') loadChannels();
        });
    });
});

function previewPostImage(input) {
    const file = input.files[0];
    if (!file) return;
    document.getElementById('postImageName').textContent = file.name;
    const reader = new FileReader();
    reader.onload = e => {
        const img = document.getElementById('postImagePreview');
        img.src = e.target.result;
        img.style.display = 'block';
    };
    reader.readAsDataURL(file);
}

// Search filter buttons
document.addEventListener('DOMContentLoaded', () => {
    document.querySelectorAll('.search-filter-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.search-filter-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const input = document.getElementById('searchUserInput');
            if (input.value.trim()) input.dispatchEvent(new Event('input'));
        });
    });
});
