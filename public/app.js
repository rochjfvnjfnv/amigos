let token = localStorage.getItem('token');
let me = null;
let currentChat = null;
let pollTimer = null;

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}), ...(opts.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de conexión');
  return data;
}

function showRegister() {
  document.getElementById('loginForm').style.display = 'none';
  document.getElementById('registerForm').style.display = 'block';
  document.getElementById('authError').textContent = '';
}
function showLogin() {
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'block';
  document.getElementById('authError').textContent = '';
}

async function register() {
  const name = document.getElementById('rgName').value;
  const email = document.getElementById('rgEmail').value;
  const password = document.getElementById('rgPass').value;
  const age = document.getElementById('rgAge').value;
  const hobby = document.getElementById('rgHobby').value;
  const bio = document.getElementById('rgBio').value;
  const err = document.getElementById('authError');
  try {
    const data = await api('/api/register', {
      method: 'POST', body: JSON.stringify({ name, email, password, age, hobby, bio })
    });
    token = data.token;
    me = data.user;
    localStorage.setItem('token', token);
    enterApp();
  } catch (e) { err.textContent = e.message; }
}

async function login() {
  const email = document.getElementById('liEmail').value;
  const password = document.getElementById('liPass').value;
  const err = document.getElementById('authError');
  try {
    const data = await api('/api/login', {
      method: 'POST', body: JSON.stringify({ email, password })
    });
    token = data.token;
    me = data.user;
    localStorage.setItem('token', token);
    enterApp();
  } catch (e) { err.textContent = e.message; }
}

function logout() {
  localStorage.removeItem('token');
  location.reload();
}

function avatarEl(user, size) {
  const a = document.createElement('span');
  a.className = 'avatar';
  a.style.background = user.color;
  a.textContent = user.name.charAt(0).toUpperCase();
  return a;
}

function enterApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  const meAvatar = document.getElementById('meAvatar');
  meAvatar.style.background = me.color;
  meAvatar.textContent = me.name.charAt(0).toUpperCase();
  document.getElementById('meName').textContent = me.name;
  loadPeople();
  loadFriends();
  loadChatList();
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', switchTab));
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (currentChat) loadMessages(currentChat); }, 3000);
}

function switchTab(e) {
  const tab = e.target.dataset.tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => (v.style.display = v.id === tab ? 'block' : 'none'));
  if (tab === 'discover') loadPeople();
  if (tab === 'friends') loadFriends();
  if (tab === 'chat') loadChatList();
}

async function loadPeople() {
  try {
    const users = await api('/api/users');
    const list = document.getElementById('peopleList');
    if (!users.length) {
      list.innerHTML = '<p class="empty-state">Todavía no hay más personas. ¡Comparte el enlace con alguien!</p>';
      return;
    }
    list.innerHTML = '';
    users.forEach(u => {
      const el = document.createElement('div');
      el.className = 'person';
      el.innerHTML = `
        <div class="top">
          <span class="avatar" style="background:${u.color}">${u.name.charAt(0).toUpperCase()}</span>
          <div>
            <div class="name">${u.name} ${u.online ? '<span class="dot" title="En línea"></span>' : ''}</div>
            <div class="age">${u.age} años</div>
          </div>
        </div>
        ${u.hobby ? `<span class="hobby">${u.hobby}</span>` : ''}
        ${u.bio ? `<div class="bio">${u.bio}</div>` : ''}
      `;
      const btn = document.createElement('button');
      btn.className = 'btn-sm ' + (u.isFriend ? 'btn-ghost' : '');
      btn.textContent = u.isFriend ? 'Agregado' : '+ Agregar amigo';
      if (u.isFriend) {
        btn.onclick = async () => {
          await api('/api/friends/' + u.id, { method: 'DELETE' });
          loadPeople();
        };
      } else {
        btn.onclick = async () => {
          await api('/api/friends', { method: 'POST', body: JSON.stringify({ friendId: u.id }) });
          loadPeople();
          loadFriends();
        };
      }
      el.appendChild(btn);
      list.appendChild(el);
    });
  } catch (e) { console.error(e); }
}

async function loadFriends() {
  try {
    const users = await api('/api/users');
    const friends = users.filter(u => u.isFriend);
    const list = document.getElementById('friendsList');
    if (!friends.length) {
      list.innerHTML = '<p class="empty-state">Aún no tienes amigos. Ve a "Descubrir" y agrega a alguien.</p>';
      return;
    }
    list.innerHTML = '';
    friends.forEach(u => {
      const el = document.createElement('div');
      el.className = 'person';
      el.innerHTML = `
        <div class="top">
          <span class="avatar" style="background:${u.color}">${u.name.charAt(0).toUpperCase()}</span>
          <div>
            <div class="name">${u.name} ${u.online ? '<span class="dot" title="En línea"></span>' : ''}</div>
            <div class="age">${u.age} años</div>
          </div>
        </div>
        ${u.hobby ? `<span class="hobby">${u.hobby}</span>` : ''}
      `;
      const btn = document.createElement('button');
      btn.className = 'btn-sm btn-ghost';
      btn.textContent = 'Eliminar';
      btn.onclick = async () => {
        await api('/api/friends/' + u.id, { method: 'DELETE' });
        loadFriends();
        loadPeople();
        loadChatList();
      };
      el.appendChild(btn);
      list.appendChild(el);
    });
  } catch (e) { console.error(e); }
}

async function loadChatList() {
  try {
    const users = await api('/api/users');
    const friends = users.filter(u => u.isFriend);
    const list = document.getElementById('chatFriends');
    const win = document.getElementById('chatWindow');
    if (!friends.length) {
      list.innerHTML = '<p class="empty-state">Agrega amigos para poder chatear.</p>';
      win.style.display = 'none';
      currentChat = null;
      return;
    }
    list.innerHTML = '';
    friends.forEach(u => {
      const el = document.createElement('div');
      el.className = 'chat-row' + (currentChat === u.id ? ' active' : '');
      el.appendChild(avatarEl(u));
      const name = document.createElement('div');
      name.textContent = u.name + (u.online ? ' (en línea)' : '');
      el.appendChild(name);
      el.onclick = () => openChat(u.id, u.name, u.color);
      list.appendChild(el);
    });
  } catch (e) { console.error(e); }
}

async function openChat(friendId, friendName, color) {
  currentChat = friendId;
  document.getElementById('chatHeader').textContent = 'Chat con ' + friendName;
  document.getElementById('chatWindow').style.display = 'block';
  document.querySelectorAll('.chat-row').forEach(r => r.classList.remove('active'));
  await loadChatList();
  await loadMessages(friendId);
  document.getElementById('chatForm').onsubmit = async (e) => {
    e.preventDefault();
    const input = document.getElementById('chatInput');
    const text = input.value;
    if (!text.trim()) return;
    input.value = '';
    try {
      await api('/api/messages', { method: 'POST', body: JSON.stringify({ to: friendId, text }) });
      await loadMessages(friendId);
    } catch (err) { console.error(err); }
  };
}

async function loadMessages(friendId) {
  try {
    const msgs = await api('/api/messages/' + friendId);
    const box = document.getElementById('chatMessages');
    box.innerHTML = '';
    msgs.forEach(m => {
      const el = document.createElement('div');
      el.className = 'msg ' + (m.from === me.id ? 'mine' : 'theirs');
      const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      el.innerHTML = `${m.text}<span class="time">${time}</span>`;
      box.appendChild(el);
    });
    box.scrollTop = box.scrollHeight;
  } catch (e) { console.error(e); }
}

if (token) {
  api('/api/me').then(u => {
    me = u;
    enterApp();
  }).catch(() => localStorage.removeItem('token'));
}
