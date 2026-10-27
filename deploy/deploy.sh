#!/bin/bash
# 快速部署/更新脚本
# 使用方法: ./deploy/deploy.sh YOUR_ECS_IP
# 例如: ./deploy/deploy.sh 8.210.xxx.xxx

set -e

if [ -z "$1" ]; then
    echo "用法: $0 <ECS_IP>"
    echo "例如: $0 8.210.123.45"
    exit 1
fi

ECS_IP=$1
ECS_USER=${2:-root}

echo "=============================="
echo " 部署到 $ECS_USER@$ECS_IP"
echo "=============================="

# 1. 本地构建
echo "[1/4] 构建生产版本..."
npm run build

# 2. 打包 dist
echo "[2/4] 打包文件..."
cd dist
zip -r ../dist.zip .
cd ..

# 3. 上传文件到 ECS
echo "[3/4] 上传到服务器..."
scp dist.zip $ECS_USER@$ECS_IP:/tmp/dist.zip
scp deploy/nginx.conf $ECS_USER@$ECS_IP:/tmp/nginx-ai-video.conf

# 4. 首次部署 or 更新
echo "[4/4] 远程执行部署..."
ssh $ECS_USER@$ECS_IP 'bash -s' < deploy/setup-server.sh

# 清理本地临时文件
rm -f dist.zip

echo ""
echo "部署完成! 访问: http://$ECS_IP"
echo ""
