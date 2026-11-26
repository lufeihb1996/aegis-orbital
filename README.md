# AEGIS // ORBITAL — 3D 全球实时情报与态势指挥大屏

🌐 **在线实时体验（Live Demo）**：[https://aegis-orbital-drab.vercel.app](https://aegis-orbital-drab.vercel.app/)

一套面向大屏/副屏与日常桌搭的**科幻战情室 3D 实时地球指挥台**，基于 **Next.js (App Router) + Three.js 自定义 GLSL 着色器 + SGP4 卫星轨道推演 + 多源全球公开遥测 API** 打造，**零 API Key 即可开箱即用、直接部署至 Vercel**。

## 核心亮点

### 视觉与 3D 引擎（好看）
- **自研 GLSL 地球着色器（Apple Maps 级真昼夜高对比）**：内置自托管 2K NASA Blue Marble 白昼实景、Black Marble 黑夜城市灯光、地形高程阴影、海洋高光与独立旋转 3D 云层，按精确 UTC 天文太阳位置渲染实时晨昏线与暖橙暮光带。
- **🌌 3D 极光椭圆带（Aurora Oval）**：联动 NOAA 实时地磁 Kp 指数，在南北磁极圈渲染流动翡翠绿→紫红极光幕帘。
- **🌕 真实天文 3D 月球 & 太阳日冕光学眩光**：按真实黄经月相渲染实时阴晴圆缺的 3D 月球，视角转向太阳方向呈现电影级光学日冕炫光。
- **🌬️ 3D 全球动态风场流线**：GPU 单批渲染赤道信风、中纬西风急流，并自动围绕活跃热带风暴生成气旋涡流。
- **3 套 OKLCH 战术视觉主题**：深空冰蓝 (`Orbital Cyan`) · 战术雷达绿 (`Tactical Phosphor`) · 阿波罗琥珀 (`Apollo Amber`)，瞬切无拖影；支持可选 CRT 扫描线滤镜与 **纯净桌搭 Zen 模式 (`H`)**。

### 实时情报与日常实用性（实用）
全部通过 Next.js `/api/*` 路由代理并带 CDN 缓存头与优雅离线降级：
1. **全球实时航班雷达 (`/api/flights`)** — 接入 OpenSky ADS-B，在 3D 地球上以单批 InstancedMesh 实时巡航 200+ 架全球民航客机，点击查看航班号、高度、地速与航向。
2. **🕰️ 时间穿梭滑块（`-12h ~ +12h` & `600×` 延时摄影）+ 空间站过境预报** — 拖动时间轴实时预览晨昏线横扫与卫星掠过，右侧自动推演未来 24H **中国空间站 (天和) / ISS** 飞过基准城市的精确过境时刻与最大仰角，支持一键跳转预览。
3. **📐 战术大圆测距尺** — 按住 `Shift+点击` 或开启测距模式连点地球任意两处，绘制 3D 发光大圆航线并自动换算公里数、民航直飞航时、海底光缆往返延迟 (ms) 与初始航向角。
4. **全球实时地震波 (`/api/quakes`)** — 接入 USGS 过去 24 小时 M2.5+ 全球地震数据、震源深度与海啸标志。
5. **实时在轨航天器追踪 (`/api/satellites`)** — 接入 CelesTrak / WhereTheISS 实时 TLE 根数，本地 `satellite.js` 实时 SGP4 推演 **国际空间站 (ISS)、中国空间站 (天和核心舱)、哈勃望远镜、风云三号 E、NOAA-20、哨兵-2A、陆地卫星-9、星链与 GPS III**，支持一键相机锁星追踪！
6. **全球活跃自然灾害 (`/api/events`)** — 接入 NASA EONET v3（山火、活火山、热带风暴、极地冰山）。
7. **空间天气与地磁暴监测 (`/api/space-weather`)** — 接入 NOAA SWPC 实时 Kp 指数、太阳风速、行星际磁场 Bz 与 24 小时柱状趋势。
8. **点击地球任意点探测实时气象 (`/api/weather`)** — 接入 Open-Meteo，点击任意城市、地震点、事件或地球表面任意经纬度，立即返回当地实时气温、体感温度、风速风向、湿度、气压及距基准城市的直线距离。
9. **副屏日常监控 (`/api/intel`)** — 全球多时区实时世界时钟（UTC/北京/东京/伦敦/纽约）、BTC/ETH/SOL/黄金(PAXG) 24H 行情与迷你折线、Hacker News 实时前沿科技信号流。

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
