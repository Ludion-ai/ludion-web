// part.js — ESモジュール。rootの中だけを触る
export function mount(root) {
  const switches = [...root.querySelectorAll('.switch')];
  const onClick = (event) => {
    const button = event.currentTarget;
    button.setAttribute('aria-checked', String(button.getAttribute('aria-checked') !== 'true'));
  };
  for (const button of switches) button.addEventListener('click', onClick);
  return () => {
    for (const button of switches) button.removeEventListener('click', onClick);
  };
}
