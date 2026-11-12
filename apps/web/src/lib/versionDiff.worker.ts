// 版の違いを、画面を止めずに計算する Web Worker（WS004「2」の重さ）。中身は lib/versionDiff.ts。
// 受けるのは版の文字だけで、ページの DOM や cookie には触らない。
import { diffVersions, type VersionFiles } from './versionDiff';

export interface DiffRequest {
  id: number;
  before: VersionFiles;
  after: VersionFiles;
  sections: boolean;
}

const scope = self as unknown as { onmessage: ((event: MessageEvent<DiffRequest>) => void) | null; postMessage: (message: unknown) => void };

scope.onmessage = (event) => {
  const { id, before, after, sections } = event.data;
  try {
    scope.postMessage({ id, ok: true, result: diffVersions(before, after, { sections }) });
  } catch {
    scope.postMessage({ id, ok: false });
  }
};
