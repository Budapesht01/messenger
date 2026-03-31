require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');

const app = express();
app.use(express.json());

console.log('MONGODB_URI is', process.env.MONGODB_URI ? 'SET' : 'NOT SET');
console.log('JWT_SECRET is', process.env.JWT_SECRET ? 'SET' : 'NOT SET');

mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log('✅ MongoDB connected successfully');
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
})
.catch(err => {
  console.error('❌ MongoDB connection error:', err);
  process.exit(1);
});

app.get('/', (req, res) => res.send('Server is running and DB check done'));
