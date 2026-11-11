// part.js — submit を受けて preventDefault し、エラーを --_danger で出す
export function mount(root) {
  const form = root.querySelector('.form');
  const input = root.querySelector('.input');
  const error = root.querySelector('.error');
  const done = root.querySelector('.done');
  const onSubmit = (event) => {
    event.preventDefault();
    const ok = input.value.includes('@');
    error.hidden = ok;
    done.hidden = !ok;
    input.setAttribute('aria-invalid', String(!ok));
  };
  form.addEventListener('submit', onSubmit);
  return () => form.removeEventListener('submit', onSubmit);
}
