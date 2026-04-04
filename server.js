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
  cors: {
    origin: "*", // Для продакшена замени на свой домен
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error('Missing MONGODB_URI or JWT_SECRET');
  process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
  .then(() => console.log('✅ MongoDB connected'))
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
  to: { type: String, required: true },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  edited: { type: Boolean, default: false }
  // color, avatar и deleted удалены!
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// ========== Хелпер для подтягивания актуальных аватаров/цветов ==========
async function populateMessages(messages) {
  if (!messages || messages.length === 0) return [];
  // Собираем всех уникальных отправителей
  const usernames = [...new Set(messages.map(m => m.from))];
  const users = await User.find({ username: { $in: usernames } }, 'username avatar color').lean();
  
  const userMap = {};
  users.forEach(u => userMap[u.username] = u);
  
  return messages.map(m => ({
    ...m,
    avatar: userMap[m.from]?.avatar || '😀',
    color: userMap[m.from]?.color || '#6ab0f3'
  }));
}

// ========== Middleware JWT ==========
const authenticateJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (authHeader) {
    const token = authHeader.split(' ')[1];
    jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
      if (err) return res.sendStatus(403);
      req.user = user;
      next();
    });
  } else {
    res.sendStatus(401);
  }
};

// ========== API ==========
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
  if (target.socketId) {
    io.to(target.socketId).emit('friend_request', { from: req.user.username });
  }
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
  if (fromUser.socketId) {
    io.to(fromUser.socketId).emit('friend_accepted', { by: req.user.username });
  }
  res.json({ message: 'Friend added' });
});

app.post('/api/friend-request/reject', authenticateJWT, async (req, res) => {
  const { from } = req.body;
  if (!from) return res.status(400).json({ error: 'Username required' });
  await User.updateOne({ username: req.user.username }, { $pull: { friendRequests: from } });
  res.json({ message: 'Request rejected' });
});

app.post('/api/friends/remove', authenticateJWT, async (req, res) => {
  const { friend } = req.body;
  if (!friend) return res.status(400).json({ error: 'Friend username required' });
  await User.updateOne({ username: req.user.username }, { $pull: { friends: friend } });
  await User.updateOne({ username: friend }, { $pull: { friends: req.user.username } });
  res.json({ message: 'Friend removed' });
});

app.get('/api/search', authenticateJWT, async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);
  const messages = await Message.find({
    $or: [
      { from: req.user.username, text: { $regex: q, $options: 'i' } },
      { to: req.user.username, text: { $regex: q, $options: 'i' } }
    ]
  }).sort({ timestamp: -1 }).limit(50).lean();
  
  const populated = await populateMessages(messages);
  res.json(populated);
});

app.get('/api/messages', authenticateJWT, async (req, res) => {
  const { with: otherUser } = req.query;
  if (!otherUser) return res.json([]);
  const messages = await Message.find({
    $or: [
      { from: req.user.username, to: otherUser },
      { from: otherUser, to: req.user.username }
    ]
  }).sort({ timestamp: 1 }).limit(100).lean();
  
  const populated = await populateMessages(messages);
  res.json(populated);
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
  for (const friend of userDoc.friends) {
    const friendUser = await User.findOne({ username: friend });
    if (friendUser && friendUser.socketId) {
      io.to(friendUser.socketId).emit('friend_status', { username: user.username, online: true });
    }
  }

  // Общий чат удален, история при коннекте больше не отправляется

  socket.on('send_message', async (data) => {
    const { to, text } = data;
    if (!text.trim() || !to) return;

    // Сохраняем сообщение без жесткой привязки к цвету
    const message = new Message({
      from: user.username,
      to: to,
      text: text.trim(),
      timestamp: new Date()
    });
    await message.save();

    // Достаем свежие данные отправителя
    const freshSender = await User.findOne({ username: user.username });

    const messageData = {
      _id: message._id,
      from: user.username,
      to: message.to,
      text: message.text,
      timestamp: message.timestamp,
      color: freshSender.color,
      avatar: freshSender.avatar,
      edited: false
    };

    const recipient = await User.findOne({ username: to });
    if (recipient && recipient.socketId) {
      io.to(recipient.socketId).emit('private_message', messageData);
    }
    socket.emit('private_message', messageData);
  });

  socket.on('edit_message', async (data) => {
    const { messageId, newText } = data;
    if (!messageId || !newText.trim()) return;
    const message = await Message.findById(messageId);
    if (!message || message.from !== user.username) return;
    message.text = newText.trim();
    message.edited = true;
    await message.save();

    const recipient = await User.findOne({ username: message.to });
    if (recipient && recipient.socketId) {
      io.to(recipient.socketId).emit('message_edited', { messageId, newText: message.text });
    }
    socket.emit('message_edited', { messageId, newText: message.text });
  });

  socket.on('delete_message', async (data) => {
    const { messageId } = data;
    const message = await Message.findById(messageId);
    if (!message || message.from !== user.username) return;
    
    // Физическое удаление из базы данных
    await Message.findByIdAndDelete(messageId);

    const recipient = await User.findOne({ username: message.to });
    if (recipient && recipient.socketId) {
      io.to(recipient.socketId).emit('message_deleted', { messageId });
    }
    socket.emit('message_deleted', { messageId });
  });

  socket.on('typing', (data) => {
    const { to } = data;
    if (!to) return;
    const recipient = io.sockets.sockets.get(to);
    // Для этого нам нужен socketId получателя
    User.findOne({ username: to }).then(recipientUser => {
      if (recipientUser && recipientUser.socketId) {
        io.to(recipientUser.socketId).emit('typing', { from: user.username });
      }
    });
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
