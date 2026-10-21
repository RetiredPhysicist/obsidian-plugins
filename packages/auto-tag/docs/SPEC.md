# System One Auto Tag — 产品与技术规格

**Plugin id:** `systemone-auto-tag`
**Version of this SPEC:** 1.0.0
**Language:** 中文为主，关键术语保留英文

体验灵感来自公开的 [Kaku Auto Tagging](https://kaku.md/zh-cn/lp/organize/#tagging) 页面上可见的交互；本规格是针对用户自有 Obsidian vault 的独立实现，不逆向、不复制任何闭源客户端代码或提示词原文。

关联插件：[obsidian-systemone-auto-move](https://github.com/holy-max/obsidian-systemone-auto-move)（目录整理）。两者互不依赖，各自独立安装。

---

## 1. 定位

一个视图，两步。

1. **扫描** — 生成标签候选列表；用户删几个、加几个。
2. **开工** — 逐篇判定候选标签，表格里过一遍，一次写入。

不做的事：

- 不发明新标签（候选只来自 vault 已有标签，或兜底词表里被认可的）
- 不改正文（只写 frontmatter 的 `tags:` 或首行 inline 标签）
- 不做后台自动运行（只由用户点「开工」触发）

## 2. 数据流

```
选文件夹 ──▶ 扫描 ──▶ TagRun{tags, include}
                          │
                          ├─ 用户增删 chip
                          ▼
                     开工 ──▶ 每篇笔记一次 /v1/systemone
                          │      └ t0..tn: noul
                          ▼
                      scores ──▶ 表格（可勾选排除）
                          │
                          ▼
                   应用 N 篇 ──▶ 写 frontmatter 或首行 inline
                          │
                          ▼
                       撤销 ──▶ 删掉本次写入的标签
```

run 的全部状态存在 `TagRun` 里，落盘到插件 `data.json`，重启 Obsidian 后原样恢复。

## 3. 候选生成

### 3.1 首选：vault 现有标签

`scanVaultTags(app)`：

1. `metadataCache.getTags()` 取全库 inline 标签及计数
2. 逐文件读 `frontmatter` 里的 `tags:` / `tag:`，各计一次
3. 按计数降序，同数按字典序

`metadataCache.getTags()` 只覆盖 inline 标签，frontmatter 必须单独扫，否则只写 YAML 的 vault 会得到空列表。

**为什么不从扫描范围内的笔记取标签**：那样只能拿到这些笔记已经有的标签，而写入时又会过滤掉已存在的标签——列表会提议出零个结果。

### 3.2 兜底：内置词表

vault 标签少于 3 个时，用内置 `SEED_TAGS`（48 个中文主题词）。若已配置 API key，一次请求带全部 48 个 noul，以**本次扫描的笔记**为 state，逐词问「这个词对这批笔记里至少一篇有用吗」，保留 `p ≥ 0.90` 的。请求失败则整份词表照给。

判据的取舍有实测依据（6 篇笔记的 inbox）：阈值 0.90 留下 14 个词，0.70 留下 26 个——列表的意义在于短到能逐个删。而「至少两篇笔记都在讲它」会把 `会议`、`旅行` 这类一眼可见的主题筛掉——6 个文件的 inbox 本来就是一事一篇。评判对象也必须是扫描范围内这批笔记，拿全库 60 篇当证据会把小范围的主题稀释掉，实测只剩 1 个词。

### 3.3 为什么标签不能「生成」

`/v1/systemone` 的题型只有 `noul`、`choice`、`score` 三种。`type: "text"` / `"generate"` / `"label"` / `"tags"` 一律返回 `400 api_usage_error`。模型无法产出自由文本，标签只能从真实词表里挑。

## 4. 判定

### 4.1 请求

每篇笔记一次 POST `{baseUrl}/v1/systemone`：

```jsonc
{
  "model": "jev-1.14.0",
  "state": { "note_title": "周复盘", "note_body": "本周完成三件事…" },
  "questions": {
    "t0": { "type": "noul", "instructions": "Should this note be tagged with \"#复盘\"?", "criteria": { "true": "…", "false": "…" } },
    "t1": { … }
  }
}
```

`noul` 问题数没有实测上限（1000 个仍返回 200），所以候选标签数量不受请求体限制。

发送前 `prepareBodyForJudge` 剥掉 frontmatter 和正文里已有的 inline 标签，避免模型照着抄。

`bodyScope` 取 `first_n`（默认 800 字）/ `full` / `title` 三档。

### 4.2 分桶

`bucket(p, τ)`：

- `p ≥ τ` → `w`（写入，蓝）
- `τ − 0.20 ≤ p < τ` → `h`（待定，黄）
- 其余 → `n`（忽略）

`τ` 固定为 0.80，不是设置项：它只有和待定带（`τ − 0.20`）一起才有意义，让用户调一个自己无法校准的概率只会更难用。

### 4.3 写入集合

`writeSet(tags, scores, forced, τ, exclude, max)`：

1. 丢掉 `exclude`（笔记上已有）和低于 τ 的
2. 按概率降序
3. 截到 `max`（`0` = 不限）

### 4.4 缓存

`ScoreCache` 以文件为组（同文件只留一条，编辑即替换），键：

```
filePath · contentFingerprint · tagsHash · modelId · promptVersion · bodyScope · firstN
```

`tagsHash` 覆盖候选标签列表：列表一变，缓存全部失效——旧答案回答的是旧问题。

`promptVersion` 是对提示词模板取哈希得来的，改文案自动失效；手写的版本号常数迟早会忘记改。

未作答的 noul 不入缓存（既不算 0 也不记），否则一次网络抖动会把 `p=0` 永久钉住。

### 4.5 失败与中断

| 情况 | 行为 |
|---|---|
| 可重试的失败（429 / 5xx / 网络中断） | 重试两次（0.6s、1.8s），仍失败才计入 `failed` |
| 单篇失败 | 计入 `failed`，继续下一篇；最终状态 `partial` |
| 连续 5 篇失败 | 立刻停整个 run，状态 `partial`，`abortedAfter` 记下失败数——每篇都是同一种问法，连续失败是共同条件坏了，不是运气 |
| HTTP 402 / 额度耗尽 | 立刻停整个 run，弹 15 秒 Notice，状态 `failed` |
| 用户点「停止」 | 当前笔记做完即停，状态 `stopped` |
| 插件重启时 run 仍是 `judging` | 标记为 `stopped`：原 loop 已随进程消失，否则「停止」按钮会永远亮着 |

## 5. 写入与撤销

`addTagsToNote` 走一次 `vault.process`，返回**真正写进去**的标签。半写完的笔记会变成「标记已应用但正文有标签、又没有撤销记录」。这份列表是撤销的唯一依据，多报一个就会在撤销时删掉用户原有的标签。

- `frontmatter` 模式：合并进 `tags:`，遇到旧的单数 `tag:` 键时并入并删掉它
- `inline_top` 模式：在正文最前面加一行 `#a #b`，不动其他字节
- `both`：两种都写

`removeTagsFromNote` 只删 `addTagsToNote` 写入的那个集合：

- inline 模式只删首行那个标签行，不扫正文——扫描会把链接锚点 `[x](#jump)` 和代码块里的 `#` 一并抹掉
- frontmatter 删到空时整块移除，不留下笔记原本没有的 `tags: []`
- CRLF 文件的行尾保持原样

## 6. 界面

单视图 `systemone-tags-view`。

**工具栏**：状态徽标（待开始 / 判定中 / 已判定 / 部分失败 / 已停止 / 失败）、进度与耗时、进度条、停止 / 撤销按钮。失败时状态条下面直接显示停在哪篇、为什么（`lastError`），不只在控制台。

**控制行**：范围下拉（`整个工作区` + vault 各级目录）、`扫描`、`开工`、当前笔记数。范围是递归的：选中目录即包含其全部子目录。

**候选区**：一行标签 chip，每个可 × 删除，行尾输入框回车新增。

**结果表**：勾选 / 笔记 / 标签 / 状态。

- 标签列：概率 ≥ τ 的蓝色，待定的黄色，已存在的划掉；全部低于待定线显示「无」
- 已应用的行显示 `✓ 已写入`
- 判定中自动滚动，让正在判定的那一行保持在视野里
- 底部：`应用 N 篇`

## 7. 设置

| 键 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `https://api.typesafe.ai` | 请求打到 `{base}/v1/systemone` |
| `apiKey` | `""` | Bearer token |
| `modelId` | `jev-1.14.0` | |
| `writeMode` | `frontmatter` | `frontmatter` / `inline_top` / `both` |
| `bodyScope` | `first_n` | `first_n` / `full` / `title` |
| `bodyChars` | `800` | |
| `maxTagsPerNote` | `8` | `0` = 不限 |
| `lastFolder` | `""` | 上次的文件夹，续用 |

`data.json` 里不认识的键在加载时丢弃：配置文件比设置项活得久。

## 8. 传输

必须走 `requestUrl`。渲染进程的 `fetch` 对任何不在 allowlist 里的 origin 都会被 CORS 拦掉，`api.typesafe.ai` 对 `Origin: app://obsidian.md` 直接回 `Disallowed CORS origin`。`requestUrl` 走主进程代理，绕开这条限制。

## 9. 已知限制

- 判定是串行的：一篇笔记一次请求，排队跑完。并发会让进度、停止和额度错误处理都变复杂，收益不抵复杂度。
- 每篇笔记最多写 `maxTagsPerNote` 个标签，超出的按概率截断。
