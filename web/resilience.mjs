// 会话韧性策略（纯函数，node:test 直测；player.mjs 按此决策接线）。
// 版本哨兵：「换版」只看 version|sha（前端代码是否更新）；boot 只用于报平安——
// 同镜像重启时会话与存档都在 SQLite，客户端无需任何动作，弹回封面纯属误伤。
// 断线自愈：4xx（除 408/429）是永久失败，重试只会原地打转；其余按拍退避，
// 部署窗口的失联通常数十秒内回来。

/** 换版指纹：优先内容 bundle；旧服务端没有 bundle 时回退 version|sha。 */
export const codeOf = v => v.bundle ? `bundle:${v.bundle}` : `${v.version}|${v.sha}`;

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
