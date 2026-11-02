// 会话韧性策略（纯函数，node:test 直测；player.mjs 按此决策接线）。
// 版本哨兵：「换版」只看 version|sha（前端代码是否更新）；boot 只用于报平安——
// 同镜像重启时会话与存档都在 SQLite，客户端无需任何动作，弹回封面纯属误伤。
// 断线自愈：4xx（除 408/429）是永久失败，重试只会原地打转；其余按拍退避，
// 部署窗口的失联通常数十秒内回来。

/** 换版指纹：优先内容 bundle；旧服务端没有 bundle 时回退 version|sha。 */
export const codeOf = v => v.bundle ? `bundle:${v.bundle}` : `${v.version}|${v.sha}`;

/** 换版执行计划：决不让部署打断进行中的体验。
 *  defer    —— 页面刚落地（章节卡/开场演出/SW 落位窗口），稍后重评；
 *  wait-stop —— 局内：置 forceUpdate，由 runLoop 在停点（拍间隙）换版；
 *  reload-now —— 封面无局或结局页（天然停点）：直接换。 */
export function updatePlan({ running, endcard, pageAgeMs, freshBootMs = 15000 }) {
  if (pageAgeMs < freshBootMs) return { act: 'defer' };
  if (running) return { act: 'wait-stop' };
  return { act: 'reload-now' }; // 封面与结局页都没有进行中的拍
}

/** 出身指纹 base 对最新对时 next 的哨兵动作：observe 认定出身 / reload 换版 / notice 重启报平安 / none 沉默。 */
export function sentinelAction(base, next) {
  if (!base) return 'observe';
  if (codeOf(base) !== codeOf(next)) return 'reload';
  if (base.boot !== next.boot) return 'notice';
  return 'none';
}

/** 永久性失败（重试无意义）：4xx 一律放弃，仅超时 408 与限流 429 例外。 */
export const isFatalStatus = status =>
  status != null && status >= 400 && status < 500 && status !== 408 && status !== 429;

/** 重连退避：第 attempt 次等待毫秒数，1s 起步逐次 +1s，封顶 5s。 */
export const retryDelayMs = attempt => Math.min(1000 + attempt * 1000, 5000);

/** 开卷续档策略：自动进局必须是可预期的行为，不是每次开页的劫持。
 *  只有「PWA 独立窗口重开 + 标记新鲜（默认 7 天）」才直进上次的档——这保住 PWA
 *  重开不摔封面的初衷；普通浏览器访问一律落封面，由显式续读入口进入。
 *  上次崩溃的档（brokenId）不再自动进：坏档 × 自动续档不得成环。 */
export function resumePlan({ marker, brokenId = null, nowMs, standalone = false, freshMs = 7 * 24 * 3600 * 1000 }) {
  if (!marker?.saveId) return { act: 'title' };
  if (brokenId && brokenId === marker.saveId) return { act: 'title', reason: 'broken' };
  const fresh = Number.isFinite(marker.at) && nowMs >= marker.at && nowMs - marker.at <= freshMs;
  if (!fresh) return { act: 'title', reason: 'stale' };
  if (!standalone) return { act: 'title', reason: 'browser' };
  return { act: 'resume' };
}

/** 手动「检查并更新」决策（用户点了版本指纹就立即生效，不受停点保护约束）：
 *  current   —— 页面指纹与服务器一致：已是最新，不动；
 *  activate  —— 有新版且 SW 通道在场：等新壳装完（installing/waiting）→ skipWaiting 激活；
 *  reload    —— 有新版但无 SW 通道（或页面指纹未知）：直接重载，HTTP 层 no-cache 拉新；
 *  offline   —— /api/version 不可达：提示稍后再点，绝不瞎刷新。 */
export function manualUpdatePlan({ pageCode, serverCode, swReady }) {
  if (!serverCode) return { act: 'offline' };
  if (pageCode != null && pageCode === serverCode) return { act: 'current' };
  return swReady ? { act: 'activate' } : { act: 'reload' };
}
