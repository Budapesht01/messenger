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
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Проверка переменных окружения
if (!process.env.MONGODB_URI || !process.env.JWT_SECRET) {
  console.error('❌ Missing required environment variables');
  process.exit(1);
}

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log('✅ MongoDB connected');
}).catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

// Модели
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '😀' },
  color: { type: String, default: '#2c3e50' },
  online: { type: Boolean, default: false },
  socketId: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now },
  friends: [{ type: String }],           // Массив username друзей
  friendRequests: [{ type: String }]      // Массив username, отправивших запрос
});

const MessageSchema = new mongoose.Schema({
  from: { type: String, required: true },
  to: { type: String, default: 'all' },
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// Middleware JWT
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

// Регистрация
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

// Логин
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { username: user.username, avatar: user.avatar, color: user.color } });
});

// Список всех пользователей (без деталей)
app.get('/api/users', authenticateJWT, async (req, res) => {
  const users = await User.find({}, 'username avatar color online lastSeen');
  res.json(users);
});

// Поиск пользователей по нику (частичное совпадение)
app.get('/api/users/search', authenticateJWT, async (req, res) => {
  const q = req.query.q || '';
  const regex = new RegExp(q, 'i');
  const users = await User.find({ username: regex }, 'username avatar color online lastSeen');
  const filtered = users.filter(u => u.username !== req.user.username);
  res.json(filtered);
});

// Список друзей текущего пользователя
app.get('/api/friends', authenticateJWT, async (req, res) => {
  const user = await User.findOne({ username: req.user.username });
  const friends = await User.find({ username: { $in: user.friends } }, 'username avatar color online lastSeen');
  res.json(friends);
});

// Отправить запрос в друзья
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

// Принять запрос в друзья
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

// Отклонить запрос
app.post('/api/friend-request/reject', authenticateJWT, async (req, res) => {
  const { from } = req.body;
  if (!from) return res.status(400).json({ error: 'Username required' });
  await User.updateOne({ username: req.user.username }, { $pull: { friendRequests: from } });
  res.json({ message: 'Request rejected' });
});

// Поиск сообщений
app.get('/api/search', authenticateJWT, async (req, res) => {
  const q = req.query.q;
  if (!q) return res.json([]);
  const messages = await Message.find({
    $or: [
      { from: req.user.username, text: { $regex: q, $options: 'i' } },
      { to: req.user.username, text: { $regex: q, $options: 'i' } },
      { to: 'all', text: { $regex: q, $options: 'i' } }
    ]
  }).sort({ timestamp: -1 }).limit(50);
  res.json(messages);
});

// История сообщений с конкретным пользователем
app.get('/api/messages', authenticateJWT, async (req, res) => {
  const { with: otherUser } = req.query;
  if (!otherUser) return res.json([]);
  const messages = await Message.find({
    $or: [
      { from: req.user.username, to: otherUser },
      { from: otherUser, to: req.user.username },
      { from: req.user.username, to: 'all' },
      { from: otherUser, to: 'all' }
    ]
  }).sort({ timestamp: 1 }).limit(100);
  res.json(messages);
});

// Socket.IO аутентификация
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

  const updateUserList = async () => {
    const users = await User.find({}, 'username avatar color online lastSeen');
    io.emit('user_list', users);
  };
  await updateUserList();

  const recentMessages = await Message.find({
    $or: [
      { to: 'all' },
      { to: user.username },
      { from: user.username }
    ]
  }).sort({ timestamp: -1 }).limit(50);
  socket.emit('history', recentMessages.reverse());

  socket.on('send_message', async (data) => {
    const { to, text } = data;
    if (!text.trim()) return;
    const message = new Message({
      from: user.username,
      to: to || 'all',
      text: text.trim(),
      timestamp: new Date()
    });
    await message.save();

    if (to && to !== 'all') {
      const recipient = await User.findOne({ username: to });
      if (recipient && recipient.socketId) {
        io.to(recipient.socketId).emit('private_message', message);
      }
      socket.emit('private_message', message);
    } else {
      io.emit('public_message', message);
    }
  });

  socket.on('typing', (data) => {
    const { to } = data;
    if (to && to !== 'all') {
      const recipient = io.sockets.sockets.get(to);
      if (recipient) recipient.emit('typing', { from: user.username });
    } else {
      socket.broadcast.emit('typing', { from: user.username });
    }
  });

  socket.on('disconnect', async () => {
    await User.updateOne({ username: user.username }, { online: false, socketId: null, lastSeen: new Date() });
    await updateUserList();
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
