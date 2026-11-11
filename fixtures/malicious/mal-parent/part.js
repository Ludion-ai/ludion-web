// 悪意のある見本：親のページの DOM を書き換える。枠の中では失敗する（README.md）。
export function mount(root) {
  try {
    window.parent.document.body.innerHTML = '<h1 id="hacked">Hacked</h1>';
    root.setAttribute('data-parent', 'rewritten');
  } catch (error) {
    root.setAttribute('data-parent', `blocked:${error.name}`);
  }
  return () => {};
}
