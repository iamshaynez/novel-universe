// 发布目录合并与作品读取通道：公开内容可缓存，admin 草稿只走在线 API。
export function mergeGameCatalog(publicGames, allGames, isAdmin) {
  if (!isAdmin) return publicGames;
  const published = new Map(publicGames.map(game => [game.id, game]));
  return allGames.map(game => {
    const publicEntry = published.get(game.id);
    return {
      ...game,
      irUrl: publicEntry?.irUrl ?? null,
      irHash: publicEntry?.irHash ?? null,
      preview: !game.published,
    };
  });
}

export function gameIrRequest(meta, user) {
  if (!meta) throw new Error('作品不存在或尚未开放');
  if (meta.preview) {
    if (!user?.admin) throw new Error('作品不存在或尚未开放');
    return { url: `/api/games/${meta.id}`, preview: true, cache: false };
  }
  if (!meta.irUrl) throw new Error('作品内容尚未就绪，请联网后重试');
  return { url: meta.irUrl, preview: false, cache: true };
}
