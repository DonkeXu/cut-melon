# Deploy / Testing Notes

## Why HTTPS matters

浏览器摄像头权限通常要求 **Secure Context**：
- ✅ `https://...`
- ✅ `http://localhost`
- ❌ `http://<server-ip>`（大多会被拒绝或行为不一致，尤其是 iOS/Safari）

## Local (recommended for MVP)

```bash
cd /Users/donke/Project/Vibe/cut-melom
python3 -m http.server 5173
```

打开 `http://localhost:5173`。

## Quick HTTPS options (when you need phone testing)

### Option A: reverse proxy via Nginx + certbot

把静态目录反代到域名（示意）：

```nginx
server {
  listen 443 ssl;
  server_name cut-melom.example.com;

  root /home/ubuntu/Project/Vibe/cut-melom;
  index index.html;

  location / {
    try_files $uri $uri/ /index.html;
  }
}
```

证书：

```bash
sudo certbot --nginx -d cut-melom.example.com
```

### Option B: Cloudflare Tunnel / localtunnel / ngrok

用于快速手机端测试，避免自己配证书。

> 注：这些工具依赖外网；如果公司/服务器网络限制，可能不可用。

