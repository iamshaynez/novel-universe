#!/bin/sh
# gb-test 服务器 /opt/apps/novel-universe/deploy.sh 的版本化副本——改动两处同步。
# 由 GitHub Actions 经受限 SSH 密钥触发（authorized_keys 强制命令锁定本脚本）：
#   拉镜像(3 次重试抗跨境瞬断) → 起容器 → 冒烟轮询(200/302/401 即就绪) →
#   失败 dump 容器日志并以非零退出把 CI 打红。
set -uo pipefail
cd /opt/apps/novel-universe || { echo "部署目录不存在"; exit 1; }

ok=0
for i in 1 2 3; do
  if docker compose pull; then ok=1; break; fi
  echo "pull 失败,第 $i 次重试"; sleep 8
done
[ "$ok" = 1 ] || { echo "ACR pull 三次均失败"; exit 1; }

docker compose up -d

for i in $(seq 15); do
  C=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:18084/ || true)
  case "$C" in
    200|302|401) echo "novel-universe 就绪($C,第 $i 轮)"; exit 0;;
  esac
  sleep 3
done

echo "novel-universe 未就绪"
docker logs novel-universe --tail 20
exit 1
