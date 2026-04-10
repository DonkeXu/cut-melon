# Cut Melom — Web POC MVP Spec

## Goal

做一个可玩的 Web 原型：用户在摄像头前用**单手食指**挥动，画面中水果被“刀痕”切开并计分，整体 30fps 左右可玩。

## Scope (MVP)

### Input
- 摄像头：`getUserMedia`（通过 MediaPipe Hands 的 Camera utils）
- 手势：单手食指指尖（landmark #8）
- 轨迹：短窗口（约 180ms）轨迹线
- 平滑：指数平滑（`Smoothing` 可调）

### Slice 判定
- 使用连续两帧指尖点形成的线段作为“刀刃”
- 刀刃速度阈值（`Sensitivity`，单位 px/s）达标才触发切割
- 线段到水果圆心距离 `< r * 1.05` 则判定切中

### Gameplay
- 60s 计时模式
- 生命值：5
- 水果：随机颜色圆形
- 炸弹：黑色圆形，切中扣 1 命（命耗尽结束）
- 漏接：水果落到屏幕底部扣 1 命
- 计分：每切中一个水果 +1

### Visual / UI
- 全屏 Canvas
- HUD：分数 / 生命 / 倒计时
- 切割轨迹：发光线条
- 粒子：简单散射粒子
- Overlay：Start/Restart + 错误提示（摄像头权限/加载失败）

## Out of Scope (后续)
- 双手/复杂手势（握拳、手掌挥砍等）
- 多种水果形状/贴图
- 真正的切割几何（半圆切面、材质等）
- 关卡/排行榜/多难度曲线
- 音效资源包（当前可用 WebAudio 生成简单音）

## Acceptance Criteria
- 室内正常光线 + 正对摄像头：能稳定看到指尖轨迹
- 连续挥动切水果：切中判定不明显漏判（主观可玩）
- 运行 1 分钟无明显卡顿（目标 30fps 左右）
