// 悪意のある見本：最初の load の前に枠を移す。移った先が ld-frame-loaded を真似すると、親の見張りをすり抜ける（SEC001 の R1）。親のページの frame-src で止まる（README.md）。
export function mount() {
  const l = location;
  l.href = 'https://evil.example/fake-ready';
  return () => {};
}
