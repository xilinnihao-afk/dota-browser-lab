# DotA 小红书离线小工具

网站和小工具共用根目录游戏源码；此目录提供容器适配运行时及构建脚本。默认游戏资源从根目录 `public/assets/imba/` 读取，转换为离线包支持的资源形式。

## 构建

先在项目根目录运行 `npm ci`，然后执行：

```sh
npm ci --prefix minitool/toolchain
node minitool/prepare.mjs
node minitool/build.mjs
node --test minitool/resource-loader.test.mjs
node minitool/asset-check.mjs
python3 minitool/package.py --output .local/releases/dota-xiaohongshu.zip
```

需要 Node.js 22.12+ 或 24+、Python 3。构建会生成 `minitool/public/`、`minitool/generated/` 和 `minitool/dist/`，这些目录不提交到 Git。

包保留 12 位英雄、36 个技能、AI、商店、音效、地图与寻路、手机输入、头顶血条和容器内横屏切换。ZIP 根目录为 `index.html`；打包器检查最多 200 个文件、ZIP 小于 10,000,000 字节。

本地构建和普通浏览器检查不能替代平台模拟器及 Android/iOS 真机验证。容器内横屏使用页面旋转；未调用强制转屏 API。旧内核与首次加载性能仍需实机检查。
