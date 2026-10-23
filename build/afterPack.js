// 설치 파일을 만들기 전에 KurumaOverlay.exe 에 아이콘과 버전 정보를 넣음
// (signAndEditExecutable 을 끈 상태라 electron-builder 가 안 넣어 줌 → 시작 메뉴에 Electron 기본 아이콘이 보이던 문제)
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  const mod = require('rcedit');
  const rcedit = mod.rcedit || mod.default || mod;
  const { productFilename, version } = context.packager.appInfo;
  const exe = path.join(context.appOutDir, `${productFilename}.exe`);
  await rcedit(exe, {
    icon: path.join(__dirname, 'icon.ico'),
    'file-version': version,
    'product-version': version,
    'version-string': {
      ProductName: 'Kuruma Overlay',
      FileDescription: 'Kuruma Overlay',
      CompanyName: 'kuruma',
      LegalCopyright: 'kuruma',
      OriginalFilename: `${productFilename}.exe`,
    },
  });
  console.log('[afterPack] 아이콘 넣음:', exe);
};
