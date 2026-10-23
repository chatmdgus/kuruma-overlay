// 내 GIF: 고른 이미지를 창 크기에 맞춰 띄움 (비율 유지)
const img = document.getElementById('img');
const empty = document.getElementById('empty');
let current = '';

window.overlay.on('settings', ({ src = '', opacity = 1 }) => {
  document.getElementById('gif').style.opacity = opacity;
  if (src !== current) {
    current = src;
    img.hidden = !src;
    empty.hidden = !!src;
    if (src) {
      img.src = src;
      img.classList.remove('pop');
      void img.offsetWidth;   // 바꿀 때마다 통통 튀는 등장 효과 다시
      img.classList.add('pop');
    } else {
      img.removeAttribute('src');
    }
  }
});
