// 自分の作品の並び（WS001）は、ログインしている人にしか要らない。ホームの最初の JS に入れず、ログインの答えの後に読む。
// 同じ import() を返すので、先に読み始めておけば、開くときには届いている。

export const loadOwnWorksPanel = () => import('./OwnWorksPanel').then((module) => ({ default: module.OwnWorksPanel }));
export const loadOwnWorksSheet = () => import('./OwnWorksSheet').then((module) => ({ default: module.OwnWorksSheet }));
