/** 行の頭の位置（0 から数える行 → 文字の位置）。本文の行の切り方と、色付けの行の数え方で同じ物を使う */
export function lineStartsOf(text: string): Int32Array {
  const starts = [0];
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return Int32Array.from(starts);
}
