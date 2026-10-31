# dsh-guardian-boot

给 **DeepSeek Harness** 的启动界面：15.8 秒唤醒序列，青蓝全息层 + 暖金核心 + 六节点编排图，三句语音 + 中文字幕 + 实时频谱。

![预览](docs/preview.webp)

## 安装

```bash
# 先停掉正在运行的 dsh web，然后钉版本安装
dsh plugin --profile desktop add github:darkknight110/dsh-guardian-boot#v1.0.2
dsh web
```

或从 [Releases](https://github.com/darkknight110/dsh-guardian-boot/releases) 下载 `.tgz`：

```bash
dsh plugin --profile desktop add ./dsh-guardian-boot-1.0.2.tgz
```

> npm 包暂未发布；`dsh plugin add dsh-guardian-boot` 要等发版后才能用。

完全退出 DeepSeek Harness 后重新打开，即可看到启动序列。卸载：

```bash
dsh plugin --profile desktop remove dsh-guardian-boot
```

## 它会做什么

1. Host 半侧通过 `tapIndex` 在首页注入关键 CSS 和空的 `#guardian-root`。
2. `dsh.client` 客户端 bundle 挂载一层全屏 iframe，并把启动 HTML 与语音数据内联为 `srcdoc`。
3. 启动层不依赖 `/guardian/...` HTTP 路径，因此同时兼容 Web 的 `http://` 与桌面端的 `dsh-app://`。
4. 频次门（`sessionStorage`，一个标签页会话一次）通过后才创建 iframe。

启动序列播完或跳过时，遮罩整层移除、滚动锁解除、焦点交还输入框，并派发 `dsh-startup:done`。

## 操作

| 操作 | 行为 |
| --- | --- |
| 打开页面 | 自动播放；能自动出声就出声，被拦则画面先走 |
| 点击画面（首次） | 解锁声音并从头对齐播放 |
| `Esc` | 跳过，立即把界面交还宿主 |
| 13.82s 后 `Enter` / 点击 | 进入会话 |
| `Space` | 重播 |
| `M` | 开关声音 |
| `R` | 录制带声音的 WebM |

## 工程说明

| 决定 | 原因 |
| --- | --- |
| iframe 隔离 | 动画脚本假设自己是整个 document；隔离后零污染宿主，播完整层 `remove()` |
| 客户端 `srcdoc` | 桌面版使用 `dsh-app://`，不会自动映射插件新增的 HTTP 路由 |
| 后备存储按 `min(dpr,2)` 放大 | 逻辑坐标仍是 1920×1080，Retina 上画 3840×2160 |
| 32s 兜底卸载 | iframe 挂了或用户不操作，主界面不会被永久遮住 |
| 终幕持续 RAF | 等待确认时核心和节点网络保持运转，不冻结 |

## 兼容性

- 在 **DSH 0.2.1-rc.5 / desktop profile / macOS** 实测通过。
- Web profile 与 Windows 继续走同一客户端 bundle。
- 首次播放声音需要一次点击（浏览器的自动播放策略，插件无法绕过）。

## 风险与回滚

插件加载失败会导致 `dsh web` 无法启动。遇到这种情况，先停掉进程再移除插件：

```bash
dsh plugin --profile web remove dsh-guardian-boot
```

## 许可

[MIT](LICENSE) © 2026 darkknight110

本插件为社区作品，与 DeepSeek 官方无隶属关系，未获官方背书。“DeepSeek”“DeepSeek Harness” 相关权利归其所有者。
