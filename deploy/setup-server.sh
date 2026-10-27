#!/bin/bash
# AI Video Gen - 一键部署脚本
# 使用方法: ssh root@YOUR_ECS_IP 后执行此脚本
# 或者: ssh root@YOUR_ECS_IP 'bash -s' < deploy/setup-server.sh

set -e

echo "=============================="
echo " AI Video Gen 服务器初始化"
echo "=============================="

# 1. 系统更新 & 安装 nginx
echo "[1/4] 安装 nginx..."
apt-get update -qq
apt-get install -y nginx unzip

# 2. 创建网站目录
echo "[2/4] 部署网站文件..."
mkdir -p /var/www/ai-video-gen

# 如果存在上传的 dist.zip，解压到网站目录
if [ -f /tmp/dist.zip ]; then
    rm -rf /var/www/ai-video-gen/*
    unzip -o /tmp/dist.zip -d /var/www/ai-video-gen/
    rm /tmp/dist.zip
    echo "    网站文件已部署"
else
    echo "    警告: 未找到 /tmp/dist.zip，请稍后手动上传"
fi

# 3. 配置 nginx
echo "[3/4] 配置 nginx..."
if [ -f /tmp/nginx-ai-video.conf ]; then
    cp /tmp/nginx-ai-video.conf /etc/nginx/sites-available/ai-video-gen
    rm -f /etc/nginx/sites-enabled/default
    ln -sf /etc/nginx/sites-available/ai-video-gen /etc/nginx/sites-enabled/ai-video-gen
    rm /tmp/nginx-ai-video.conf
else
    echo "    警告: 未找到 nginx 配置文件，请手动配置"
fi

# 4. 测试并重启 nginx
echo "[4/4] 启动 nginx..."
nginx -t
systemctl enable nginx
systemctl restart nginx

echo ""
echo "=============================="
echo " 部署完成!"
echo "=============================="
echo ""
echo "访问: http://$(curl -s ifconfig.me)"
echo ""
echo "如需更新部署，运行:"
echo "  scp dist.zip root@YOUR_IP:/tmp/"
echo "  ssh root@YOUR_IP 'unzip -o /tmp/dist.zip -d /var/www/ai-video-gen/ && rm /tmp/dist.zip'"
echo ""
