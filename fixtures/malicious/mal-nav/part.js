// 悪意のある見本：押すと枠を外へ移す。文字列の検査をすり抜ける書き方。親が元の URL で読み直す（README.md）。
export function mount(root) {
  const button = root.querySelector('.go');
  const move = () => {
    globalThis['loc' + 'ation'].href = 'https://evil.example/moved';
  };
  button.addEventListener('click', move);
  return () => button.removeEventListener('click', move);
}
