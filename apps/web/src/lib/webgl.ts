let available: boolean | null = null;

/**
 * この端末のブラウザで WebGL が作れるか（docs/tasks/FIX-motion.md「2」）。作るのは少し重いので、1回だけ確かめる。
 * loseContext は呼ばない。コンソールに警告が出るため。参照を捨てれば片付く。
 */
export function webglAvailable(): boolean {
  if (available === null) {
    try {
      const canvas = document.createElement('canvas');
      available = !!(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
    } catch {
      available = false;
    }
  }
  return available;
}
