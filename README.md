# Cut Melom (Web POC)

通过摄像头捕捉**单手食指轨迹**来“切水果”的 Web 原型（MVP）。

## MVP 规格（默认）

- 平台：Web（Chrome/Safari/Edge）
- 手势：单手食指指尖轨迹（Index fingertip）
- 玩法：60 秒计时、5 条命、炸弹扣命（或直接结束）
- 验收口径：室内正常光线、正对摄像头、30fps 左右可玩、连续切割漏判不明显
- 规格详情：`docs/mvp-spec.md`

## 运行

摄像头权限要求：**HTTPS 或 localhost**。

本地启动一个静态服务器即可（推荐）：

```bash
cd /Users/donke/Project/Vibe/cut-melom
python3 -m http.server 5173
```

浏览器打开：

- `http://localhost:5173`

如果你用手机测试，需要把服务器端口映射出来并使用 HTTPS（或同一局域网下 iOS/Safari 可能会拦截非 HTTPS 摄像头）。

更多部署/手机测试说明见：`docs/deploy.md`。

## 配置项（在页面右上角）

- `Sensitivity`：轨迹速度阈值（越小越容易触发切割）
- `Smoothing`：指尖坐标平滑系数（越大越稳但更延迟）
- `Show Debug`：显示手部关键点/轨迹调试信息

## 操作

- Pause：左上角 `Pause` 按钮，或键盘 `P`
