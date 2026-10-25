# 单体部署：零依赖 Node 24，无构建步骤（服务启动时编译剧本）。
FROM node:24-alpine

# 版本指纹通道：构建侧可注入部署 sha（容器内无 .git，缺省回退 snapshot）
ARG NU_SHA=snapshot

WORKDIR /app
COPY package.json ./
COPY engine/ engine/
COPY games/ games/
COPY universe/ universe/
COPY web/ web/
COPY server/ server/
COPY tools/ tools/

ENV PORT=3000 \
    DB_PATH=/data/novel.db \
    NU_SHA=${NU_SHA}
VOLUME ["/data"]
EXPOSE 3000

# 启动即自检：迁移 + 编译全部游戏，失败则拒绝上线
CMD ["node", "server/index.mjs"]
