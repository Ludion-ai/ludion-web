// 悪意のある見本：親のページごと外へ遷移させる。枠の中では失敗する（README.md）。
export function mount(root) {
  try {
    window.top.location.href = 'https://evil.example/hijacked';
    root.setAttribute('data-top', 'navigated');
  } catch (error) {
    root.setAttribute('data-top', `blocked:${error.name}`);
  }
  return () => {};
}
