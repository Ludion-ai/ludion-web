// part.js — ESモジュール。rootの中だけを触る
// 4つの画面（Sign in、Create account、Reset password、Verify code）を1枚のカードの中で切り替える。
// エラーは、入力欄を離れたときか送信したときだけ出す。打っている最中には新しく出さない。

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const WAIT_MS = 800;

const RULES = {
  length: (v) => v.length >= 8,
  case: (v) => /[a-z]/.test(v) && /[A-Z]/.test(v),
  number: (v) => /\d/.test(v),
};

function messageFor(input) {
  const value = input.value;
  switch (input.dataset.validate) {
    case 'email':
      if (!value.trim()) return 'Enter your email address.';
      if (!EMAIL.test(value.trim())) return 'Enter an email address like name@example.com.';
      return '';
    case 'password':
      return value ? '' : 'Enter your password.';
    case 'new-password':
      if (!value) return 'Create a password.';
      return Object.values(RULES).every((rule) => rule(value)) ? '' : 'Your password doesn’t meet every requirement yet.';
    default:
      return '';
  }
}

export function mount(root) {
  const cleanups = [];
  const timers = new Set();
  const on = (el, type, fn) => {
    el.addEventListener(type, fn);
    cleanups.push(() => el.removeEventListener(type, fn));
  };
  const later = (fn, ms) => {
    const t = setTimeout(() => {
      timers.delete(t);
      fn();
    }, ms);
    timers.add(t);
  };
  const byId = (id) => root.querySelector(`[id="${id}"]`);

  const screens = [...root.querySelectorAll('[data-screen]')];
  const screen = (name) => root.querySelector(`[data-screen="${name}"]`);

  // ---- エラー
  const errorFor = (input) => byId(input.getAttribute('aria-describedby').split(' ')[0]);
  const setError = (input, message) => {
    const error = errorFor(input);
    error.textContent = message;
    error.hidden = !message;
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  };

  // ---- 画面の行き来
  const digits = [...root.querySelectorAll('.digit')];
  const codeError = byId('as-verify-error');
  const verifyStatus = root.querySelector('[data-status]');

  const clearCode = () => {
    for (const d of digits) {
      d.value = '';
      d.removeAttribute('aria-invalid');
    }
    codeError.textContent = '';
    codeError.hidden = true;
    verifyStatus.textContent = '';
  };

  const go = (name, focusTarget) => {
    for (const s of screens) s.hidden = s.dataset.screen !== name;
    const target = screen(name);
    // 前に送った画面は、フォームに戻しておく
    const form = target.querySelector('form');
    const done = target.querySelector('[data-done]');
    if (form) form.hidden = false;
    if (done) done.hidden = true;
    if (name === 'verify') clearCode();
    (focusTarget ?? target.querySelector('.title')).focus();
  };

  for (const link of root.querySelectorAll('[data-go]')) {
    on(link, 'click', () => go(link.dataset.go));
  }

  // リンクやボタンを押し下げた瞬間に入力欄から離れると、エラーの文が出てボタンが下へずれ、
  // 指を離す位置がボタンの外になってクリックが成り立たない。押し下げではフォーカスを動かさない。
  for (const button of root.querySelectorAll('[data-go], [data-resend], .reveal, .submit')) {
    on(button, 'mousedown', (event) => event.preventDefault());
  }

  // ---- 入力欄：離れたときに確かめる。打っている間は、直ったエラーを消すだけ
  for (const input of root.querySelectorAll('[data-validate]')) {
    on(input, 'input', () => {
      input.dataset.dirty = 'true';
      if (input.hasAttribute('aria-invalid') && !messageFor(input)) setError(input, '');
    });
    on(input, 'blur', () => {
      if (input.dataset.dirty === 'true') setError(input, messageFor(input));
    });
  }

  // ---- パスワード：表示と非表示、Caps Lock
  for (const button of root.querySelectorAll('.reveal')) {
    const input = byId(button.getAttribute('aria-controls'));
    const text = button.querySelector('.reveal-text');
    on(button, 'click', () => {
      const showing = input.type === 'text';
      input.type = showing ? 'password' : 'text';
      text.textContent = showing ? 'Show' : 'Hide';
    });
  }

  for (const input of root.querySelectorAll('.has-reveal')) {
    const caps = byId(`${input.id}-caps`);
    const update = (event) => {
      caps.hidden = !(event.getModifierState && event.getModifierState('CapsLock'));
    };
    on(input, 'keydown', update);
    on(input, 'keyup', update);
    on(input, 'blur', () => {
      caps.hidden = true;
    });
  }

  // ---- 新しいパスワードの条件：満たした順に、その場でチェック
  const newPassword = byId('as-signup-password');
  const rules = [...root.querySelectorAll('[data-rule]')];
  on(newPassword, 'input', () => {
    for (const li of rules) {
      const met = RULES[li.dataset.rule](newPassword.value);
      li.toggleAttribute('data-met', met);
      li.querySelector('[data-rule-state]').textContent = met ? 'Done: ' : 'Not yet: ';
    }
  });

  // ---- 6桁の枠
  const codeComplete = () => digits.every((d) => /^\d$/.test(d.value));
  const fill = (from, text) => {
    const chars = text.replace(/\D/g, '').slice(0, digits.length - from).split('');
    chars.forEach((c, i) => {
      digits[from + i].value = c;
    });
    const next = Math.min(from + chars.length, digits.length - 1);
    digits[next].focus();
    digits[next].select();
    if (codeComplete()) {
      codeError.hidden = true;
      codeError.textContent = '';
      for (const d of digits) d.removeAttribute('aria-invalid');
    }
  };

  digits.forEach((box, i) => {
    on(box, 'focus', () => box.select());
    on(box, 'keydown', (event) => {
      if (/^\d$/.test(event.key)) {
        event.preventDefault();
        fill(i, event.key);
      } else if (event.key === 'Backspace') {
        event.preventDefault();
        if (box.value) box.value = '';
        else if (i > 0) {
          digits[i - 1].value = '';
          digits[i - 1].focus();
        }
      } else if (event.key === 'ArrowLeft' && i > 0) {
        event.preventDefault();
        digits[i - 1].focus();
      } else if (event.key === 'ArrowRight' && i < digits.length - 1) {
        event.preventDefault();
        digits[i + 1].focus();
      }
    });
    // スマホのキーボードや自動入力は keydown を通らないので、input でも受ける
    on(box, 'input', () => {
      const value = box.value.replace(/\D/g, '');
      if (!value) {
        box.value = '';
        return;
      }
      fill(i, value);
    });
    on(box, 'paste', (event) => {
      event.preventDefault();
      const text = (event.clipboardData && event.clipboardData.getData('text')) || '';
      if (/\d/.test(text)) fill(0, text);
    });
  });

  // 6つの枠の外へ出たとき、途中まで打っていたら知らせる
  const showCodeError = () => {
    codeError.textContent = 'Enter all 6 digits.';
    codeError.hidden = false;
    for (const d of digits) d.setAttribute('aria-invalid', 'true');
  };
  const code = root.querySelector('[data-code]');
  on(code, 'focusout', (event) => {
    if (code.contains(event.relatedTarget)) return;
    if (digits.some((d) => d.value) && !codeComplete()) showCodeError();
  });

  // ---- 送信：約0.8秒の見せかけの待ち。二度押しできない
  const busy = (form, onDone) => {
    const button = form.querySelector('.submit');
    const text = button.querySelector('.submit-text');
    const idle = text.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    text.textContent = button.dataset.busy;
    later(() => {
      button.disabled = false;
      button.removeAttribute('aria-busy');
      text.textContent = idle;
      onDone();
    }, WAIT_MS);
  };

  const validateForm = (form) => {
    let first = null;
    for (const input of form.querySelectorAll('[data-validate]')) {
      const message = messageFor(input);
      setError(input, message);
      if (message && !first) first = input;
    }
    return first;
  };

  const emailOf = (form) => form.querySelector('[type="email"]').value.trim();
  const showEmail = (name, email) => {
    for (const el of screen(name).querySelectorAll('[data-email]')) el.textContent = email;
  };

  const finish = (section) => {
    section.querySelector('form').hidden = true;
    const done = section.querySelector('[data-done]');
    done.hidden = false;
    done.focus();
  };

  // 送信は、送信ボタンの click で受ける。Ludion の iframe は sandbox="allow-scripts" だけで
  // allow-forms がないので、submit イベントが来ない。Enter で送ったときも、ブラウザが送信ボタンを click する。
  // click を止めればフォームは送られないが、ふつうのページに貼られたときのために submit も止めておく。
  for (const form of root.querySelectorAll('form')) {
    const button = form.querySelector('.submit');
    on(button, 'click', (event) => {
      event.preventDefault();
      send(form);
    });
    on(form, 'submit', (event) => {
      event.preventDefault();
      send(form);
    });
  }

  function send(form) {
    if (form.querySelector('.submit').disabled) return;
    const kind = form.dataset.form;

    if (kind === 'verify') {
      if (!codeComplete()) {
        showCodeError();
        (digits.find((d) => !d.value) ?? digits[0]).focus();
        return;
      }
      busy(form, () => finish(screen('verify')));
      return;
    }

    const invalid = validateForm(form);
    if (invalid) {
      invalid.focus();
      return;
    }
    const email = emailOf(form);
    if (kind === 'reset') {
      busy(form, () => {
        showEmail('reset', email);
        finish(screen('reset'));
      });
    } else {
      busy(form, () => {
        showEmail('verify', email);
        go('verify', digits[0]);
      });
    }
  }

  // ---- コードの再送
  on(root.querySelector('[data-resend]'), 'click', () => {
    verifyStatus.textContent = 'We sent a new code.';
  });

  return () => {
    for (const off of cleanups) off();
    for (const t of timers) clearTimeout(t);
    timers.clear();
  };
}
