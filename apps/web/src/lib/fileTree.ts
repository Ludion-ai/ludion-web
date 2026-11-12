// ファイルの木（WS003）：本当のファイルと、地図の分け目（設定の塊、シェーダー、見出し、文書の style と script、素材）を1本の木にする。
// 関数は木に入れず、目次に出す。分け目は「見方」で、押すと本当のファイルのその行へ飛ぶ（ファイルは書き換えない）。

import type { TreeSection, WorkTree } from '../data/pages';
import type { LineRange } from './codeAddress';

export type TreeNodeKind = 'file' | 'group' | Exclude<TreeSection['kind'], 'function'>;

export interface TreeNode {
  key: string;
  kind: TreeNodeKind;
  /** ファイルの名前、分け目の名前。group（シェーダーのまとまり）では空 */
  name: string;
  file: string;
  /** 押したときに選ぶ行。ファイルは null（頭から） */
  range: LineRange | null;
  children: TreeNode[];
  /** ファイル：バイト数と行の数。シェーダー：頂点かフラグメントか */
  bytes?: number;
  lines?: number;
  stage?: 'vertex' | 'fragment';
  mime?: string;
}

/** 同じ親の下のシェーダーが、この数からまとめる */
const GROUP_SHADERS_FROM = 3;
/** 同じ親の下に出す素材の数（data: の画像がたくさんある文書で、木が埋まらないように） */
const MAX_ASSETS = 12;

const keyOf = (section: TreeSection) => `${section.file}:${section.kind}:${section.start}-${section.end}:${section.name}`;

/** 同じ親の下のシェーダーをまとめ、素材を上限までにする */
function tidy(node: TreeNode): void {
  let assets = 0;
  node.children = node.children.filter((child) => child.kind !== 'asset' || ++assets <= MAX_ASSETS);
  const shaders = node.children.filter((child) => child.kind === 'shader');
  // 見出し（例：「シェーダー」）の中がシェーダーだけなら、その見出しがまとまり。もう1段は作らない
  const onlyShaders = node.kind !== 'file' && shaders.length === node.children.length;
  if (shaders.length >= GROUP_SHADERS_FROM && !onlyShaders) {
    const at = node.children.indexOf(shaders[0]);
    const group: TreeNode = {
      key: `${node.key}/shaders`,
      kind: 'group',
      name: '',
      file: node.file,
      range: { start: shaders[0].range!.start, end: shaders[shaders.length - 1].range!.end },
      children: shaders,
    };
    node.children = node.children.filter((child) => child.kind !== 'shader');
    node.children.splice(at, 0, group);
  }
  for (const child of node.children) if (child.kind !== 'group') tidy(child);
}

export function buildFileTree(tree: WorkTree): TreeNode[] {
  return tree.files.map((file) => {
    const root: TreeNode = { key: file.name, kind: 'file', name: file.name, file: file.name, range: null, children: [], bytes: file.bytes, lines: file.lines };
    // 入れ子は、行の範囲の含み方で決める（地図の depth は関数も数えるので、木には使わない）
    const stack: { node: TreeNode; end: number }[] = [];
    for (const section of tree.sections) {
      if (section.file !== file.name || section.kind === 'function') continue;
      while (stack.length > 0 && stack[stack.length - 1].end < section.start) stack.pop();
      while (stack.length > 0 && stack[stack.length - 1].end < section.end) stack.pop();
      const node: TreeNode = {
        key: keyOf(section),
        kind: section.kind,
        name: section.name,
        file: section.file,
        range: { start: section.start, end: section.end },
        children: [],
        ...(section.bytes !== undefined ? { bytes: section.bytes } : {}),
        ...(section.stage ? { stage: section.stage } : {}),
        ...(section.mime ? { mime: section.mime } : {}),
      };
      (stack.length > 0 ? stack[stack.length - 1].node : root).children.push(node);
      // シェーダーと素材は葉（中に見出しを入れない）
      if (section.kind !== 'shader' && section.kind !== 'asset') stack.push({ node, end: section.end });
    }
    tidy(root);
    return root;
  });
}

/** 目次：そのファイルの関数（行の順） */
export function functionsOf(tree: WorkTree, file: string): TreeSection[] {
  return tree.sections.filter((section) => section.file === file && section.kind === 'function');
}

/** 選んだ行の範囲と同じ分け目（道しるべに出す）。関数より、木に出ている分け目を先に */
export function sectionAt(tree: WorkTree, file: string, range: LineRange | null): TreeSection | null {
  if (!range) return null;
  const same = tree.sections.filter((section) => section.file === file && section.start === range.start && section.end === range.end);
  return same.find((section) => section.kind !== 'function') ?? same[0] ?? null;
}

/** 木の中で、その鍵の節までの道（根から。なければ空） */
export function pathTo(nodes: TreeNode[], key: string): TreeNode[] {
  for (const node of nodes) {
    if (node.key === key) return [node];
    const below = pathTo(node.children, key);
    if (below.length > 0) return [node, ...below];
  }
  return [];
}

/** JS の中のシェーダーの文字列の行の範囲（色付けに使う） */
export function shaderRanges(tree: WorkTree, file: string): LineRange[] {
  return tree.sections.filter((section) => section.file === file && section.kind === 'shader').map(({ start, end }) => ({ start, end }));
}
