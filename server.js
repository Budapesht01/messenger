const express = require('express');
const app = express();

console.log('MONGODB_URI is', process.env.MONGODB_URI ? 'SET' : 'NOT SET');
console.log('JWT_SECRET is', process.env.JWT_SECRET ? 'SET' : 'NOT SET');

app.get('/', (req, res) => res.send('Server is running'));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
