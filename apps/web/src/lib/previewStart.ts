/**
 * 作品のページのプレビューの枠を、React を待たずに読み始める（PERF002「1」）。
 * 作品のページでは、枠の入れ物の直後のインラインの台本（WorkPage.tsx）がこれを呼ぶ。HTML が届き終わるのを待たずに、枠を読み始めるため。
 * HTML の最後の beforeApp も、もう一度呼ぶ（もう読み始めた枠には何もしない。倍率は、ページが全部並んだ後の幅で決め直す）。
 *
 * 1. スマホでは、Web の画面の Desktop の枠を Mobile の枠に替える（React が載る前に。lib/frame.ts の PHONE_QUERY）。
 * 2. 枠の幅に合わせて iframe を縮める倍率を決める。
 * 3. 枠を、見えている細かさ（実際の DPR × 縮めた割合）を付けた URL で読み始める（PREVIEW-DPR。lib/frame.ts の startFrame）。
 */
import { BOX_CLASS, FRAME_CLASS, frameScale, isPhone, previewScale, startFrame, type FrameSize } from './frame';

export function startPreview(): void {
  const phone = isPhone();
  const frameBox = document.querySelector<HTMLElement>('[data-frame-size]');
  if (frameBox) {
    // Worker はどの端末かを知らないので、Web の画面を Desktop の枠で描く。スマホなら、React が同じ形で載るよう、ここで Mobile に替える。
    // 枠はまだ読み始めていない（src がない。下の startFrame が入れる）ので、読む先（data-src）と形を替えるだけでよい
    const phoneSrc = frameBox.dataset.phoneSrc;
    const frame = frameBox.querySelector<HTMLIFrameElement>('iframe[data-ld-frame]');
    if (frame && phoneSrc && frameBox.dataset.frameSize === 'desktop' && phone && !frame.hasAttribute('src')) {
      frameBox.dataset.frameSize = 'mobile';
      frameBox.className = frameBox.className.replace(BOX_CLASS.desktop, BOX_CLASS.mobile);
      frame.className = FRAME_CLASS.mobile;
      frame.dataset.src = phoneSrc;
    }
    frameBox.style.setProperty('--frame-scale', String(frameScale(frameBox.dataset.frameSize as FrameSize, frameBox.clientWidth)));
  }
  for (const frame of document.querySelectorAll<HTMLIFrameElement>('iframe[data-ld-frame][data-src]')) {
    // 部品の枠は縮めない（data-frame-size のない入れ物）。スマホの Mobile の枠も縮めない（previewScale）
    const box = frame.closest<HTMLElement>('[data-frame-size]');
    startFrame(frame, box ? previewScale(box.dataset.frameSize as FrameSize, box.clientWidth, phone) : 1);
  }
}
