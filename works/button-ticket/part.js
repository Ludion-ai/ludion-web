// part.js — ESモジュール。rootの中だけを触る
// 数字は1つだけ押したままになる。Cancel で全部戻る。
export function mount(root) {
  const numbers = [...root.querySelectorAll('.num')];
  const cancel = root.querySelector('.cancel');
  const onNumber = (event) => {
    for (const button of numbers) button.setAttribute('aria-pressed', String(button === event.currentTarget));
  };
  const onCancel = () => {
    for (const button of numbers) button.setAttribute('aria-pressed', 'false');
  };
  for (const button of numbers) button.addEventListener('click', onNumber);
  cancel.addEventListener('click', onCancel);
  return () => {
    for (const button of numbers) button.removeEventListener('click', onNumber);
    cancel.removeEventListener('click', onCancel);
  };
}
