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
  document.getElementById('registerForm').style.display = 'flex';
  document.getElementById('authError').textContent = '';
}
function showLogin() {
  document.getElementById('registerForm').style.display = 'none';
  document.getElementById('loginForm').style.display = 'flex';
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
  err.textContent = '';
  if (!name || !email || !password || !age) { err.textContent = 'Completa nombre, correo, contraseña y edad.'; return; }
  if (password.length < 4) { err.textContent = 'La contraseña debe tener al menos 4 caracteres.'; return; }
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
  err.textContent = '';
  if (!email || !password) { err.textContent = 'Escribe tu correo y contraseña.'; return; }
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

function enterApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  const av = document.getElementById('meAvatar');
  av.style.background = me.color;
  av.textContent = me.name.charAt(0).toUpperCase();
  document.getElementById('meName').textContent = me.name;
  loadPeople();
  loadFriends();
  loadChatList();
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', switchTab));
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => { if (currentChat) loadMessages(currentChat); }, 3000);
}

function switchTab(e) {
  const tab = e.target.closest('.tab').dataset.tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => (v.style.display = v.id === tab ? 'block' : 'none'));
  if (tab === 'discover') loadPeople();
  if (tab === 'friends') loadFriends();
  if (tab === 'chat') loadChatList();
}

function emptyState(emoji, text) {
  return `<p class="empty-state"><span class="emoji">${emoji}</span>${text}</p>`;
}

function personCard(u, action) {
  const el = document.createElement('div');
  el.className = 'person';
  el.innerHTML = `
    <div class="p-top">
      <span class="p-person-avatar" style="background:${u.color}">${u.name.charAt(0).toUpperCase()}
        <span class="p-status ${u.online ? 'on' : 'off'}"></span>
      </span>
      <div>
        <div class="p-name">${u.name}</div>
        <span class="p-age">${u.age} años</span>
      </div>
    </div>
    ${u.hobby ? `<span class="p-hobby">${u.hobby}</span>` : ''}
    ${u.bio ? `<p class="p-bio">${u.bio}</p>` : ''}
  `;
  el.appendChild(action(u));
  return el;
}

async function loadPeople() {
  try {
    const users = await api('/api/users');
    const list = document.getElementById('peopleList');
    if (!users.length) {
      list.innerHTML = emptyState('🌍', 'Todavía no hay más personas. ¡Comparte el enlace de la app con alguien!');
      return;
    }
    list.innerHTML = '';
    users.forEach(u => {
      const btn = document.createElement('button');
      btn.className = 'p-btn ' + (u.isFriend ? 'done' : 'add');
      btn.textContent = u.isFriend ? '✓ Agregado' : '+ Conocer';
      btn.onclick = async () => {
        try {
          if (u.isFriend) {
            await api('/api/friends/' + u.id, { method: 'DELETE' });
          } else {
            await api('/api/friends', { method: 'POST', body: JSON.stringify({ friendId: u.id }) });
          }
          loadPeople();
          loadFriends();
          loadChatList();
        } catch (e) { alert(e.message); }
      };
      list.appendChild(personCard(u, () => btn));
    });
  } catch (e) { console.error(e); }
}

async function loadFriends() {
  try {
    const users = await api('/api/users');
    const friends = users.filter(u => u.isFriend);
    const list = document.getElementById('friendsList');
    if (!friends.length) {
      list.innerHTML = emptyState('🤝', 'Aún no tienes amigos. Ve a "Descubrir" y conoce a alguien.');
      return;
    }
    list.innerHTML = '';
    friends.forEach(u => {
      const btn = document.createElement('button');
      btn.className = 'p-btn remove';
      btn.textContent = 'Eliminar';
      btn.onclick = async () => {
        try {
          await api('/api/friends/' + u.id, { method: 'DELETE' });
          loadFriends();
          loadPeople();
          loadChatList();
        } catch (e) { alert(e.message); }
      };
      list.appendChild(personCard(u, () => btn));
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
      list.innerHTML = emptyState('💬', 'Agrega amigos para poder chatear con ellos.');
      win.style.display = 'none';
      currentChat = null;
      return;
    }
    list.innerHTML = '';
    friends.forEach(u => {
      const el = document.createElement('div');
      el.className = 'chat-row' + (currentChat === u.id ? ' active' : '');
      el.innerHTML = `
        <span class="avatar" style="background:${u.color}">${u.name.charAt(0).toUpperCase()}</span>
        <div>
          <div class="chat-name">${u.name}</div>
          <div class="chat-status"><span class="dot ${u.online ? '' : 'off'}"></span>${u.online ? 'En línea' : 'Desconectado'}</div>
        </div>
      `;
      el.onclick = () => openChat(u.id, u.name, u.color);
      list.appendChild(el);
    });
    if (currentChat) {
      const activeFriend = friends.find(f => f.id === currentChat);
      if (!activeFriend) { currentChat = null; win.style.display = 'none'; }
    }
  } catch (e) { console.error(e); }
}

async function openChat(friendId, friendName, color) {
  currentChat = friendId;
  document.getElementById('chatHeader').innerHTML = `
    <span class="avatar" style="background:${color}">${friendName.charAt(0).toUpperCase()}</span>
    ${friendName}
  `;
  document.getElementById('chatWindow').style.display = 'flex';
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
