require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET", "POST"] }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error('Missing MONGODB_URI or JWT_SECRET');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB connected');
    // Сбросить всех пользователей в оффлайн при старте сервера
    await User.updateMany({}, { online: false, socketId: null });
    console.log('✅ Online status reset');
  })
  .catch(err => console.error('❌ MongoDB connection error:', err));

// ========== Модели ==========
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '😀' },
  color: { type: String, default: '#6ab0f3' },
  online: { type: Boolean, default: false },
  socketId: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now },
  friends: [{ type: String }],
  friendRequests: [{ type: String }]
});

const MessageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, default: null },         // username для личных
  groupId: { type: mongoose.Schema.Types.ObjectId, default: null }, // id группы
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false },
  deleted: { type: Boolean, default: false },
  color: { type: String, default: '#6ab0f3' },
  avatar: { type: String, default: '😀' }
});

const GroupSchema = new mongoose.Schema({
  name: { type: String, required: true },
  description: { type: String, default: '' },
  avatar: { type: String, default: '👥' },
  type: { type: String, enum: ['public', 'private'], default: 'private' },
  owner: { type: String, required: true },
  members: [{ type: String }],
  inviteCode: { type: String, unique: true, sparse: true },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);
const Group = mongoose.model('Group', GroupSchema);

// ========== Middleware JWT ==========
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) return res.status(403).json({ error: 'Token invalid or expired' });
      req.user = user;
      next();
    });
  } else {
    res.status(401).json({ error: 'No token provided' });
  }
};

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ========== AUTH API ==========
app.post('/api/register', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'All fields required' });
  const existing = await User.findOne({ username });
  if (existing) return res.status(400).json({ error: 'Username taken' });
  const hashed = await bcrypt.hash(password, 10);
  const user = new User({ username, password: hashed });
  await user.save();
  const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { username: user.username, avatar: user.avatar, color: user.color } });
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { username: user.username, avatar: user.avatar, color: user.color } });
});

app.get('/api/me', authenticateJWT, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  res.json({ username: user.username, avatar: user.avatar, color: user.color });
});

app.post('/api/me/update', authenticateJWT, async (req, res) => {
  const { avatar, color } = req.body;
  const update = {};
  if (avatar) update.avatar = avatar;
  if (color) update.color = color;
  await User.updateOne({ username: req.user.username }, update);
  res.json({ message: 'Profile updated' });
});

// ========== USERS API ==========
app.get('/api/users/search', authenticateJWT, async (req, res) => {
  const q = req.query.q || '';
  const regex = new RegExp(q, 'i');
  const users = await User.find({ username: regex }, 'username avatar color online lastSeen');
  const filtered = users.filter(u => u.username !== req.user.username);
  res.json(filtered);
});

app.get('/api/friends', authenticateJWT, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  const friends = await User.find({ username: { $in: user.friends } }, 'username avatar color online lastSeen');
  res.json(friends);
});

app.get('/api/friend-requests', authenticateJWT, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  res.json(user.friendRequests);
});

app.post('/api/friend-request', authenticateJWT, async (req, res) => {
  const { to } = req.body;
  if (!to) return res.status(400).json({ error: 'Username required' });
  if (to === req.user.username) return res.status(400).json({ error: 'Cannot add yourself' });
  const target = await User.findOne({ username: to });
  if (!target) return res.status(404).json({ error: 'User not found' });
  if (target.friends.includes(req.user.username)) return res.status(400).json({ error: 'Already friends' });
  if (target.friendRequests.includes(req.user.username)) return res.status(400).json({ error: 'Request already sent' });
  await User.updateOne({ username: to }, { $push: { friendRequests: req.user.username } });
  if (target.socketId) io.to(target.socketId).emit('friend_request', { from: req.user.username });
  res.json({ message: 'Friend request sent' });
});

app.post('/api/friend-request/accept', authenticateJWT, async (req, res) => {
  const { from } = req.body;
  if (!from) return res.status(400).json({ error: 'Username required' });
  const currentUser = await User.findOne({ username: req.user.username });
  if (!currentUser.friendRequests.includes(from)) return res.status(400).json({ error: 'No request from this user' });
  await User.updateOne({ username: req.user.username }, { $pull: { friendRequests: from }, $push: { friends: from } });
  await User.updateOne({ username: from }, { $push: { friends: req.user.username } });
  const fromUser = await User.findOne({ username: from });
  if (fromUser.socketId) io.to(fromUser.socketId).emit('friend_accepted', { by: req.user.username });
  res.json({ message: 'Friend added' });
});

app.post('/api/friend-request/reject', authenticateJWT, async (req, res) => {
  const { from } = req.body;
  if (!from) return res.status(400).json({ error: 'Username required' });
  await User.updateOne({ username: req.user.username }, { $pull: { friendRequests: from } });
  res.json({ message: 'Request rejected' });
});

// ========== MESSAGES API ==========
app.get('/api/messages', authenticateJWT, async (req, res) => {
  const { with: otherUser } = req.query;
  if (!otherUser) return res.json([]);
  const messages = await Message.find({
    groupId: null,
    $or: [
      { from: req.user.username, to: otherUser, deleted: false },
      { from: otherUser, to: req.user.username, deleted: false }
    ]
  }).sort({ timestamp: 1 }).limit(100);
  res.json(messages);
});

// ========== GROUPS API ==========

// Создать группу
app.post('/api/groups', authenticateJWT, async (req, res) => {
  const { name, description, type, avatar, members } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });

  const inviteCode = type === 'public' ? generateInviteCode() : generateInviteCode();
  const allMembers = [req.user.username, ...(members || [])];
  const uniqueMembers = [...new Set(allMembers)];

  const group = new Group({
    name: name.trim(),
    description: description || '',
    avatar: avatar || '👥',
    type: type || 'private',
    owner: req.user.username,
    members: uniqueMembers,
    inviteCode
  });
  await group.save();

  // Уведомляем всех приглашённых участников
  for (const member of uniqueMembers) {
    if (member !== req.user.username) {
      const memberUser = await User.findOne({ username: member });
      if (memberUser && memberUser.socketId) {
        io.to(memberUser.socketId).emit('group_added', {
          group: { _id: group._id, name: group.name, avatar: group.avatar, type: group.type, owner: group.owner, members: group.members, inviteCode: group.inviteCode }
        });
      }
    }
  }

  res.json({ group });
});

// Мои группы
app.get('/api/groups', authenticateJWT, async (req, res) => {
  const groups = await Group.find({ members: req.user.username });
  res.json(groups);
});

// Публичные группы (поиск) — только type === 'public', приватные никогда не попадают сюда
app.get('/api/groups/public', authenticateJWT, async (req, res) => {
  const q = req.query.q || '';
  const regex = new RegExp(q, 'i');
  const groups = await Group.find({ type: 'public', name: regex })
    .select('_id name description avatar type members owner');
  // Явно не возвращаем inviteCode в публичном поиске
  res.json(groups);
});

// Вступить по инвайт-коду
app.post('/api/groups/join', authenticateJWT, async (req, res) => {
  const { inviteCode } = req.body;
  if (!inviteCode) return res.status(400).json({ error: 'Invite code required' });
  const group = await Group.findOne({ inviteCode: inviteCode.toUpperCase() });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.members.includes(req.user.username)) return res.status(400).json({ error: 'Already a member' });
  await Group.updateOne({ _id: group._id }, { $push: { members: req.user.username } });
  const updated = await Group.findById(group._id);

  // Уведомить всех участников
  for (const member of updated.members) {
    const memberUser = await User.findOne({ username: member });
    if (memberUser && memberUser.socketId) {
      io.to(memberUser.socketId).emit('group_member_joined', { groupId: group._id, username: req.user.username });
    }
  }

  res.json({ group: updated });
});

// Получить инвайт-ссылку группы (доступно любому участнику, для обоих типов)
app.get('/api/groups/:id/invite', authenticateJWT, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.members.includes(req.user.username)) return res.status(403).json({ error: 'Not a member' });
  res.json({ inviteCode: group.inviteCode, type: group.type });
});

// Присоединиться к публичной группе
app.post('/api/groups/:id/join', authenticateJWT, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.type !== 'public') return res.status(403).json({ error: 'Private group' });
  if (group.members.includes(req.user.username)) return res.status(400).json({ error: 'Already a member' });
  await Group.updateOne({ _id: group._id }, { $push: { members: req.user.username } });
  const updated = await Group.findById(group._id);
  res.json({ group: updated });
});

// Выйти из группы
app.post('/api/groups/:id/leave', authenticateJWT, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.owner === req.user.username) return res.status(400).json({ error: 'Owner cannot leave. Delete the group instead.' });
  await Group.updateOne({ _id: group._id }, { $pull: { members: req.user.username } });

  for (const member of group.members) {
    const memberUser = await User.findOne({ username: member });
    if (memberUser && memberUser.socketId) {
      io.to(memberUser.socketId).emit('group_member_left', { groupId: group._id, username: req.user.username });
    }
  }
  res.json({ message: 'Left group' });
});

// Удалить группу (только owner)
app.delete('/api/groups/:id', authenticateJWT, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.owner !== req.user.username) return res.status(403).json({ error: 'Only owner can delete group' });

  for (const member of group.members) {
    const memberUser = await User.findOne({ username: member });
    if (memberUser && memberUser.socketId) {
      io.to(memberUser.socketId).emit('group_deleted', { groupId: group._id });
    }
  }

  await Message.deleteMany({ groupId: group._id });
  await Group.deleteOne({ _id: group._id });
  res.json({ message: 'Group deleted' });
});

// Пригласить участника (только owner/member)
app.post('/api/groups/:id/invite', authenticateJWT, async (req, res) => {
  const { username } = req.body;
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (!group.members.includes(req.user.username)) return res.status(403).json({ error: 'Not a member' });
  if (group.members.includes(username)) return res.status(400).json({ error: 'Already a member' });
  const target = await User.findOne({ username });
  if (!target) return res.status(404).json({ error: 'User not found' });

  await Group.updateOne({ _id: group._id }, { $push: { members: username } });
  const updated = await Group.findById(group._id);

  if (target.socketId) {
    io.to(target.socketId).emit('group_added', {
      group: { _id: updated._id, name: updated.name, avatar: updated.avatar, type: updated.type, owner: updated.owner, members: updated.members, inviteCode: updated.inviteCode }
    });
  }

  for (const member of group.members) {
    const memberUser = await User.findOne({ username: member });
    if (memberUser && memberUser.socketId) {
      io.to(memberUser.socketId).emit('group_member_joined', { groupId: group._id, username });
    }
  }

  res.json({ message: 'User invited', group: updated });
});

// История сообщений группы
app.get('/api/groups/:id/messages', authenticateJWT, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.type === 'private' && !group.members.includes(req.user.username)) {
    return res.status(403).json({ error: 'Not a member' });
  }
  const messages = await Message.find({ groupId: group._id, deleted: false })
    .sort({ timestamp: 1 }).limit(100);
  res.json(messages);
});

// ========== Socket.IO ==========
io.use(async (socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('Authentication error'));
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findOne({ username: decoded.username });
    if (!user) return next(new Error('User not found'));
    socket.user = user;
    next();
  } catch (err) {
    next(new Error('Invalid token'));
  }
});

io.on('connection', async (socket) => {
  const user = socket.user;

  await User.updateOne({ username: user.username }, { online: true, socketId: socket.id, lastSeen: new Date() });

  const userDoc = await User.findOne({ username: user.username });

  // Уведомить друзей об онлайн
  for (const friend of userDoc.friends) {
    const friendUser = await User.findOne({ username: friend });
    if (friendUser && friendUser.socketId) {
      io.to(friendUser.socketId).emit('friend_status', { username: user.username, online: true });
    }
  }

  // Подписать сокет на все группы пользователя
  const userGroups = await Group.find({ members: user.username });
  for (const group of userGroups) {
    socket.join(`group:${group._id}`);
  }

  // История личных сообщений
  const recentMessages = await Message.find({
    groupId: null,
    $or: [
      { to: user.username, deleted: false },
      { from: user.username, deleted: false }
    ]
  }).sort({ timestamp: -1 }).limit(50);
  socket.emit('history', recentMessages.reverse());

  // ===== Личные сообщения =====
  socket.on('send_message', async (data) => {
    const { to, text } = data;
    if (!text || !text.trim()) return;

    const freshUser = await User.findOne({ username: user.username });

    const message = new Message({
      from: user.username,
      to: to || null,
      groupId: null,
      text: text.trim(),
      timestamp: new Date(),
      color: freshUser.color,
      avatar: freshUser.avatar
    });
    await message.save();

    const messageData = {
      _id: message._id,
      from: user.username,
      to: message.to,
      groupId: null,
      text: message.text,
      timestamp: message.timestamp,
      color: freshUser.color,
      avatar: freshUser.avatar,
      edited: false,
      deleted: false
    };

    const recipient = await User.findOne({ username: to });
    if (recipient && recipient.socketId) {
      io.to(recipient.socketId).emit('private_message', messageData);
    }
    socket.emit('private_message', messageData);
  });

  // ===== Групповые сообщения =====
  socket.on('send_group_message', async (data) => {
    const { groupId, text } = data;
    if (!text || !text.trim()) return;

    const group = await Group.findById(groupId);
    if (!group || !group.members.includes(user.username)) return;

    const freshUser = await User.findOne({ username: user.username });

    const message = new Message({
      from: user.username,
      to: null,
      groupId: group._id,
      text: text.trim(),
      timestamp: new Date(),
      color: freshUser.color,
      avatar: freshUser.avatar
    });
    await message.save();

    const messageData = {
      _id: message._id,
      from: user.username,
      groupId: group._id,
      text: message.text,
      timestamp: message.timestamp,
      color: freshUser.color,
      avatar: freshUser.avatar,
      edited: false,
      deleted: false
    };

    io.to(`group:${group._id}`).emit('group_message', messageData);
  });

  // ===== Редактирование =====
  socket.on('edit_message', async (data) => {
    const { messageId, newText } = data;
    if (!messageId || !newText.trim()) return;
    const message = await Message.findById(messageId);
    if (!message || message.from !== user.username) return;
    message.text = newText.trim();
    message.edited = true;
    await message.save();

    if (message.groupId) {
      io.to(`group:${message.groupId}`).emit('message_edited', { messageId, newText: message.text });
    } else {
      const recipient = await User.findOne({ username: message.to });
      if (recipient && recipient.socketId) {
        io.to(recipient.socketId).emit('message_edited', { messageId, newText: message.text });
      }
      socket.emit('message_edited', { messageId, newText: message.text });
    }
  });

  // ===== Удаление =====
  socket.on('delete_message', async (data) => {
    const { messageId } = data;
    const message = await Message.findById(messageId);
    if (!message || message.from !== user.username) return;
    message.deleted = true;
    await message.save();

    if (message.groupId) {
      io.to(`group:${message.groupId}`).emit('message_deleted', { messageId });
    } else {
      const recipient = await User.findOne({ username: message.to });
      if (recipient && recipient.socketId) {
        io.to(recipient.socketId).emit('message_deleted', { messageId });
      }
      socket.emit('message_deleted', { messageId });
    }
  });

  // ===== Typing =====
  socket.on('typing', async (data) => {
    const { to, groupId } = data;
    if (groupId) {
      socket.to(`group:${groupId}`).emit('typing', { from: user.username, groupId });
    } else if (to) {
      const recipientUser = await User.findOne({ username: to });
      if (recipientUser && recipientUser.socketId) {
        io.to(recipientUser.socketId).emit('typing', { from: user.username });
      }
    }
  });

  // ===== Подписка на группу после создания =====
  socket.on('join_group_room', (groupId) => {
    socket.join(`group:${groupId}`);
  });

  socket.on('disconnect', async () => {
    await User.updateOne({ username: user.username }, { online: false, socketId: null, lastSeen: new Date() });
    for (const friend of userDoc.friends) {
      const friendUser = await User.findOne({ username: friend });
      if (friendUser && friendUser.socketId) {
        io.to(friendUser.socketId).emit('friend_status', { username: user.username, online: false, lastSeen: new Date() });
      }
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
