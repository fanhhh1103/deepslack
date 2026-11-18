# 🐳 TokenPet · AI娘算力桌宠

> **把每天烧掉的真实 AI Token，变成桌面右下角活灵活现的 Q 弹陪伴宠！**  
> `大肥鱼 (DeepSeek)` · `大橘 (Claude)` · `白龙 (ChatGPT)` · `星猫 (Gemini)` · `Grok娘 (Grok)`

---

## ✨ 核心亮点

1. **实时算力转速表 × 摸鱼小女仆生态**：
   - 实时监测本地 Token 消耗速率（`freshTokensPerSec` 12s 窗口 + EMA 平滑），自动切换 **摸鱼 / 慢炖 / 全力 / 红温冒烟** 4 档姿态与特效（拍键盘、彩虹光、冒烟火星、跑完瘫倒）。
   - 长期空闲自动进入摸鱼姿态；鼠标移入抓包时还会慌张假装敲键盘；支持桌面自由溜达、边缘探头张望、拎起晃动眩晕、丢玩具/投喂叠饭碗塔。
2. **软萌呼吸 Q 弹渲染 & 零版权程序化音效**：
   - 基于二阶弹簧动力学与体积守恒挤压的原创 Canvas 渲染器 + 原创 Web Audio 八音盒/街机程序化音效。
   - 支持一键切换 **大肥鱼 / 大橘 / 白龙 / 星猫 / Grok娘**，原生 Tauri v2 全透明无边框置顶窗口，托盘菜单一键置顶、自由溜达、重置位置。
3. **隐私安全 · 纯本地只读统计**：
   - 仅在本地只读统计当日 `~/.claude`、`~/.codex`、`~/.gemini/antigravity-cli` 新增 Token 数量，**绝不读取对话正文、密钥或上传任何数据**。
4. **内置可切换轻肉鸽小游戏模块**：
   - 代码仓库内保留了《幸运房东》风格的九宫格算力老虎机引擎（`src/game/`），默认通过 [`src/config.ts`](./src/config.ts) 中的 `ENABLE_SLOT_MACHINE = false` 关闭以保持纯享桌宠体验，需要时可自行开启。

---

## 🚀 快速启动

### 方式一：macOS 双击一键启动
直接双击根目录下的 **[`启动桌宠.command`](./启动桌宠.command)**：
- 若已构建原生 `.app` 或二进制，将直接唤醒桌面透明桌宠；
- 若尚未构建，将自动编译（需安装 Rust/Cargo）或启动浏览器全功能预览版。

### 方式二：Web 浏览器预览与调试
```bash
npm install
npm run dev
```
打开 `http://127.0.0.1:5173`，即可在浏览器中预览全部桌宠动画、物理交互与投喂玩法。

### 方式三：运行测试与构建原生应用
```bash
# 类型检查与单元测试
npm run typecheck
npm test

# 构建前端静态产物 (dist/)
npm run build

# 运行 Rust 单元测试并构建原生 Tauri 应用
cd src-tauri && cargo test && cargo build --release
```

---

## 📜 开源协议与署名

MIT License · Created by **[@evanpunk2077](https://x.com/evanpunk2077)**（角色设定源自漫画X企划）
