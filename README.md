# AEGIS // ORBITAL — 3D 全球实时情报与态势指挥大屏

🌐 **在线实时体验（Live Demo）**：[https://aegis-orbital-drab.vercel.app](https://aegis-orbital-drab.vercel.app/)

一套面向大屏/副屏与日常桌搭的**科幻战情室 3D 实时地球指挥台**，基于 **Next.js (App Router) + Three.js 自定义 GLSL 着色器 + SGP4 卫星轨道推演 + 多源全球公开遥测 API** 打造，**零 API Key 即可开箱即用、直接部署至 Vercel**。

## 核心亮点

### 视觉与 3D 引擎（好看）
- **自研 GLSL 地球着色器**：根据当前精确 UTC 天文太阳赤纬与时差实时渲染**全球晨昏线（Day/Night Terminator）**、暮光橙蓝大气散射带、日面海面太阳高光与夜面城市灯光。
- **零外链依赖的 2048×1024 高清程序化地球**：内置 Natural Earth 110m 矢量地理拓扑，客户端毫秒级生成昼夜/高光贴图并叠加 3D 矢量海岸线，彻底杜绝海外贴图 CDN 加载失败。
- **3 套 OKLCH 战术视觉主题**：深空冰蓝 (`Orbital Cyan`) · 战术雷达绿 (`Tactical Phosphor`) · 阿波罗琥珀 (`Apollo Amber`)，瞬切无拖影；支持可选 CRT 扫描线滤镜与 **纯净桌搭 Zen 模式 (`H`)**。
- **全息态势图层**：地震脉冲冲击波、3D 卫星轨道与星下点覆盖圈、海底光缆流光数据包、主动目标锁定十字准星与防闪烁屏幕投影标签。

### 实时情报与日常实用性（实用）
全部通过 Next.js `/api/*` 路由代理并带 CDN 缓存头与优雅离线降级：
1. **全球实时地震波 (`/api/quakes`)** — 接入 USGS 过去 24 小时 M2.5+ 全球地震数据、震源深度与海啸标志。
2. **实时在轨航天器追踪 (`/api/satellites`)** — 接入 CelesTrak / WhereTheISS 实时 TLE 根数，本地 `satellite.js` 每 1.5 秒实时 SGP4 推演 **国际空间站 (ISS)、中国空间站 (天和核心舱)、哈勃望远镜、风云三号 E、NOAA-20、哨兵-2A、陆地卫星-9、星链与 GPS III**，支持一键相机锁星追踪！
3. **全球活跃自然灾害 (`/api/events`)** — 接入 NASA EONET v3（山火、活火山、热带风暴、极地冰山）。
4. **空间天气与地磁暴监测 (`/api/space-weather`)** — 接入 NOAA SWPC 实时 Kp 指数、太阳风速、行星际磁场 Bz 与 24 小时柱状趋势。
5. **点击地球任意点探测实时气象 (`/api/weather`)** — 接入 Open-Meteo，点击任意城市、地震点、事件或地球表面任意经纬度，立即返回当地实时气温、体感温度、风速风向、湿度、气压及距基准城市的直线距离。
6. **副屏日常监控 (`/api/intel`)** — 全球多时区实时世界时钟（UTC/北京/东京/伦敦/纽约）、BTC/ETH/SOL/黄金(PAXG) 24H 行情与迷你折线、Hacker News 实时前沿科技信号流。

## 快捷键
- `⌘K` / `Ctrl+K` 或 `/`：全局瞬移搜索（地震、卫星、灾害、全球枢纽）
- `Space`：暂停 / 恢复地球自转
- `H`：切换纯净桌搭模式（隐藏侧栏）
- `T`：切换三套战术主题
- `L`：切换中文 / English 双语界面

## 本地运行

```bash
pnpm install
pnpm dev
```

## 一键部署到 Vercel

### 方式一：GitHub 导入（推荐）
1. 将本仓库推送到 GitHub。
2. 登录 [Vercel Dashboard](https://vercel.com/new) → Import Git Repository。
3. 无需配置任何环境变量（全部公开免密遥测源），直接点击 **Deploy** 即可上线。

### 方式二：Vercel CLI 命令行直推
```bash
npx vercel --prod
```
