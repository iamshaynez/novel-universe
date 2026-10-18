# novel-universe · 雾川市悬疑宇宙

人物、地点、核心时间线全宇宙共享，每部作品故事独立。零依赖 Node 24 原生方案
（ESM + `node:test` + `node:http` + `node:sqlite`），前后端一体，Docker 单体部署。

> 协作准则见 [AGENTS.md](AGENTS.md)（架构宪法 → 研发标准 → 分支标准），
> 架构详见 [docs/提案-架构-v0.md](docs/提案-架构-v0.md) 与 [docs/ADR/](docs/ADR/)。

## 快速开始

```bash
npm test            # 单测 + 属性 + API 集成 + e2e 全分支（无网络、无浏览器依赖）
npm run verify      # 全游戏：编译 + canon-lint + 图校验 + 结局全可达
npm run demo        # 启动 http://127.0.0.1:3000（启动即迁移 + 编译）
```

演示模式：打开 `http://127.0.0.1:3000/?auto=1` 自动开局并推进到首个选择点（截图/冒烟用）。

## 目录

```
engine/    纯函数 VN 内核（无 I/O/DOM；同 IR + 同选择序列 → 同结果）
universe/  正典 canon：人物/地点/时间线/风格令牌（单一事实源）
assets/    chibi 人物组件 / scenes 场景配方 / scores 乐谱代码（浏览器实时合成）
games/     每作一个目录（g00-demo 为脚手架验证作；_template 为新作模板）
server/    node:http + node:sqlite；迁移落 server/migrations/NNN-*.sql
web/       播放器（原生 ESM，零打包）
tools/     compile-scenario / canon-lint / verify / new-game / render-bgm
```

## 开发一部新游戏

```bash
node tools/new-game.mjs g01-first-case 第一案
# 改 games/g01-first-case/game.json（code/assumes/canon 范围）
# 写 chapters/*.md（DSL 语法见 docs/ADR/003）
npm run verify   # 剧透纪元、资产引用、分支图、结局可达性全检
npm test
```

## 数据库

```bash
npm run migrate           # 应用迁移（服务启动时也会自动应用）
npm run migrate:status    # 提交前必须无 pending
```

## Docker

```bash
docker build -t novel-universe .
docker run -p 3000:3000 -v nu-data:/data novel-universe
```

本机 Docker 守护进程未运行时跳过构建，Dockerfile 无构建步骤（服务启动时编译剧本），镜像极薄。

## 测试地图

| 文件 | 覆盖 |
|---|---|
| engine.test.mjs | 推进/选择/守卫/存档回放/确定性 |
| compiler.test.mjs | DSL→IR 结构、视图绝对化、六种编译错误 |
| graph.test.mjs | 图校验 + 变异测试（断链/环/死路必须被抓到） |
| canon-lint.test.mjs | 剧透纪元拦截、assumes 解锁、版本范围 |
| migrate.test.mjs | 迁移应用/幂等/事务回滚、CRUD |
| api.test.mjs | 真实 HTTP 全路由、错误码、路径穿越防护 |
| e2e.test.mjs | **全分支**：静态枚举 5 条路径逐条真机走通，结局/落库/确定性断言 |

## 既有实验

`style-tests/` 保留了立项阶段的艺术/音频可行性验证（7 个零依赖页面），`tools/render-bgm.mjs`
可离线渲染乐谱为 WAV（种子确定 → MD5 一致）。
