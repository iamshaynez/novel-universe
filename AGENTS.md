# AGENTS.md

本文件是 AI 编码代理与协作者在本仓库的最高行动准则。**任何变更都必须同时满足：架构宪法 → 研发标准 → 分支标准。** 三者冲突时以本文件为准；本文件未覆盖的以 `docs/提案-架构-v0.md` 与 `docs/ADR/` 为准。

## 1. 架构宪法（不可违背）

零依赖 Node 24 原生方案（原生 ESM + `node:test` + `node:http` + `node:sqlite`），前后端一体单进程，Docker 单体部署。

| 原则 | 含义 |
|---|---|
| 内核纯函数 | `engine/` 不碰 I/O / DOM / DB；同 IR + 同选择序列 → 同结果，存档即回放 |
| 内容即数据 | 剧本住 `games/*/chapters/*.md`（DSL），设定住 `universe/*.json`（正典）；改内容不动代码 |
| 编译即加载 | 无 dist 中间态；服务启动时编译全部游戏，编译/图校验失败则拒绝启动 |
| 剧透纪元 | 每条正典数据带 `disclosed_in`/`first_appearance`，每作声明 `assumes`；**越前引用直接 lint 失败**，这是共享宇宙的核心保护 |
| 文字舞台 | 排版即运镜：呼吸节奏、实体视觉签名（人物=声纹/分侧站位、地点=印章/氛围、时间=轴带、线索=解锁）、动态范围（峰值每章限量）；演出由 IR+canon 自动推导，剧本零演出标注（ADR-004）；e2e 不依赖浏览器与音频，引擎层回放即测试 |
| 模块化单体 | 单进程单库，目录严格分层 |

**依赖方向强制单向**：`web(演出) → server(编排) → engine(纯内核) ← tools(编译/lint)`；`games → {universe, assets, engine}`。禁止反向 import。

**分层归属**：剧本/文案 → `games/`；设定/数值 → `universe/`；规则逻辑 → `engine/`；接入与编排 → `server/`；界面与演出 → `web/`；编译与校验 → `tools/`。跨层改动在 PR 描述中说明。

## 2. 研发标准（每次变更的完成定义）

变更循环：`场景测试(红) → 实现/内容改动(绿) → 自测通过 → PR 评审`。

1. **TDD**：新机制先补 `test/` 场景测试（用游戏业务语言命名）再写实现；图校验类改动另加变异测试（故意断链/造环必须被抓到）。
2. **测试命令**：合并前本地 `npm test`（单测+编译+lint+API+e2e 全量）与 `npm run verify`（编译+剧透纪元+图校验+结局全可达）全绿才允许开 PR。
3. **确定性**：随机只允许存在于边界（server 建档 seed）；`engine/` 内禁止 `Math.random()`/`Date.now()`；乐谱 = 种子 + 参数，同种子离线渲染 MD5 必须不变。
4. **数据库变更**：落 `server/migrations/NNN-名称.sql`，事务内执行、幂等、编号不复用；提交前 `npm run migrate:status` 必须无 pending。内容包（universe/games）变更不走 schema 迁移。
5. **正典变更**：新增条目/字段 = canon minor；改含义/删条目 = major（破坏性，独立 PR 评审）。游戏在 `game.json` 声明 `canon` 版本区间；canon 破坏性变更导致全游戏 lint 变红是预期行为，不许为消红放宽区间。
6. **剧本变更**：DSL 语法以 `docs/ADR/003` 为合同；改剧本必须过 verify（目标存在、选项不落穿、结局全可达、资产引用齐全）。
7. **素材纪律**：人物 = 正典字段（`voice_hz` 声线 + `stage{side,theme}` 站位主题色）；场景 = 地点 `mood` 氛围参数（palette/rain/sign/bigchar）+ 播放器配方；调色板 = `universe/tokens.json` stage 令牌（与 `web/index.html` CSS 变量对齐，改一处同步一处）。音效/BGM 全部代码合成（`web/audio.mjs`），零素材文件。乐谱模块化（种子+参数）列为舞台合同 v1 待办。
8. **零依赖**：新增 npm 依赖视为架构例外，必须先在 ADR 记录理由并获批准；前端不做打包，原生 ESM 直出。
9. **配置**：env 单入口（`PORT`、`DB_PATH`）+ fail-fast 校验。

## 3. 分支标准（唯一提交流程）

```
feat/fix 分支 → PR → dev（集成）→ PR → release（预发）→ PR → main（发布）
```

1. 从 `dev` 拉分支，命名 `feat/<功能>` / `fix/<问题>`，小写连字符（如 `feat/chapter-title-card`）；PR 目标恒为 `dev`。
2. CI 门（`feat-pr-dev-release` workflow：`npm test` + `npm run verify` + `npm run migrate` 幂等）绿才可合并；单人项目审批 0 人可自合并，但测试门不可豁免——CI 与本地自测是同一套命令，本地绿了 CI 才会绿。
3. `dev → release` 预发 PR 与 `release → main` 发布 PR 过同一套门；发布门（`pr-main` workflow）额外构建 Docker 镜像冒烟。
4. 合并统一 squash；合并后源分支删除，禁止复用已合并分支。
5. 发布打 tag（在 `main` 上）：`gNN-vX.Y.Z`（每部作品独立版本线）。
6. hotfix：从 `main` 拉 `fix/` 分支，PR 直进 `main`（过 `pr-main` 门）；合并后立即把 `main` 回同步进 `dev` 与 `release`。
7. 禁止 force push、删除 `main`/`dev`/`release`、绕过测试门提交。

## 4. AI 代理特别约束

- 开新游戏用 `node tools/new-game.mjs <slug> [标题]`，从 `games/_template` 起步；改 `game.json` 的 `code`/`assumes`/`canon` 区间后再写章节。
- 改编或新写悬疑作，按 `docs/指南-悬疑小说拆解-v1.md` 的阶段顺序执行：立项审查 → 真相正典化 → 线索系统（释放矩阵）→ 游戏结构（门禁）→ 剧本 → 演出标注 → 公平性审查。每个阶段的完成门不满足不得进入下一阶段。
- 正典披露物只能通过「本作新增」或「assumes 已含前作」引用；**绝不许为绕过纪元 lint 修改 universe 的披露标记**。
- 不许为图省事绕过测试或降级要求；不许引入未批准依赖；不许在引擎层加 I/O。
- 评审三合一：正典 diff（设定）+ 剧本/代码 diff + 测试 diff，缺任何一项的 PR 不得合并。
- 演出类改动（氛围层/声纹/舞台词汇/播放器）至少附一张真实渲染截图或 MD5 校验产物作为证据（存 `docs/演出证据/`）。

## 5. 速查

```bash
npm test              # 全量测试（61+，含 e2e 全分支）
npm run verify        # 编译 + lint + 图 + 可达性
npm run demo          # http://127.0.0.1:3000（文字舞台播放器，?auto=1 冒烟）
npm run migrate:status
node tools/new-game.mjs g01-xxx 标题
```

目录：`engine/` 内核 · `universe/` 正典 · `games/` 作品 · `server/` 服务+迁移 · `web/` 文字舞台播放器 · `tools/` 工具链 · `test/` 测试 · `docs/` 提案、ADR 与创作指南 · `docs/演出证据/` 演出截图归档。
