const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

function loadDb() {
  if (!fs.existsSync(DATA_FILE)) {
    return { users: [], friends: [], messages: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { users: [], friends: [], messages: [] };
  }
}

function saveDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function publicUser(u) {
  return { id: u.id, name: u.name, age: u.age, hobby: u.hobby, bio: u.bio, color: u.color, online: !!u.token };
}

function findUserByToken(token, db) {
  return db.users.find(u => u.token && u.token === token);
}

app.post('/api/register', (req, res) => {
  const { name, email, password, age, hobby, bio } = req.body;
  if (!name || !email || !password || !age) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }
  const db = loadDb();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Ese correo ya está registrado' });
  }
  const colors = ['#667eea', '#764ba2', '#e05780', '#2ecc71', '#f39c12', '#3498db', '#e74c3c', '#1abc9c'];
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    name: name.trim(),
    email: email.toLowerCase().trim(),
    password: crypto.createHash('sha256').update(password).digest('hex'),
    age: Number(age),
    hobby: (hobby || '').trim(),
    bio: (bio || '').trim(),
    color: colors[Math.floor(Math.random() * colors.length)],
    token: crypto.randomBytes(16).toString('hex')
  };
  db.users.push(user);
  saveDb(db);
  res.json({ token: user.token, user: publicUser(user) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = loadDb();
  const user = db.users.find(u => u.email === (email || '').toLowerCase().trim());
  const hash = crypto.createHash('sha256').update(password || '').digest('hex');
  if (!user || user.password !== hash) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  user.token = crypto.randomBytes(16).toString('hex');
  saveDb(db);
  res.json({ token: user.token, user: publicUser(user) });
});

app.get('/api/me', (req, res) => {
  const db = loadDb();
  const user = findUserByToken(req.headers.authorization, db);
  if (!user) return res.status(401).json({ error: 'No autorizado' });
  res.json(publicUser(user));
});

app.get('/api/users', (req, res) => {
  const db = loadDb();
  const me = findUserByToken(req.headers.authorization, db);
  if (!me) return res.status(401).json({ error: 'No autorizado' });
  const friendIds = new Set(db.friends.filter(f => f.userId === me.id).map(f => f.friendId));
  const others = db.users.filter(u => u.id !== me.id).map(u => ({
    ...publicUser(u),
    isFriend: friendIds.has(u.id)
  }));
  res.json(others);
});

app.post('/api/friends', (req, res) => {
  const db = loadDb();
  const me = findUserByToken(req.headers.authorization, db);
  if (!me) return res.status(401).json({ error: 'No autorizado' });
  const friendId = req.body.friendId;
  if (!db.users.find(u => u.id === friendId)) {
    return res.status(400).json({ error: 'Esa persona no existe' });
  }
  if (!db.friends.find(f => f.userId === me.id && f.friendId === friendId)) {
    db.friends.push({ userId: me.id, friendId });
  }
  saveDb(db);
  res.json({ ok: true });
});

app.delete('/api/friends/:friendId', (req, res) => {
  const db = loadDb();
  const me = findUserByToken(req.headers.authorization, db);
  if (!me) return res.status(401).json({ error: 'No autorizado' });
  db.friends = db.friends.filter(f => !(f.userId === me.id && f.friendId === req.params.friendId));
  saveDb(db);
  res.json({ ok: true });
});

app.get('/api/messages/:friendId', (req, res) => {
  const db = loadDb();
  const me = findUserByToken(req.headers.authorization, db);
  if (!me) return res.status(401).json({ error: 'No autorizado' });
  const friendId = req.params.friendId;
  const msgs = db.messages.filter(m =>
    (m.from === me.id && m.to === friendId) || (m.from === friendId && m.to === me.id)
  );
  res.json(msgs);
});

app.post('/api/messages', (req, res) => {
  const db = loadDb();
  const me = findUserByToken(req.headers.authorization, db);
  if (!me) return res.status(401).json({ error: 'No autorizado' });
  const { to, text } = req.body;
  if (!to || !text || !text.trim()) {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }
  const msg = { id: crypto.randomBytes(8).toString('hex'), from: me.id, to, text: text.trim().slice(0, 500), ts: Date.now() };
  db.messages.push(msg);
  saveDb(db);
  res.json(msg);
});

app.get('/api/online', (req, res) => {
  const db = loadDb();
  const me = findUserByToken(req.headers.authorization, db);
  if (!me) return res.status(401).json({ error: 'No autorizado' });
  const friendIds = new Set(db.friends.filter(f => f.userId === me.id).map(f => f.friendId));
  const online = db.users.filter(u => friendIds.has(u.id) && u.token).map(publicUser);
  res.json(online);
});

app.listen(PORT, () => {
  console.log(`Red social corriendo en http://localhost:${PORT}`);
});
