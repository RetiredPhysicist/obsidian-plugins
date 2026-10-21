# System One Auto Move

Obsidian 插件：选一个文件夹（含其子文件夹，或整个工作区），自动列出**目的地候选**，你删几个、加几个，然后一次判定、一次移动。可整体撤销。

配套的标签插件见 [obsidian-systemone-auto-tag](https://github.com/holy-max/obsidian-systemone-auto-tag)。

## 两步

**第一步 · 扫描**

顶部下拉选范围：`整个工作区` 或任何一级目录；选中目录会连子目录一起扫描。下面显示这个范围里有多少文件。

点「扫描」，插件生成一份目的地候选列表，全部默认选中：vault 里**已经装着文件**的文件夹。每个目录连同其中已有的文件名一起发给模型——只给目录名（`notes/`、`misc/`）模型没有判断依据，实测会把每个文件都判成「保持原位」。

空目录不进候选：没人往里放东西的目录不是「它装什么」的证据，而且每个额外选项都要在每次请求里重复付费。

列表是可删可加的 chip：点 × 删掉不要的，输入框回车补几个（目录必须已存在）。

**第二步 · 开工**

点「开工」，每个文件一次请求，问「该进哪个目录」，结果落在一张表里：

```
☑  发票_2026-09.pdf   inbox → admin/invoices
☑  周复盘.md          inbox → reviews ?          [确认]
   旅行清单.md         保持原位
```

目的地列显示 `当前 → 目标`，带 `?` 的是拿不准的，需要点「确认」才移动；也可以勾掉某一行。

判定过程中进度条和 `已完成/总数` 实时走，列表自动滚到正在判定的那一行。

表格底部「应用 N 行」一次移动。工具栏出现「撤销」，把这次移走的文件全部移回。

## 判定规则

选项里**不含文件当前所在的目录**，由 `keep` 单独代表。两者同时出现会把「别动它」的概率劈成两半，两边都跌破阈值，结果每个文件都要人工确认。

判定分取 `min(confidence, 该选项的概率)`，`≥ 0.7` 才算移动。只看 `confidence` 不行：分布很平时那个数也可能很高。这个数不是设置项：离开当前这份选项列表它就失去意义，让用户去调一个自己无法校准的概率只会更难用。

以下情况一律转为「确认」，绝不静默移动：

| 情况 | 处理 |
|---|---|
| 目标目录已有同名文件 | 标「确认」 |
| 模型选了列表外的目录 | 标「确认」 |
| 模型漏答 | 标「确认」 |
| 文件本来就在目标目录 | 「保持原位」 |

**失败处理**：429 / 5xx / 网络中断重试两次（0.6s、1.8s）再算失败。连续 5 个失败即停整个 run——每个文件都是同一种问法，连续失败是一个坏掉的共同条件，不是运气；跑完剩下的只会用同样的错误再花一遍你的时间。停在哪个文件、为什么失败，直接显示在状态条下面。

**缓存**：键含文件路径、内容指纹、目录列表（含例名）、模型、提示词版本。目录列表一变，缓存全部失效。

非 Markdown 文件（PDF、图片等）只按文件名判定，不发送内容。

## 设置

| 项 | 默认 | 说明 |
|---|---|---|
| API key | — | System One Bearer token，只存在插件 data.json |
| Model | `jev-1.14.0` | |
| Base URL | `https://api.typesafe.ai` | 请求打到 `{base}/v1/systemone` |
| Body chars | `800` | 每篇笔记发送前多少字给模型看 |

请求经 Obsidian 的 `requestUrl` 发出；渲染进程的 `fetch` 会被 CORS 拦掉。

## 安装

```bash
git clone https://github.com/holy-max/obsidian-systemone-auto-move.git
cd obsidian-systemone-auto-move
npm install
npm run build
```

把 `main.js`、`manifest.json`、`styles.css` 拷到 vault 的 `.obsidian/plugins/systemone-auto-move/`，在「社区插件」里启用 **System One Auto Move**。

也可以用 BRAT 添加 `holy-max/obsidian-systemone-auto-move`。

## 命令

| 命令 | 作用 |
|---|---|
| Open System One Move | 打开面板 |
| Organize the active folder | 打开面板并把当前文件所在的文件夹填进去 |
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
