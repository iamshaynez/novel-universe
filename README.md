# novel-universe · 雾川市悬疑宇宙(文字舞台)

人物、地点、核心时间线全宇宙共享,每部作品故事独立。零依赖 Node 24 原生方案
(ESM + `node:test` + `node:http` + `node:sqlite`),前后端一体,演出层为**文字舞台**:
排版即运镜,人物/地点/时间/线索各有视觉签名,全部由代码合成、零美术素材。

> 协作准则见 [AGENTS.md](AGENTS.md)(架构宪法 → 研发标准 → 分支标准),
> 架构详见 [docs/ADR/](docs/ADR/)(004 = 文字舞台转向)与
> [docs/指南-悬疑小说拆解-v1.md](docs/指南-悬疑小说拆解-v1.md)(小说 → 游戏的创作框架)。

## 快速开始

```bash
npm test            # 单测 + 属性 + API 集成 + e2e 全分支(无网络、无浏览器依赖)
npm run verify      # 全游戏:编译 + canon-lint + 图校验 + 结局全可达
npm run demo        # 启动 http://127.0.0.1:3000(启动即迁移 + 编译,失败拒绝上线)
```

播放器:`npm run demo` 后打开 `http://127.0.0.1:3000`,点击/空格推进,揭示中点击快进。
停点可上下拖动、滚轮/触控板滚动,或用 `↑ / ↓ / PageUp / PageDown` 回看本章已展示文字;
回看后的第一次轻点/空格只回到最新位置,第二次才推进,不会在翻历史时误进下一拍。
冒烟:`?auto=1` 自动开局推进到首个选择点(截图/CI 用)。

首页点「安装到手机」可安装为独立窗口应用；Android/桌面 Chromium 使用原生安装提示，
iPhone/iPad 会显示 Safari「分享 → 添加到主屏幕」步骤。断网只显示离线提示页，
账号、进度与 `/api/` 响应不进入离线缓存。分享首页时使用 `web/og-card.png`（1200×630），
对应 Open Graph 与 Twitter 大图元数据；可编辑源文件为 `web/og-card.svg`。

## 演出词汇(自动层,剧本零标注)

| 实体 | 视觉签名 | 数据来源 |
|---|---|---|
| 人物 | 声纹卡(voice_hz 波形签名)+ 左右分侧锚点 + 主题色台词 | `characters/*.json` 的 `voice_hz` + `stage{side,theme}` |
| 地点 | 印章转场 + 氛围层(黄昏/雨夜/环境大字/霓虹戏中字) | `locations/*.json` 的 `mood` |
| 时间 | 常驻时间轴带(事件红点/今夜金点) | `timeline.json` |
| 线索 | 解锁 chip + 时间轴点亮 | 剧本 `@fact` |
| 导读 | 双轨日期、四留言对照、证物持有人、债务关系、地点示意、结局回读；只展开已读信息 | `game.json` 的 `reading` + `tr.*` / `paper.*` / `aid.*` + 当前 state |
| 行内色彩 | 人名=浓墨账本线；地点=朱砂印章；事件/线索=朱砂纸签；日期/时刻/号码=冷青放大标记；组织=暗金骑缝线 | 纪元过滤后的 canon 摘要 + `web/markup.mjs` |
| 节奏 | 呼吸单元(标点驱动)、旧句上推变暗、分支生长选择 | 播放器 `web/stage.mjs` |

HUD「导读」提供轨迹、留言、证物、关系、地图与回读六个页签；结局卡的「回读轨迹」直达结局对照。
所有内容只按当前 state 渐进展开，读档后同样由 IR + flags 重建，不提前显示未来信息。

手工层特效(信纸开场/红笔圈词/坠落汉字/聚光灯/红绳连线)与证据截图见
[docs/演出证据/](docs/演出证据/),舞台指令合同 v1 待办见 ADR-004。

## 目录

```
engine/    纯函数 VN 内核(无 I/O/DOM;同 IR + 同选择序列 → 同结果)
universe/  正典 canon:人物/地点/时间线/演出令牌(单一事实源)
games/     每作一个目录(g00-demo 为文字舞台活样板;_template 为新作模板)
server/    node:http + node:sqlite;迁移落 server/migrations/NNN-*.sql
web/       文字舞台播放器(index.html + stage.mjs 词汇 + player.mjs 循环 + audio.mjs)
tools/     compile-scenario / canon-lint / verify / new-game
docs/      提案、ADR、创作指南、演出证据
```

## 开发一部新游戏

```bash
node tools/new-game.mjs g01-first-case 第一案
# 改 games/g01-first-case/game.json(code/assumes/canon 范围)
# 写 chapters/*.md(DSL 语法见 docs/ADR/003;创作全流程见 docs/指南-悬疑小说拆解-v1.md)
npm run verify   # 剧透纪元、分支图、结局可达性全检
npm test
```

## 数据库

```bash
npm run migrate           # 应用迁移(服务启动时也会自动应用)
npm run migrate:status    # 提交前必须无 pending
```

## Docker

```bash
docker build -t novel-universe .
docker run -p 3000:3000 -v nu-data:/data novel-universe
```

无构建步骤(服务启动时编译剧本),镜像极薄。

## 测试地图

| 文件 | 覆盖 |
|---|---|
| engine.test.mjs | 推进/选择/守卫/存档回放/确定性 |
| compiler.test.mjs | DSL→IR 结构、舞台合同 canon 块、视图合同 v0、废弃指令拦截、错误路径 |
| graph.test.mjs | 图校验 + 变异测试(断链/环/死路必须被抓到) |
| canon-lint.test.mjs | 剧透纪元拦截(事件/说话者/地点)、assumes 解锁、版本范围 |
| migrate.test.mjs | 迁移应用/幂等/事务回滚、CRUD |
| api.test.mjs | 真实 HTTP 全路由、错误码、路径穿越防护 |
| e2e.test.mjs | **全分支**:静态枚举 5 条路径逐条真机走通,结局/落库/确定性断言 |
| share-and-install.test.mjs | 首页 OG/Twitter 分享卡、Manifest/图标、安装入口、离线壳与静态 MIME |
