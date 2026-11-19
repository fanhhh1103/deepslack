# 🐳 DeepSlack · 深度摸鱼（烧币版）

**Turn your daily Claude Code / Codex / Antigravity token burn into a living anime desktop pet (macOS & Windows).**  
**一台靠烧真实 AI Token 喂养的赛博电子鸡——不烧算力就在桌面摸鱼，鼠标抓包就慌张假装深度思考；终端一狂跑就红温冒烟！**

[![Live Web Demo](https://img.shields.io/badge/🎮_3秒免安装试玩-Live_Web_Demo-2563eb?style=for-the-badge)](https://fanhhh1103.github.io/deepslack/)
[![Download Release](https://img.shields.io/badge/⬇️_下载安装包-macOS_%26_Windows-0f172a?style=for-the-badge)](https://github.com/fanhhh1103/deepslack/releases/latest)
[![MIT License](https://img.shields.io/badge/License-MIT-16a34a?style=for-the-badge)](./LICENSE)

<p align="center">
  <img src="./docs/demo.gif" alt="DeepSlack 大肥鱼实时算力桌宠演示" width="320" />
</p>

> `大肥鱼 (DeepSeek)` · `大橘 (Claude)` · `白龙 (ChatGPT)` · `星猫 (Gemini)` · `Grok娘 (Grok)`  
> 🌐 **懒得装客户端？点这里 3 秒网页直接试玩**：**[https://fanhhh1103.github.io/deepslack/](https://fanhhh1103.github.io/deepslack/)**

---

## ✨ 核心亮点

1. **实时算力转速表 × 摸鱼抓包反差萌**：
   - 本地实时监测 Claude Code (`~/.claude`)、Codex (`~/.codex`)、Antigravity (`~/.gemini/antigravity-cli`) 的 Token 消耗速率（`freshTokensPerSec` 12s 窗口 + EMA 平滑）。
   - 自动切换 **摸鱼 / 慢炖 / 全力 / 红温冒烟** 4 档姿态：闲着时抱鱼干看漫画，鼠标移入立刻抓包弹起“*咳！我没摸鱼，刚在深度思考！*”；狂烧 Token 时 4 帧机械键盘猛敲到红温冒烟、跑完累瘫。
2. **多帧丝滑动画 × 桌面自由交互**：
   - 二阶弹簧动力学 + 体积守恒果冻形变 + 等功率跨帧混切，支持 4 帧走路溜达、边缘探头、拎起狂摇眩晕、丢玩具/投喂叠青花饭碗塔、重锤拍飞小 Bug 与鲸鱼耳机摇摆听歌。
   - 原生 **Tauri v2** 全透明无边框置顶窗口，托盘菜单一键置顶、自由溜达、刷新快照与重置位置。
3. **100% 本地只读 · 隐私绝对安全**：
   - 仅在本地只读统计当日新增 Token 数量，**绝不读取任何对话正文、提示词、代码或 API 密钥，也不联网上传任何数据**。
4. **内置可切换轻肉鸽小游戏引擎**：
   - 仓库内保留了《幸运房东》风格的九宫格算力老虎机引擎（`src/game/`），当前通过 [`src/config.ts`](./src/config.ts) 中的 `ENABLE_SLOT_MACHINE = false` 默认保持纯享桌宠模式，方便后续或二开自行开启。

---

## ⬇️ 下载与安装（macOS & Windows）

前往 **[Releases 最新版本](https://github.com/fanhhh1103/deepslack/releases/latest)** 直接下载预编译安装包（无需配置 Rust/Node 环境）：

| 平台 | 推荐安装包 | 首次打开说明 |
| :--- | :--- | :--- |
| **macOS (Apple Silicon M1–M4)** | `DeepSlack_x.x.x_aarch64.dmg` | 拖入 Applications 后若提示“已损坏/未验证开发者”，终端执行：<br>`xattr -cr /Applications/DeepSlack.app` |
| **macOS (Intel)** | `DeepSlack_x.x.x_x64.dmg` | 同上 |
| **Windows 10 / 11 (x64)** | `DeepSlack_x.x.x_x64-setup.exe`（推荐，免管理员）或 `.msi` | 若 Windows SmartScreen 弹出拦截提示，点 **“更多信息” → “仍要运行”** |

---

## 🧑‍💻 开发者本地运行与构建

```bash
# 1. 安装依赖并启动浏览器试玩版
npm install
npm run dev

# 2. 类型检查、单测与前端构建
npm run typecheck
npm test
npm run build

# 3. 运行 Rust 扫描器单测并打包原生桌面应用
cd src-tauri && cargo test
npm run tauri build   # 或使用 macOS 根目录 ./启动桌宠.command 一键构建启动
```

---

## 📜 开源协议与署名

MIT License · Created by **[@evanpunk2077](https://x.com/evanpunk2077)**（角色设定源自漫画X企划）
