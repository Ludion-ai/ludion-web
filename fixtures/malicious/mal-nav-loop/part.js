// 悪意のある見本：読み込むたびに枠を外へ移す。親は読み直しを打ち切り、枠を空にする（README.md）。
export function mount() {
  globalThis['loc' + 'ation'].href = 'https://evil.example/moved-again';
  return () => {};
}
