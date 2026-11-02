# DotA 浏览器版

基于 Three.js、TypeScript 和 Warcraft III / DotA 经典资源的浏览器单机对战游戏。选择英雄，跟随兵线推进，打野、购买装备、释放技能，摧毁敌方基地。

**[在线试玩](https://ihca.cn/dota/)** · [完整玩法与操作](docs/gameplay.zh-CN.md) · [小红书小工具构建](minitool/README.md)

本仓库收录 2026-11-02 整理的本地最新源码、地图运行数据、模型、贴图、音效、测试和小工具构建脚本。包含头顶血条修复、手机操作及小工具横屏切换。在线试玩使用独立部署流程，版本可能与本仓库不同。

## 本地运行

需要 Node.js 22.12+ 或 24+。

```sh
git clone https://github.com/xilinnihao-afk/dota-browser-lab.git
cd dota-browser-lab
npm ci
npm run dev
```

打开 **http://127.0.0.1:5217/**。默认游戏所需的资源已随仓库提供，无需重新导入地图。私有仓库需要先登录有访问权限的 GitHub 账号。

生产构建与预览：

```sh
npm run build
npm run preview
```

开发和预览共用 5217 端口，请一次只启动一个。部署子路径时可使用 `npm run build -- --base=/dota/`。

## 游戏内容

- 12 位可玩英雄、36 个技能，包含独立技能特效和经典音效。
- 兵线推进、防御塔与基地攻防，敌方英雄 AI、视野判断与回泉补给。
- 打野、金币和经验、升级、六格背包、商店、吃树与阵亡复活。
- 经典地图地形、建筑、模型动画、寻路和 Warcraft III 风格界面。
- 桌面键鼠及手机摇杆、技能拖动施法、横竖屏布局、画质与声音设置。

当前使用独立实现的简化战斗规则，不执行原地图 JASS / IMBA 对战脚本。尚无联网、完整三路兵线、战争迷雾或完整 IMBA 规则。

## 操作

| 操作 | 电脑 |
| --- | --- |
| 移动 | WASD，或右键地面寻路 |
| 攻击 | 左键或右键敌方单位 |
| 技能 | Q / E / R，部分技能需要点击目标或落点 |
| 商店 / 野区 | B / N |
| 停止 / 跟随英雄 | X / 空格 |
| 镜头 | 鼠标拖动、方向键平移、滚轮缩放 |
| 暂停 | P |

手机使用左侧摇杆和右侧攻击、技能按钮，支持拖动施法和取消，建议横屏游玩。

## 检查

```sh
npm test
npm run map:check
npm run play:check
npm run play:test
npm run build
node --test minitool/resource-loader.test.mjs
```

地图和玩法资源清单保存在 `artifacts/imba/asset-manifest.json` 与 `artifacts/imba-playable/assets.json`，供检查脚本使用。其余本机缓存、部署记录、历史截图和生成产物未纳入仓库。

## 目录

| 目录 | 内容 |
| --- | --- |
| `src/classic/` | 经典地图渲染、模型动画、战斗、AI 和界面 |
| `src/game/`、`src/render/`、`src/ui/` | 早期原型与模拟代码 |
| `public/assets/imba/` | 默认游戏地图、寻路、模型、贴图和音效 |
| `public/assets/original/` | 独立模型查看器的参考资源 |
| `scripts/` | 导入、校验、模拟对战与发布打包 |
| `tests/` | 游戏逻辑、输入、音效和画面数据测试 |
| `minitool/` | 小红书离线小工具构建脚本和适配运行时 |

`?scene=1&view=river` 打开地图观察，`?models=1` 打开模型查看器，`?prototype=1` 打开早期原型。诊断参数见源码。

如需重新导入自己持有的原地图：

```sh
npm run map:import -- /path/to/IMBA_3.83d_AI.w3x
npm run play:prepare -- /path/to/IMBA_3.83d_AI.w3x
npm run map:check
npm run play:check
```

原始 W3X 文件未随仓库提供。首次重新准备资源可能需要网络，缓存写入 `.local/`。网页统计和反馈脚本仅在原站点域名启用，本地运行不向该服务发送数据。

## 资源与权利

本项目为非官方浏览器复刻实验。Warcraft III、DotA、角色、模型、地图内容、图片及音效等第三方资源的权利归各自权利人所有；代码依赖遵循各自许可证。本仓库未声明统一开源许可，上传不代表授予第三方素材的再分发或商业使用权。
