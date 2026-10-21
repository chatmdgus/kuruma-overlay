const box = document.getElementById('voice');
const membersEl = document.getElementById('members');
const offline = document.getElementById('offline');

function render(members) {
  box.style.display = members.length ? '' : 'none';
  membersEl.replaceChildren(...members.map((m) => {
    const row = document.createElement('div');
    row.className = 'row';

    const av = document.createElement('div');
    av.className = 'av';
    if (m.avatar) {
      const img = document.createElement('img');
      img.src = m.avatar;
      av.append(img);
    } else {
      av.textContent = (m.name || '?').slice(0, 1);
    }

    const name = document.createElement('span');
    name.textContent = m.name;

    row.append(av, name);

    const state = m.selfDeaf ? '스피커 끔' : (m.selfMute || m.serverMute) ? '음소거' : '';
    if (state) {
      const s = document.createElement('span');
      s.className = 'state';
      s.textContent = state;
      row.append(s);
    }
    return row;
  }));
}

window.overlay.on('voice', render);
window.overlay.on('connection', (online) => {
  offline.classList.toggle('on', !online);
  if (!online) box.style.display = '';
});
render([]);

window.overlay.on('edit-mode', (on) => document.body.classList.toggle('editing', on));
