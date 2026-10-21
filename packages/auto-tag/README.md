# System One Auto Tag

Obsidian 插件：选一个文件夹，自动列出**标签候选**，你删几个、加几个，然后一次判定、一次写入。可整体撤销。

配套的目录整理插件见 [obsidian-systemone-auto-move](https://github.com/holy-max/obsidian-systemone-auto-move)。

## 两步

**第一步 · 扫描**

点「扫描」，插件生成一份标签候选列表，全部默认选中：

| 情况 | 来源 |
|---|---|
| vault 里已有 ≥ 3 个标签 | vault 现有标签，按使用次数排序 |
| 不够 3 个 | 内置 48 个中文词表，以**本次扫描的笔记**为证据，一次请求逐词问「这个词对这批笔记里至少一篇有用吗」，留 `p ≥ 0.90` 的 |

**System One 只能回答 `noul` / `choice` / `score` 三种题型，不能生成自由文本**，所以标签无法由模型凭空写出，只能从真实词表里挑。

列表是可删可加的 chip：点 × 删掉不要的，输入框回车补几个。

**第二步 · 开工**

点「开工」，每篇笔记一次请求，逐个候选标签问「这篇该不该打这个标签」，结果落在一张表里：

```
☑  周复盘.md     复盘 0.97  技术 0.92  总结 0.91  效率 0.63
```

蓝色是达到阈值的，黄色是差一点的；笔记上已有的标签划掉。勾选框可以临时排除某一行。判定过程中进度条和 `已完成/总数` 实时走，列表自动滚到正在判定的那一篇。

表格底部「应用 N 篇」一次写完。工具栏出现「撤销」，删掉这次写入的标签。

## 判定规则

`p ≥ 0.8` 写入，`0.6 ≤ p < 0.8` 显示为待定，其余不计。这个数不是设置项：它只有和下面这条带一起才有意义，让用户去调一个自己无法校准的概率只会更难用。

每篇笔记最多写 `Max tags per note` 个（默认 8，`0` = 不限），按概率从高到低取。

**失败处理**：429 / 5xx / 网络中断重试两次（0.6s、1.8s）再算失败。连续 5 篇失败即停整个 run——每篇都是同一种问法，连续失败是一个坏掉的共同条件，不是运气；跑完剩下的只会用同样的错误再花一遍你的时间。停在哪篇、为什么，直接显示在状态条下面。

**缓存**：键含文件路径、内容指纹、候选标签列表、模型、正文范围、提示词版本。任意一项变了就打不到缓存，重新判定。没被回答的标签不进缓存，不会被钉成 0。

## 设置

| 项 | 默认 | 说明 |
|---|---|---|
| API key | — | System One Bearer token，只存在插件 data.json |
| Model | `jev-1.14.0` | |
| Base URL | `https://api.typesafe.ai` | 请求打到 `{base}/v1/systemone` |
| Write mode | `frontmatter` | `frontmatter` / `inline_top` / `both` |
| Body sent to the model | `first_n` | 首 N 字 / 全文 / 仅标题 |
| Body chars | `800` | |
| Max tags per note | `8` | `0` = 不限 |

请求经 Obsidian 的 `requestUrl` 发出；渲染进程的 `fetch` 会被 CORS 拦掉。

## 安装

```bash
git clone https://github.com/holy-max/obsidian-systemone-auto-tag.git
cd obsidian-systemone-auto-tag
npm install
npm run build
```

把 `main.js`、`manifest.json`、`styles.css` 拷到 vault 的 `.obsidian/plugins/systemone-auto-tag/`，在「社区插件」里启用 **System One Auto Tag**。

也可以用 BRAT 添加 `holy-max/obsidian-systemone-auto-tag`。

## 命令

| 命令 | 作用 |
|---|---|
| Open System One Tags | 打开面板 |
| Tag the active folder | 打开面板并把当前笔记所在的文件夹填进去 |
| Stop the current run | 停止正在跑的判定 |

## 开发

```bash
npm run build    # tsc 检查 + esbuild 出 main.js
npm run dev      # watch
node test/run-tests.mjs   # 单测，bundled 到临时目录跑
```

规格见 [`docs/SPEC.md`](docs/SPEC.md)。

## 许可

MIT。非官方，与 TypeSafe 无附属关系。发给模型提供商的数据由用户自己负责。
