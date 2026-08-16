let token = localStorage.getItem('token');
let me = null;
let currentChat = null;
let pollTimer = null;
let deckStack = [];
let deckIndex = 0;
let matchTarget = null;
let pendingPhoto = null;
let notifs = { items: [], unseen: 0 };
let searchDebounce = null;

async function api(url, opts = {}) {
  const res = await fetch(url, {
    ...opts,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: token } : {}), ...(opts.headers || {}) }
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Error de conexión');
  return data;
}

/* ================= FOTO ================= */

function fileToDataUrl(file, size = 256) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const scale = Math.min(size / img.width, size / img.height, 1);
      canvas.width = Math.max(1, Math.round(img.width * scale));
      canvas.height = Math.max(1, Math.round(img.height * scale));
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', 0.85));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function avatarEl(u, className = 'avatar') {
  const el = document.createElement('span');
  el.className = className;
  applyAvatar(el, u);
  return el;
}

function applyAvatar(el, u) {
  if (u.photo) {
    el.style.backgroundImage = `url('${u.photo}')`;
    el.style.backgroundColor = u.color;
    el.textContent = '';
  } else {
    el.style.backgroundImage = 'none';
    el.style.background = u.color;
    el.textContent = u.name.charAt(0).toUpperCase();
  }
}

/* ================= AUTH ================= */

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
    const data = await api('/api/register', { method: 'POST', body: JSON.stringify({ name, email, password, age, hobby, bio }) });
    token = data.token; me = data.user;
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
    const data = await api('/api/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    token = data.token; me = data.user;
    localStorage.setItem('token', token);
    enterApp();
  } catch (e) { err.textContent = e.message; }
}

function logout() { localStorage.removeItem('token'); location.reload(); }

/* ================= ENTRAR ================= */

function enterApp() {
  document.getElementById('authScreen').style.display = 'none';
  document.getElementById('appScreen').style.display = 'block';
  applyAvatar(document.getElementById('meAvatar'), me);
  document.getElementById('meName').textContent = me.name;
  document.getElementById('meBadge').onclick = openProfileModal;
  document.getElementById('bellBtn').onclick = toggleNotifs;
  document.getElementById('searchInput').addEventListener('input', () => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(loadDiscover, 350);
  });
  document.getElementById('skipBtn').onclick = skipCard;
  document.getElementById('likeBtn').onclick = likeCard;
  document.getElementById('profilePhotoInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      pendingPhoto = await fileToDataUrl(file);
      document.getElementById('profilePhotoPreview').src = pendingPhoto;
    } catch { /* ignore */ }
  });
  loadDiscover();
  loadFriends();
  loadChatList();
  loadNotifs();
  document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', switchTab));
  document.addEventListener('click', (e) => {
    const panel = document.getElementById('notifPanel');
    if (panel.style.display !== 'none' && !e.target.closest('.bell-wrap')) panel.style.display = 'none';
  });
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(() => {
    loadNotifs(true);
    if (currentChat) loadMessages(currentChat);
  }, 4000);
}

function switchTab(e) {
  const tab = e.target.closest('.tab').dataset.tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => (v.style.display = v.id === tab ? 'block' : 'none'));
  if (tab === 'discover') loadDiscover();
  if (tab === 'friends') loadFriends();
  if (tab === 'chat') loadChatList();
}

/* ================= DESCUBRIR (DECK) ================= */

async function loadDiscover() {
  try {
    const q = document.getElementById('searchInput').value.trim();
    const users = await api('/api/users' + (q ? '?q=' + encodeURIComponent(q) : ''));
    deckStack = users.filter(u => !u.isFriend && !u.isLiked);
    deckIndex = 0;
    renderDeck();
  } catch (e) { console.error(e); }
}

function renderDeck() {
  const deck = document.getElementById('deck');
  const empty = document.getElementById('deckEmpty');
  const actions = document.getElementById('deckActions');
  deck.innerHTML = '';
  if (deckIndex >= deckStack.length) {
    empty.style.display = 'block';
    actions.style.display = 'none';
    return;
  }
  empty.style.display = 'none';
  actions.style.display = 'flex';
  const shown = deckStack.slice(deckIndex, deckIndex + 3);
  shown.forEach((u, i) => {
    const card = document.createElement('div');
    card.className = `deck-card ${i === 0 ? 'card-top' : i === 1 ? 'card-1' : 'card-2'}`;
    card.innerHTML = deckCardHTML(u);
    if (i === 0) card.onclick = () => openDetail(u);
    deck.appendChild(card);
  });
}

function deckCardHTML(u) {
  const initial = `<div class="big-initial">${u.name.charAt(0).toUpperCase()}</div>`;
  return `
    <div class="card-photo" style="${u.photo ? `background-image:url('${u.photo}')` : `background-color:${u.color}`}">
      ${u.photo ? '' : initial}
      <div class="card-grad"></div>
      <span class="online-chip"><span class="dot ${u.online ? '' : 'off'}"></span>${u.online ? 'En línea' : 'Desconectado'}</span>
      ${u.likedMe ? '<span class="liked-chip">❤️ Te dio like</span>' : ''}
    </div>
    <div class="card-info">
      <h3>${u.name} <span class="age">${u.age}</span></h3>
      ${u.hobby ? `<div class="hobbies"><span class="hobby-chip">${u.hobby}</span></div>` : ''}
      ${u.bio ? `<p class="bio">${u.bio}</p>` : ''}
    </div>
  `;
}

function animateAndNext(direction, target) {
  const deck = document.getElementById('deck');
  const top = deck.querySelector('.card-top');
  if (top) top.classList.add(direction === 'skip' ? 'flying-l' : 'flying-r');
  setTimeout(() => {
    if (target) deckIndex++;
    renderDeck();
  }, 320);
}

async function skipCard() {
  if (deckIndex >= deckStack.length) return;
  animateAndNext('skip');
}

async function likeCard() {
  const u = deckStack[deckIndex];
  if (!u) return;
  try {
    const res = await api('/api/likes', { method: 'POST', body: JSON.stringify({ userId: u.id }) });
    if (res.match) showMatch(u);
    animateAndNext('like', true);
    loadNotifs(true);
  } catch (e) {
    alert(e.message);
  }
}

/* ================= PERFIL (editar) ================= */

function openProfileModal() {
  pendingPhoto = me.photo || null;
  document.getElementById('peName').value = me.name;
  document.getElementById('peAge').value = me.age;
  document.getElementById('peHobby').value = me.hobby || '';
  document.getElementById('peBio').value = me.bio || '';
  document.getElementById('profileError').textContent = '';
  document.getElementById('profilePhotoPreview').src = me.photo || '';
  document.getElementById('profilePhotoPreview').style.background = me.color;
  document.getElementById('profileModal').style.display = 'flex';
}

function closeProfileModal() {
  document.getElementById('profileModal').style.display = 'none';
  pendingPhoto = null;
}

async function saveProfile() {
  const err = document.getElementById('profileError');
  err.textContent = '';
  const name = document.getElementById('peName').value.trim();
  const age = document.getElementById('peAge').value;
  if (!name) { err.textContent = 'El nombre no puede estar vacío.'; return; }
  try {
    me = await api('/api/me', {
      method: 'PUT',
      body: JSON.stringify({
        name, age,
        hobby: document.getElementById('peHobby').value,
        bio: document.getElementById('peBio').value,
        photo: pendingPhoto || ''
      })
    });
    applyAvatar(document.getElementById('meAvatar'), me);
    document.getElementById('meName').textContent = me.name;
    closeProfileModal();
    loadDiscover();
    loadFriends();
    loadChatList();
  } catch (e) { err.textContent = e.message; }
}

/* ================= DETALLE DE PERFIL ================= */

function openDetail(u) {
  const body = document.getElementById('detailBody');
  const initial = `<div class="big-initial">${u.name.charAt(0).toUpperCase()}</div>`;
  const isFriend = u.isFriend;
  body.innerHTML = `
    <div class="detail-hero" style="${u.photo ? `background-image:url('${u.photo}')` : `background-color:${u.color}`}">
      ${u.photo ? '' : initial}
      <div class="detail-grad"></div>
      <span class="d-status"><span class="dot ${u.online ? '' : 'off'}"></span>${u.online ? 'En línea' : 'Desconectado'}</span>
    </div>
    <div class="detail-name">${u.name}</div>
    <div class="detail-age">${u.age} años</div>
    ${u.hobby ? `<div class="detail-hobby">${u.hobby}</div>` : ''}
    ${u.bio ? `<p class="detail-bio">${u.bio}</p>` : ''}
    <div class="detail-btns">
      ${isFriend
        ? `<button class="btn-grad" onclick="closeDetail();switchToChat('${u.id}')">💬 Enviar mensaje</button>
           <button class="btn-ghost" onclick="removeFriend('${u.id}')">Eliminar</button>`
        : `<button class="btn-grad" onclick="detailLike('${u.id}')">❤️ Me gusta</button>
           <button class="btn-ghost" onclick="closeDetail()">Cerrar</button>`}
    </div>
  `;
  document.getElementById('detailModal').style.display = 'flex';
}

function closeDetail() { document.getElementById('detailModal').style.display = 'none'; }

async function detailLike(id) {
  try {
    const res = await api('/api/likes', { method: 'POST', body: JSON.stringify({ userId: id }) });
    closeDetail();
    if (res.match) {
      const target = deckStack.find(u => u.id === id);
      showMatch(target || { id, name: 'Tu match', color: '#ff4f93', photo: null });
    }
    loadDiscover();
    loadFriends();
    loadChatList();
    loadNotifs(true);
  } catch (e) { alert(e.message); }
}

async function removeFriend(id) {
  await api('/api/friends/' + id, { method: 'DELETE' });
  closeDetail();
  loadFriends(); loadDiscover(); loadChatList();
}

/* ================= MATCH MODAL ================= */

function showMatch(u) {
  matchTarget = u;
  document.getElementById('matchMyAvatar').src = me.photo || '';
  document.getElementById('matchMyAvatar').style.background = me.color;
  document.getElementById('matchOtherAvatar').src = u.photo || '';
  document.getElementById('matchOtherAvatar').style.background = u.color;
  document.getElementById('matchText').textContent = 'Tú y ' + u.name + ' se dieron like mutuamente';
  document.getElementById('matchModal').style.display = 'flex';
}

function closeMatch() {
  document.getElementById('matchModal').style.display = 'none';
  matchTarget = null;
}

function goToChatFromMatch() {
  if (!matchTarget) return;
  const id = matchTarget.id;
  closeMatch();
  switchToChat(id);
}

function switchToChat(friendId) {
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === 'chat'));
  document.querySelectorAll('.view').forEach(v => (v.style.display = v.id === 'chat' ? 'block' : 'none'));
  loadChatList().then(() => {
    const u = matchTarget || { id: friendId, name: 'Amigo', color: '#667eea', photo: null };
    openChat(u.id, u.name, u.color);
  });
}

/* ================= AMIGOS ================= */

async function loadFriends() {
  try {
    const users = await api('/api/users');
    const friends = users.filter(u => u.isFriend);
    const list = document.getElementById('friendsList');
    if (!friends.length) {
      list.innerHTML = '<p class="empty-state"><span class="emoji">🤝</span>Aún no tienes amigos. Descubre personas y dales "me gusta" hasta conseguir un match.</p>';
      return;
    }
    list.innerHTML = '';
    friends.forEach(u => {
      const el = document.createElement('div');
      el.className = 'person';
      el.onclick = () => openDetail(u);
      el.innerHTML = `
        <div class="p-top">
          <span class="p-person-avatar" style="${u.photo ? `background-image:url('${u.photo}')` : `background:${u.color}`}">${u.photo ? '' : u.name.charAt(0).toUpperCase()}
            <span class="p-status ${u.online ? 'on' : 'off'}"></span>
          </span>
          <div>
            <div class="p-name">${u.name}</div>
            <span class="p-age">${u.age} años</span>
          </div>
        </div>
        ${u.hobby ? `<span class="p-hobby">${u.hobby}</span>` : ''}
        <div style="display:flex;gap:8px">
          <button class="p-btn chat" data-act="chat">💬</button>
          <button class="p-btn remove" data-act="remove">Eliminar</button>
        </div>
      `;
      el.querySelector('[data-act="chat"]').onclick = (e) => { e.stopPropagation(); switchToChat(u.id); };
      el.querySelector('[data-act="remove"]').onclick = async (e) => {
        e.stopPropagation();
        await api('/api/friends/' + u.id, { method: 'DELETE' });
        loadFriends(); loadDiscover(); loadChatList();
      };
      list.appendChild(el);
    });
  } catch (e) { console.error(e); }
}

/* ================= NOTIFICACIONES ================= */

async function loadNotifs(silent) {
  try {
    const data = await api('/api/notifications');
    const hadUnseen = notifs.unseen > 0;
    notifs = data;
    const badge = document.getElementById('bellBadge');
    if (data.unseen > 0) { badge.style.display = 'flex'; badge.textContent = data.unseen; }
    else badge.style.display = 'none';
    if (data.unseen > 0 && hadUnseen) { /* keep panel if open */ }
    const panel = document.getElementById('notifPanel');
    if (panel.style.display !== 'none') renderNotifPanel();
  } catch (e) { if (!silent) console.error(e); }
}

function toggleNotifs() {
  const panel = document.getElementById('notifPanel');
  if (panel.style.display === 'none') {
    renderNotifPanel();
    panel.style.display = 'block';
    api('/api/notifications/seen', { method: 'POST' }).then(() => {
      document.getElementById('bellBadge').style.display = 'none';
      notifs.unseen = 0;
    });
  } else {
    panel.style.display = 'none';
  }
}

function renderNotifPanel() {
  const panel = document.getElementById('notifPanel');
  if (!notifs.items.length) {
    panel.innerHTML = '<div class="notif-empty">No tienes notificaciones todavía.</div>';
    return;
  }
  panel.innerHTML = notifs.items.map(n => `
    <div class="notif-item" onclick="switchToChat('${n.fromId}')">
      <span class="avatar" style="${n.fromPhoto ? `background-image:url('${n.fromPhoto}')` : `background:${n.fromColor}`}">${n.fromPhoto ? '' : n.fromName.charAt(0).toUpperCase()}</span>
      <div style="flex:1">
        <div class="n-text">${n.text}</div>
        <div class="n-time">${timeAgo(n.ts)}</div>
      </div>
      ${n.seen ? '' : '<span class="n-dot"></span>'}
    </div>
  `).join('');
}

function timeAgo(ts) {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  return Math.floor(s / 86400) + ' d';
}

/* ================= CHAT ================= */

async function loadChatList() {
  try {
    const users = await api('/api/users');
    const friends = users.filter(u => u.isFriend);
    const list = document.getElementById('chatFriends');
    const win = document.getElementById('chatWindow');
    if (!friends.length) {
      list.innerHTML = '<p class="empty-state"><span class="emoji">💬</span>Agrega amigos para poder chatear con ellos.</p>';
      win.style.display = 'none';
      currentChat = null;
      return;
    }
    list.innerHTML = '';
    friends.forEach(u => {
      const el = document.createElement('div');
      el.className = 'chat-row' + (currentChat === u.id ? ' active' : '');
      el.appendChild(avatarEl(u, 'avatar'));
      el.innerHTML += `
        <div>
          <div class="chat-name">${u.name}</div>
          <div class="chat-status"><span class="dot ${u.online ? '' : 'off'}"></span>${u.online ? 'En línea' : 'Desconectado'}</div>
        </div>
      `;
      el.onclick = () => openChat(u.id, u.name, u.color, u.photo);
      list.appendChild(el);
    });
    if (currentChat) {
      const active = friends.find(f => f.id === currentChat);
      if (!active) { currentChat = null; win.style.display = 'none'; }
    }
  } catch (e) { console.error(e); }
}

async function openChat(friendId, friendName, color, photo) {
  currentChat = friendId;
  const header = document.getElementById('chatHeader');
  header.innerHTML = '';
  const av = document.createElement('span');
  av.className = 'avatar';
  applyAvatar(av, { name: friendName, color, photo: photo || null });
  header.appendChild(av);
  header.appendChild(document.createTextNode(friendName));
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
      const cls = m.system ? 'system' : (m.from === me.id ? 'mine' : 'theirs');
      el.className = 'msg ' + cls;
      const time = new Date(m.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      el.innerHTML = m.system ? m.text : `${m.text}<span class="time">${time}</span>`;
      box.appendChild(el);
    });
    box.scrollTop = box.scrollHeight;
  } catch (e) { console.error(e); }
}

/* ================= INICIO ================= */

if (token) {
  api('/api/me').then(u => {
    me = u;
    enterApp();
  }).catch(() => localStorage.removeItem('token'));
}
