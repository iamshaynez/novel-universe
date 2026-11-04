// 存档展示与排序的统一口径：updatedAt 是最后保存，不是最近打开。
const SQLITE_UTC = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;

export function parseSaveTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= 8_640_000_000_000_000 ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const parsed = Date.parse(SQLITE_UTC.test(text) ? `${text.replace(' ', 'T')}Z` : text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function saveTimestamp(doc) {
  return parseSaveTime(doc?.updatedAt) ?? parseSaveTime(doc?.createdAt);
}

export function compareSaveDocs(a, b) {
  const at = saveTimestamp(a), bt = saveTimestamp(b);
  if (at === null && bt !== null) return 1;
  if (at !== null && bt === null) return -1;
  if (at !== bt) return bt - at;
  return String(a?.id ?? '').localeCompare(String(b?.id ?? ''));
}

export function formatSaveTime(doc) {
  const timestamp = saveTimestamp(doc);
  if (timestamp === null) return '时间未知';
  const date = new Date(timestamp), pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function resumeSave(saves) {
  return [...saves].sort(compareSaveDocs).find(doc => !doc.deleted && !doc.summary?.ended) ?? null;
}

export function saveViewModel(doc, game = {}) {
  const ended = doc.summary?.ended ?? null;
  return {
    id: doc.id,
    gameId: doc.gameId,
    title: game.title ?? doc.gameId ?? '未知作品',
    chapter: doc.summary?.chapterTitle ?? '未记录章节',
    shortId: String(doc.id).slice(0, 8),
    kind: doc.note ?? (doc.forkOf ? '分支存档' : ''),
    progress: ended ? `已通关 · ${ended}` : '进行中',
    sync: doc.dirty ? '待同步' : '已同步',
    timestamp: saveTimestamp(doc),
    time: formatSaveTime(doc),
  };
}
