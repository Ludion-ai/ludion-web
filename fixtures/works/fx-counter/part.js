// part.js — ESモジュール。rootの中だけを触る
// AI が書く HTML によくある形：読み込みで localStorage から数を読み、押すたびに書く（FRAME001 の見本）。
// 枠の中の localStorage はメモリだけなので、読み直すと 0 に戻る。
const KEY = 'fx-counter:count';

export function mount(root) {
  const count = root.querySelector('.count');
  const add = root.querySelector('.add');
  let value = Number(localStorage.getItem(KEY)) || 0;
  count.textContent = String(value);
  const onClick = () => {
    value += 1;
    localStorage.setItem(KEY, String(value));
    count.textContent = String(value);
  };
  add.addEventListener('click', onClick);
  return () => add.removeEventListener('click', onClick);
}
