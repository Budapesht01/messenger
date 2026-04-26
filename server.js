require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*", methods: ["GET", "POST"] } });

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Uploads папка
const uploadsDir = path.join(__dirname, 'public', 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `${Date.now()}_${Math.random().toString(36).substr(2,6)}${ext}`);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10mb
  fileFilter: (req, file, cb) => {
    const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, allowed.includes(ext));
  }
});

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error('Missing MONGODB_URI or JWT_SECRET');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(async () => {
    console.log('✅ MongoDB connected');
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
  to: { type: String, default: null },
  groupId: { type: mongoose.Schema.Types.ObjectId, default: null },
  text: { type: String, default: '' },
  imageUrl: { type: String, default: null },
  replyTo: {
    messageId: { type: mongoose.Schema.Types.ObjectId, default: null },
    from: { type: String, default: null },
    text: { type: String, default: null }
  },
  reactions: [{ emoji: String, users: [String] }],
  readBy: [{ type: String }],
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

// ========== Middleware ==========
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

const ADMIN_USERNAME = 'Budapesht';
const requireAdmin = (req, res, next) => {
  if (req.user.username !== ADMIN_USERNAME) return res.status(403).json({ error: 'Access denied' });
  next();
};

function generateInviteCode() {
  return Math.random().toString(36).substring(2, 10).toUpperCase();
}

// ========== AUTH ==========
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

// ========== UPLOAD IMAGE ==========
app.post('/api/upload', authenticateJWT, upload.single('image'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

// ========== USERS ==========
app.get('/api/users/search', authenticateJWT, async (req, res) => {
  const q = req.query.q || '';
  const users = await User.find({ username: new RegExp(q, 'i') }, 'username avatar color online lastSeen');
  res.json(users.filter(u => u.username !== req.user.username));
});

app.get('/api/friends', authenticateJWT, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  const friends = await User.find({ username: { $in: user.friends } }, 'username avatar color online lastSeen');

  // Для каждого друга находим последнее сообщение
  const friendsWithLastMsg = await Promise.all(friends.map(async (friend) => {
    const lastMsg = await Message.findOne({
      groupId: null,
      deleted: false,
      $or: [
        { from: req.user.username, to: friend.username },
        { from: friend.username, to: req.user.username }
      ]
    }).sort({ timestamp: -1 }).select('text imageUrl timestamp from');

    return {
      username: friend.username,
      avatar: friend.avatar,
      color: friend.color,
      online: friend.online,
      lastSeen: friend.lastSeen,
      lastMessage: lastMsg ? {
        text: lastMsg.text || (lastMsg.imageUrl ? '📷 Фото' : ''),
        timestamp: lastMsg.timestamp,
        fromMe: lastMsg.from === req.user.username
      } : null
    };
  }));

  // Сортируем по времени последнего сообщения
  friendsWithLastMsg.sort((a, b) => {
    const ta = a.lastMessage?.timestamp || 0;
    const tb = b.lastMessage?.timestamp || 0;
    return new Date(tb) - new Date(ta);
  });

  res.json(friendsWithLastMsg);
});

app.get('/api/friend-requests', authenticateJWT, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  res.json(user.friendRequests);
});

app.post('/api/friend/remove', authenticateJWT, async (req, res) => {
  const { username } = req.body;
  if (!username) return res.status(400).json({ error: 'Username required' });
  await User.updateOne({ username: req.user.username }, { $pull: { friends: username } });
  await User.updateOne({ username }, { $pull: { friends: req.user.username } });
  res.json({ ok: true });
});

app.delete('/api/messages/clear', authenticateJWT, async (req, res) => {
  const { with: withUser } = req.query;
  if (!withUser) return res.status(400).json({ error: 'Missing user' });
  await Message.deleteMany({
    $or: [
      { from: req.user.username, to: withUser },
      { from: withUser, to: req.user.username }
    ]
  });
  res.json({ ok: true });
});

app.post('/api/friend-request', authenticateJWT, async (req, res) => {
  const { to } = req.body;
  if (!to || to === req.user.username) return res.status(400).json({ error: 'Invalid' });
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
  const currentUser = await User.findOne({ username: req.user.username });
  if (!currentUser.friendRequests.includes(from)) return res.status(400).json({ error: 'No request' });
  await User.updateOne({ username: req.user.username }, { $pull: { friendRequests: from }, $push: { friends: from } });
  await User.updateOne({ username: from }, { $push: { friends: req.user.username } });
  const fromUser = await User.findOne({ username: from });
  if (fromUser.socketId) io.to(fromUser.socketId).emit('friend_accepted', { by: req.user.username });
  res.json({ message: 'Friend added' });
});

app.post('/api/friend-request/reject', authenticateJWT, async (req, res) => {
  const { from } = req.body;
  await User.updateOne({ username: req.user.username }, { $pull: { friendRequests: from } });
  res.json({ message: 'Request rejected' });
});

// ========== MESSAGES ==========
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

// Отметить как прочитанное
app.post('/api/messages/read', authenticateJWT, async (req, res) => {
  const { with: otherUser } = req.body;
  if (!otherUser) return res.json({ ok: true });
  await Message.updateMany(
    { from: otherUser, to: req.user.username, deleted: false, readBy: { $ne: req.user.username } },
    { $addToSet: { readBy: req.user.username } }
  );
  // Уведомить отправителя что прочитали
  const otherUserDoc = await User.findOne({ username: otherUser });
  if (otherUserDoc && otherUserDoc.socketId) {
    io.to(otherUserDoc.socketId).emit('messages_read', { by: req.user.username, chatWith: otherUser });
  }
  res.json({ ok: true });
});

// Непрочитанные счётчики
app.get('/api/unread', authenticateJWT, async (req, res) => {
  const messages = await Message.find({
    to: req.user.username,
    deleted: false,
    readBy: { $ne: req.user.username }
  });
  const counts = {};
  messages.forEach(m => {
    counts[m.from] = (counts[m.from] || 0) + 1;
  });
  res.json(counts);
});

// Реакция на сообщение
app.post('/api/messages/:id/react', authenticateJWT, async (req, res) => {
  const { emoji } = req.body;
  const message = await Message.findById(req.params.id);
  if (!message) return res.status(404).json({ error: 'Not found' });

  const existing = message.reactions.find(r => r.emoji === emoji);
  if (existing) {
    if (existing.users.includes(req.user.username)) {
      existing.users = existing.users.filter(u => u !== req.user.username);
      if (existing.users.length === 0) {
        message.reactions = message.reactions.filter(r => r.emoji !== emoji);
      }
    } else {
      existing.users.push(req.user.username);
    }
  } else {
    message.reactions.push({ emoji, users: [req.user.username] });
  }
  await message.save();

  const reactionData = { messageId: message._id, reactions: message.reactions };

  if (message.groupId) {
    io.to(`group:${message.groupId}`).emit('reaction_updated', reactionData);
  } else {
    const recipient = await User.findOne({ username: message.to });
    if (recipient && recipient.socketId) io.to(recipient.socketId).emit('reaction_updated', reactionData);
    const sender = await User.findOne({ username: message.from });
    if (sender && sender.socketId) io.to(sender.socketId).emit('reaction_updated', reactionData);
  }
  res.json(reactionData);
});

// ========== GROUPS ==========
app.post('/api/groups', authenticateJWT, async (req, res) => {
  const { name, description, type, avatar, members } = req.body;
  if (!name) return res.status(400).json({ error: 'Name required' });
  const allMembers = [...new Set([req.user.username, ...(members || [])])];
  const group = new Group({
    name: name.trim(), description: description || '',
    avatar: avatar || '👥', type: type || 'private',
    owner: req.user.username, members: allMembers,
    inviteCode: generateInviteCode()
  });
  await group.save();
  for (const member of allMembers) {
    if (member !== req.user.username) {
      const u = await User.findOne({ username: member });
      if (u && u.socketId) io.to(u.socketId).emit('group_added', { group });
    }
  }
  res.json({ group });
});

app.get('/api/groups', authenticateJWT, async (req, res) => {
  const groups = await Group.find({ members: req.user.username });
  res.json(groups);
});

app.get('/api/groups/public', authenticateJWT, async (req, res) => {
  const q = req.query.q || '';
  const groups = await Group.find({ type: 'public', name: new RegExp(q, 'i') })
    .select('_id name description avatar type members owner');
  res.json(groups);
});

app.post('/api/groups/join', authenticateJWT, async (req, res) => {
  const { inviteCode } = req.body;
  const group = await Group.findOne({ inviteCode: inviteCode?.toUpperCase() });
  if (!group) return res.status(404).json({ error: 'Group not found' });
  if (group.members.includes(req.user.username)) return res.status(400).json({ error: 'Already a member' });
  await Group.updateOne({ _id: group._id }, { $push: { members: req.user.username } });
  const updated = await Group.findById(group._id);
  for (const member of updated.members) {
    const u = await User.findOne({ username: member });
    if (u && u.socketId) io.to(u.socketId).emit('group_member_joined', { groupId: group._id, username: req.user.username });
  }
  res.json({ group: updated });
});

app.get('/api/groups/:id/invite', authenticateJWT, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group || !group.members.includes(req.user.username)) return res.status(403).json({ error: 'Forbidden' });
  res.json({ inviteCode: group.inviteCode, type: group.type });
});

app.post('/api/groups/:id/join', authenticateJWT, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  if (group.type !== 'public') return res.status(403).json({ error: 'Private group' });
  if (group.members.includes(req.user.username)) return res.status(400).json({ error: 'Already a member' });
  await Group.updateOne({ _id: group._id }, { $push: { members: req.user.username } });
  res.json({ group: await Group.findById(group._id) });
});

app.post('/api/groups/:id/leave', authenticateJWT, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  if (group.owner === req.user.username) return res.status(400).json({ error: 'Owner cannot leave' });
  await Group.updateOne({ _id: group._id }, { $pull: { members: req.user.username } });
  for (const member of group.members) {
    const u = await User.findOne({ username: member });
    if (u && u.socketId) io.to(u.socketId).emit('group_member_left', { groupId: group._id, username: req.user.username });
  }
  res.json({ message: 'Left group' });
});

app.delete('/api/groups/:id', authenticateJWT, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  if (group.owner !== req.user.username) return res.status(403).json({ error: 'Only owner can delete' });
  for (const member of group.members) {
    const u = await User.findOne({ username: member });
    if (u && u.socketId) io.to(u.socketId).emit('group_deleted', { groupId: group._id });
  }
  await Message.deleteMany({ groupId: group._id });
  await Group.deleteOne({ _id: group._id });
  res.json({ message: 'Group deleted' });
});

app.post('/api/groups/:id/invite', authenticateJWT, async (req, res) => {
  const { username } = req.body;
  const group = await Group.findById(req.params.id);
  if (!group || !group.members.includes(req.user.username)) return res.status(403).json({ error: 'Forbidden' });
  if (group.members.includes(username)) return res.status(400).json({ error: 'Already a member' });
  const target = await User.findOne({ username });
  if (!target) return res.status(404).json({ error: 'User not found' });
  await Group.updateOne({ _id: group._id }, { $push: { members: username } });
  const updated = await Group.findById(group._id);
  if (target.socketId) io.to(target.socketId).emit('group_added', { group: updated });
  for (const member of group.members) {
    const u = await User.findOne({ username: member });
    if (u && u.socketId) io.to(u.socketId).emit('group_member_joined', { groupId: group._id, username });
  }
  res.json({ message: 'Invited', group: updated });
});

app.get('/api/groups/:id/messages', authenticateJWT, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  if (group.type === 'private' && !group.members.includes(req.user.username)) return res.status(403).json({ error: 'Forbidden' });
  const messages = await Message.find({ groupId: group._id, deleted: false }).sort({ timestamp: 1 }).limit(100);
  res.json(messages);
});

// ========== ADMIN ==========
app.get('/api/admin/stats', authenticateJWT, requireAdmin, async (req, res) => {
  res.json({
    usersCount: await User.countDocuments(),
    messagesCount: await Message.countDocuments({ deleted: false }),
    groupsCount: await Group.countDocuments(),
    onlineCount: await User.countDocuments({ online: true })
  });
});
app.get('/api/admin/users', authenticateJWT, requireAdmin, async (req, res) => {
  res.json(await User.find({}, 'username avatar color online lastSeen friends friendRequests').sort({ _id: -1 }));
});
app.delete('/api/admin/users/:username', authenticateJWT, requireAdmin, async (req, res) => {
  const { username } = req.params;
  if (username === ADMIN_USERNAME) return res.status(400).json({ error: 'Cannot delete admin' });
  await User.deleteOne({ username });
  await Message.deleteMany({ $or: [{ from: username }, { to: username }] });
  await Group.updateMany({ members: username }, { $pull: { members: username } });
  await Group.deleteMany({ owner: username });
  await User.updateMany({}, { $pull: { friends: username, friendRequests: username } });
  res.json({ message: 'User deleted' });
});
app.get('/api/admin/groups', authenticateJWT, requireAdmin, async (req, res) => {
  res.json(await Group.find({}).sort({ _id: -1 }));
});
app.delete('/api/admin/groups/:id', authenticateJWT, requireAdmin, async (req, res) => {
  const group = await Group.findById(req.params.id);
  if (!group) return res.status(404).json({ error: 'Not found' });
  await Message.deleteMany({ groupId: group._id });
  await Group.deleteOne({ _id: group._id });
  res.json({ message: 'Group deleted' });
});
app.get('/api/admin/messages', authenticateJWT, requireAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = 50;
  const messages = await Message.find({}).sort({ timestamp: -1 }).skip((page-1)*limit).limit(limit);
  const total = await Message.countDocuments();
  res.json({ messages, total, pages: Math.ceil(total/limit) });
});
app.delete('/api/admin/messages/:id', authenticateJWT, requireAdmin, async (req, res) => {
  await Message.deleteOne({ _id: req.params.id });
  res.json({ message: 'Deleted' });
});
app.delete('/api/admin/messages/cleanup/deleted', authenticateJWT, requireAdmin, async (req, res) => {
  const result = await Message.deleteMany({ deleted: true });
  res.json({ message: `Удалено ${result.deletedCount} сообщений` });
});
app.delete('/api/admin/users/:username/messages', authenticateJWT, requireAdmin, async (req, res) => {
  const result = await Message.deleteMany({ from: req.params.username });
  res.json({ message: `Удалено ${result.deletedCount} сообщений` });
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
  } catch (err) { next(new Error('Invalid token')); }
});

io.on('connection', async (socket) => {
  const user = socket.user;
  await User.updateOne({ username: user.username }, { online: true, socketId: socket.id, lastSeen: new Date() });
  const userDoc = await User.findOne({ username: user.username });

  for (const friend of userDoc.friends) {
    const f = await User.findOne({ username: friend });
    if (f && f.socketId) io.to(f.socketId).emit('friend_status', { username: user.username, online: true });
  }

  const userGroups = await Group.find({ members: user.username });
  for (const g of userGroups) socket.join(`group:${g._id}`);

  const recentMessages = await Message.find({
    groupId: null,
    $or: [{ to: user.username, deleted: false }, { from: user.username, deleted: false }]
  }).sort({ timestamp: -1 }).limit(50);
  socket.emit('history', recentMessages.reverse());

  // ===== Личные сообщения =====
  socket.on('send_message', async (data) => {
    const { to, text, imageUrl, replyTo } = data;
    if (!text?.trim() && !imageUrl) return;
    const freshUser = await User.findOne({ username: user.username });
    const message = new Message({
      from: user.username, to: to || null, groupId: null,
      text: text?.trim() || '',
      imageUrl: imageUrl || null,
      replyTo: replyTo || {},
      timestamp: new Date(),
      color: freshUser.color, avatar: freshUser.avatar,
      readBy: [user.username]
    });
    await message.save();
    const msgData = {
      _id: message._id, from: user.username, to: message.to, groupId: null,
      text: message.text, imageUrl: message.imageUrl, replyTo: message.replyTo,
      reactions: [], readBy: message.readBy,
      timestamp: message.timestamp, color: freshUser.color, avatar: freshUser.avatar,
      edited: false, deleted: false
    };
    const recipient = await User.findOne({ username: to });
    if (recipient && recipient.socketId) io.to(recipient.socketId).emit('private_message', msgData);
    socket.emit('private_message', msgData);
  });

  // ===== Групповые сообщения =====
  socket.on('send_group_message', async (data) => {
    const { groupId, text, imageUrl, replyTo } = data;
    if (!text?.trim() && !imageUrl) return;
    const group = await Group.findById(groupId);
    if (!group || !group.members.includes(user.username)) return;
    const freshUser = await User.findOne({ username: user.username });
    const message = new Message({
      from: user.username, to: null, groupId: group._id,
      text: text?.trim() || '', imageUrl: imageUrl || null,
      replyTo: replyTo || {},
      timestamp: new Date(), color: freshUser.color, avatar: freshUser.avatar,
      readBy: [user.username]
    });
    await message.save();
    const msgData = {
      _id: message._id, from: user.username, groupId: group._id,
      text: message.text, imageUrl: message.imageUrl, replyTo: message.replyTo,
      reactions: [], readBy: message.readBy,
      timestamp: message.timestamp, color: freshUser.color, avatar: freshUser.avatar,
      edited: false, deleted: false
    };
    io.to(`group:${group._id}`).emit('group_message', msgData);
  });

  // ===== Редактирование =====
  socket.on('edit_message', async (data) => {
    const { messageId, newText } = data;
    if (!newText?.trim()) return;
    const message = await Message.findById(messageId);
    if (!message || message.from !== user.username) return;
    message.text = newText.trim();
    message.edited = true;
    await message.save();
    const payload = { messageId, newText: message.text };
    if (message.groupId) {
      io.to(`group:${message.groupId}`).emit('message_edited', payload);
    } else {
      const recipient = await User.findOne({ username: message.to });
      if (recipient && recipient.socketId) io.to(recipient.socketId).emit('message_edited', payload);
      socket.emit('message_edited', payload);
    }
  });

  // ===== Удаление =====
  socket.on('delete_message', async (data) => {
    const message = await Message.findById(data.messageId);
    if (!message || message.from !== user.username) return;
    const payload = { messageId: String(data.messageId), hardDelete: true };
    if (message.groupId) {
      await Message.deleteOne({ _id: data.messageId });
      io.to(`group:${message.groupId}`).emit('message_deleted', payload);
    } else {
      const recipient = await User.findOne({ username: message.to });
      await Message.deleteOne({ _id: data.messageId });
      if (recipient && recipient.socketId) io.to(recipient.socketId).emit('message_deleted', payload);
      socket.emit('message_deleted', payload);
    }
  });

  // ===== Typing =====
  socket.on('typing', async (data) => {
    const { to, groupId } = data;
    if (groupId) {
      socket.to(`group:${groupId}`).emit('typing', { from: user.username, groupId });
    } else if (to) {
      const u = await User.findOne({ username: to });
      if (u && u.socketId) io.to(u.socketId).emit('typing', { from: user.username });
    }
  });

  socket.on('join_group_room', (groupId) => socket.join(`group:${groupId}`));

  // ===== WebRTC Звонки =====
  socket.on('call_user', async (data) => {
    const callee = await User.findOne({ username: data.to });
    if (callee && callee.socketId) {
      io.to(callee.socketId).emit('incoming_call', {
        from: user.username,
        avatar: socket.user.avatar,
        offer: data.offer
      });
    }
  });

  socket.on('call_answer', async (data) => {
    const caller = await User.findOne({ username: data.to });
    if (caller && caller.socketId) {
      io.to(caller.socketId).emit('call_answered', { answer: data.answer });
    }
  });

  socket.on('call_ice', async (data) => {
    const peer = await User.findOne({ username: data.to });
    if (peer && peer.socketId) {
      io.to(peer.socketId).emit('call_ice', { candidate: data.candidate });
    }
  });

  socket.on('call_reject', async (data) => {
    const caller = await User.findOne({ username: data.to });
    if (caller && caller.socketId) {
      io.to(caller.socketId).emit('call_rejected', { by: user.username });
    }
  });

  socket.on('call_end', async (data) => {
    const peer = await User.findOne({ username: data.to });
    if (peer && peer.socketId) {
      io.to(peer.socketId).emit('call_ended', { by: user.username });
    }
  });

  socket.on('disconnect', async () => {
    await User.updateOne({ username: user.username }, { online: false, socketId: null, lastSeen: new Date() });
    for (const friend of userDoc.friends) {
      const f = await User.findOne({ username: friend });
      if (f && f.socketId) io.to(f.socketId).emit('friend_status', { username: user.username, online: false, lastSeen: new Date() });
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
