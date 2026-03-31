const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Раздаём статические файлы из папки public
app.use(express.static('public'));

// Хранилище сообщений (в памяти, при перезапуске сервера история очистится)
let messages = [];

io.on('connection', (socket) => {
    console.log('Пользователь подключился:', socket.id);

    // Отправляем новому пользователю последние 50 сообщений
    socket.emit('history', messages.slice(-50));

    socket.on('send_message', (data) => {
        const message = {
            id: Date.now(),
            username: data.username || 'Аноним',
            text: data.text,
            time: new Date().toLocaleTimeString()
        };
        messages.push(message);
        // Рассылаем сообщение всем клиентам
        io.emit('receive_message', message);
    });

    socket.on('disconnect', () => {
        console.log('Пользователь отключился:', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Сервер запущен на порту ${PORT}`);
});