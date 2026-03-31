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
    origin: "*", // для простоты, в продакшне лучше ограничить
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Подключение к MongoDB
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => console.log('MongoDB connected'))
  .catch(err => console.log('MongoDB error:', err));

// Модели
const UserSchema = new mongoose.Schema({
  username: { type: String, unique: true, required: true },
  password: { type: String, required: true },
  avatar: { type: String, default: '😀' }, // эмодзи-аватар
  color: { type: String, default: '#2c3e50' }, // цвет ника
  online: { type: Boolean, default: false },
  socketId: { type: String, default: null },
  lastSeen: { type: Date, default: Date.now }
});

const MessageSchema = new mongoose.Schema({
  from: { type: String, required: true }, // username отправителя
  to: { type: String, default: 'all' }, // 'all' или username получателя
  text: { type: String, required: true },
  timestamp: { type: Date, default: Date.now }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// Middleware для проверки JWT
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

// API: регистрация
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

// API: логин
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  const user = await User.findOne({ username });
  if (!user) return res.status(400).json({ error: 'Invalid credentials' });
  const valid = await bcrypt.compare(password, user.password);
  if (!valid) return res.status(400).json({ error: 'Invalid credentials' });
  const token = jwt.sign({ username: user.username }, process.env.JWT_SECRET, { expiresIn: '7d' });
  res.json({ token, user: { username: user.username, avatar: user.avatar, color: user.color } });
});

// API: поиск пользователей (для отправки личных сообщений)
app.get('/api/users', authenticateJWT, async (req, res) => {
  const users = await User.find({}, 'username avatar color online lastSeen');
  res.json(users);
});

// API: поиск сообщений (по тексту)
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

// Socket.IO с аутентификацией
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
  // Обновляем статус пользователя
  await User.updateOne({ username: user.username }, { online: true, socketId: socket.id, lastSeen: new Date() });
  
  // Уведомляем всех об обновлении списка пользователей
  const updateUserList = async () => {
    const users = await User.find({}, 'username avatar color online lastSeen');
    io.emit('user_list', users);
  };
  await updateUserList();

  // Отправляем последние 50 сообщений общего чата и личные сообщения для этого пользователя
  const recentMessages = await Message.find({
    $or: [
      { to: 'all' },
      { to: user.username },
      { from: user.username }
    ]
  }).sort({ timestamp: -1 }).limit(50);
  socket.emit('history', recentMessages.reverse());

  // Обработка входящих сообщений
  socket.on('send_message', async (data) => {
    const { to, text } = data; // to может быть 'all' или username
    if (!text.trim()) return;
    const message = new Message({
      from: user.username,
      to: to || 'all',
      text: text.trim(),
      timestamp: new Date()
    });
    await message.save();

    // Отправляем получателю (если личное) или всем в общий чат
    if (to && to !== 'all') {
      // Личное сообщение: отправляем отправителю и получателю, если он онлайн
      const recipient = await User.findOne({ username: to });
      if (recipient && recipient.socketId) {
        io.to(recipient.socketId).emit('private_message', message);
      }
      // Отправителю тоже показываем
      socket.emit('private_message', message);
    } else {
      // Общий чат: всем
      io.emit('public_message', message);
    }
  });

  // Индикатор печатает
  socket.on('typing', (data) => {
    const { to } = data;
    if (to && to !== 'all') {
      const recipient = socket.rooms.get(to); // упрощённо, но можно найти по сокету
      // Проще: отправим событие только получателю
      io.to(to).emit('typing', { from: user.username });
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
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));