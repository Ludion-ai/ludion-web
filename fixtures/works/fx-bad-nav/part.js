// わざと壊した：押すと、ページを外の URL へ移す。「形」だけで落ちる（T008）。
// 押したときだけ動くので、ld check の描画（崩れ、アクセシビリティ）は止まらない。
export function mount(root) {
  const button = root.querySelector('.go');
  const onClick = () => {
    location.href = 'https://outside.example/?from=fx-bad-nav';
  };
  button.addEventListener('click', onClick);
  return () => button.removeEventListener('click', onClick);
}
