const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_FILE = path.join(__dirname, 'data.json');
const ONLINE_WINDOW = 2 * 60 * 1000;

app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function loadDb() {
  if (!fs.existsSync(DATA_FILE)) {
    return { users: [], friends: [], messages: [], notifications: [] };
  }
  try {
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  } catch {
    return { users: [], friends: [], messages: [], notifications: [] };
  }
}

function saveDb(db) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(db, null, 2));
}

function hashPass(p) {
  return crypto.createHash('sha256').update(p || '').digest('hex');
}

function isOnline(u) {
  return u.lastSeen && Date.now() - u.lastSeen < ONLINE_WINDOW;
}

function findUserByToken(token, db) {
  return db.users.find(u => u.token && u.token === token);
}

function touch(user, db) {
  user.lastSeen = Date.now();
  saveDb(db);
}

function publicUser(u, viewer, db) {
  return {
    id: u.id,
    name: u.name,
    age: u.age,
    hobby: u.hobby,
    bio: u.bio,
    color: u.color,
    photo: u.photo || null,
    online: isOnline(u),
    lastSeen: u.lastSeen || 0,
    isFriend: viewer ? !!db.friends.find(f => f.userId === viewer.id && f.friendId === u.id) : false,
    isLiked: viewer ? !!(u.liked || []).includes(viewer.id) : false,
    likedMe: viewer ? !!((viewer.liked || []).includes(u.id)) : false
  };
}

function sanitize(input) {
  return String(input || '').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 500);
}

/* ---------------- AUTH ---------------- */

app.post('/api/register', (req, res) => {
  const { name, email, password, age, hobby, bio } = req.body;
  if (!name || !email || !password || !age) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }
  const db = loadDb();
  if (db.users.find(u => u.email.toLowerCase() === email.toLowerCase())) {
    return res.status(400).json({ error: 'Ese correo ya está registrado' });
  }
  const colors = ['#667eea', '#764ba2', '#e05780', '#2ecc71', '#f39c12', '#3498db', '#e74c3c', '#1abc9c', '#ff5f9e', '#00b894'];
  const user = {
    id: crypto.randomBytes(8).toString('hex'),
    name: sanitize(name).trim(),
    email: email.toLowerCase().trim(),
    password: hashPass(password),
    age: Math.max(13, Math.min(120, Number(age))),
    hobby: sanitize(hobby).trim(),
    bio: sanitize(bio).trim(),
    color: colors[Math.floor(Math.random() * colors.length)],
    photo: null,
    liked: [],
    token: crypto.randomBytes(16).toString('hex'),
    lastSeen: Date.now(),
    createdAt: Date.now()
  };
  db.users.push(user);
  saveDb(db);
  res.json({ token: user.token, user: publicUser(user, user, db) });
});

app.post('/api/login', (req, res) => {
  const { email, password } = req.body;
  const db = loadDb();
  const user = db.users.find(u => u.email === (email || '').toLowerCase().trim());
  if (!user || user.password !== hashPass(password)) {
    return res.status(401).json({ error: 'Correo o contraseña incorrectos' });
  }
  user.token = crypto.randomBytes(16).toString('hex');
  saveDb(db);
  res.json({ token: user.token, user: publicUser(user, user, db) });
});

function authed(req, res, db) {
  const user = findUserByToken(req.headers.authorization, db);
  if (!user) {
    res.status(401).json({ error: 'No autorizado' });
    return null;
  }
  touch(user, db);
  return user;
}

/* ---------------- PERFIL ---------------- */

app.get('/api/me', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  res.json(publicUser(me, me, db));
});

app.put('/api/me', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  const { name, age, hobby, bio, photo } = req.body;
  if (name && name.trim()) me.name = sanitize(name).slice(0, 40).trim();
  if (age) me.age = Math.max(13, Math.min(120, Number(age)));
  me.hobby = sanitize(hobby).slice(0, 80).trim();
  me.bio = sanitize(bio).slice(0, 400).trim();
  if (typeof photo === 'string' && (photo === '' || photo.startsWith('data:image'))) {
    me.photo = photo.length > 400000 ? me.photo : photo;
  }
  saveDb(db);
  res.json(publicUser(me, me, db));
});

/* ---------------- USUARIOS / DESCUBRIR ---------------- */

app.get('/api/users', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  const q = (req.query.q || '').toLowerCase().trim();
  let others = db.users.filter(u => u.id !== me.id);
  if (q) {
    others = others.filter(u =>
      u.name.toLowerCase().includes(q) || (u.hobby || '').toLowerCase().includes(q)
    );
  }
  res.json(others.map(u => publicUser(u, me, db)));
});

/* ---------------- AMIGOS ---------------- */

app.post('/api/friends', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  const friendId = req.body.friendId;
  const target = db.users.find(u => u.id === friendId);
  if (!target) return res.status(400).json({ error: 'Esa persona no existe' });
  if (!db.friends.find(f => f.userId === me.id && f.friendId === friendId)) {
    db.friends.push({ userId: me.id, friendId });
    db.friends.push({ userId: friendId, friendId: me.id });
  }
  saveDb(db);
  res.json({ ok: true });
});

app.delete('/api/friends/:friendId', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  db.friends = db.friends.filter(f => !(f.userId === me.id && f.friendId === req.params.friendId) &&
    !(f.userId === req.params.friendId && f.friendId === me.id));
  saveDb(db);
  res.json({ ok: true });
});

/* ---------------- LIKES / MATCH ---------------- */

app.post('/api/likes', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  const targetId = req.body.userId;
  const target = db.users.find(u => u.id === targetId);
  if (!target) return res.status(400).json({ error: 'Esa persona no existe' });
  if (targetId === me.id) return res.status(400).json({ error: 'No puedes gustarte a ti mismo' });

  if (!(me.liked || []).includes(targetId)) me.liked.push(targetId);
  const mutual = (target.liked || []).includes(me.id);
  let matched = false;

  if (mutual && !db.friends.find(f => f.userId === me.id && f.friendId === targetId)) {
    db.friends.push({ userId: me.id, friendId: targetId });
    db.friends.push({ userId: targetId, friendId: me.id });
    matched = true;
    const ts = Date.now();
    db.notifications.push({ id: crypto.randomBytes(6).toString('hex'), userId: me.id, fromId: targetId, type: 'match', text: `¡Tienes un match con ${target.name}! 💘`, ts, seen: false });
    db.notifications.push({ id: crypto.randomBytes(6).toString('hex'), userId: targetId, fromId: me.id, type: 'match', text: `¡Tienes un match con ${me.name}! 💘`, ts, seen: false });
    db.messages.push({ id: crypto.randomBytes(8).toString('hex'), from: targetId, to: me.id, text: `💘 ¡Es un match! Tú y ${target.name} se dieron like mutuamente.`, ts, system: true });
    db.messages.push({ id: crypto.randomBytes(8).toString('hex'), from: me.id, to: targetId, text: `💘 ¡Es un match! Tú y ${me.name} se dieron like mutuamente.`, ts, system: true });
  } else {
    db.notifications.push({ id: crypto.randomBytes(6).toString('hex'), userId: targetId, fromId: me.id, type: 'like', text: `${me.name} te dio me gusta ❤️`, ts: Date.now(), seen: false });
  }

  saveDb(db);
  res.json({ ok: true, match: matched });
});

app.delete('/api/likes/:userId', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  me.liked = (me.liked || []).filter(id => id !== req.params.userId);
  saveDb(db);
  res.json({ ok: true });
});

/* ---------------- MENSAJES ---------------- */

app.get('/api/messages/:friendId', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  const friendId = req.params.friendId;
  const msgs = db.messages.filter(m =>
    (m.from === me.id && m.to === friendId) || (m.from === friendId && m.to === me.id)
  );
  res.json(msgs);
});

app.post('/api/messages', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  const { to, text } = req.body;
  if (!to || !text || !text.trim()) {
    return res.status(400).json({ error: 'Mensaje vacío' });
  }
  const msg = { id: crypto.randomBytes(8).toString('hex'), from: me.id, to, text: sanitize(text).slice(0, 800), ts: Date.now(), system: false };
  db.messages.push(msg);
  saveDb(db);
  res.json(msg);
});

/* ---------------- NOTIFICACIONES ---------------- */

app.get('/api/notifications', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  const items = db.notifications.filter(n => n.userId === me.id)
    .map(n => {
      const from = db.users.find(u => u.id === n.fromId);
      return { ...n, fromName: from ? from.name : '', fromPhoto: from ? (from.photo || null) : null, fromColor: from ? from.color : '#667eea' };
    })
    .sort((a, b) => b.ts - a.ts);
  const unseen = items.filter(n => !n.seen).length;
  res.json({ items, unseen });
});

app.post('/api/notifications/seen', (req, res) => {
  const db = loadDb();
  const me = authed(req, res, db);
  if (!me) return;
  db.notifications.forEach(n => { if (n.userId === me.id) n.seen = true; });
  saveDb(db);
  res.json({ ok: true });
});

app.listen(PORT, () => {
  console.log(`Amigos red social corriendo en http://localhost:${PORT}`);
});
