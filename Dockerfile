# 单体部署：零依赖 Node 24，无构建步骤（服务启动时编译剧本）。
FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY engine/ engine/
COPY games/ games/
COPY universe/ universe/
COPY web/ web/
COPY server/ server/
COPY tools/ tools/

ENV PORT=3000 \
    DB_PATH=/data/novel.db
VOLUME ["/data"]
EXPOSE 3000

# 启动即自检：迁移 + 编译全部游戏，失败则拒绝上线
CMD ["node", "server/index.mjs"]
