# System One Auto Move — 产品与技术规格

**Plugin id:** `systemone-auto-move`
**Version of this SPEC:** 1.0.0
**Language:** 中文为主，关键术语保留英文

体验灵感来自公开的 [Kaku Organize](https://kaku.md/zh-cn/lp/organize/#move) 页面上可见的交互；本规格是针对用户自有 Obsidian vault 的独立实现，不逆向、不复制任何闭源客户端代码或提示词原文。

关联插件：[obsidian-systemone-auto-tag](https://github.com/holy-max/obsidian-systemone-auto-tag)（标签）。两者互不依赖，各自独立安装。

---

## 1. 定位

一个视图，两步。

1. **扫描** — 生成目的地候选列表；用户删几个、加几个。
2. **开工** — 逐文件判定去向，表格里过一遍，一次移动。

不做的事：

- 不发明新目录（目的地必须是 vault 里已有、且装得下文件的目录）
- 不覆盖文件（同名冲突一律转人工）
- 不做后台自动运行（只由用户点「开工」触发）

## 2. 数据流

```
选文件夹 ──▶ 扫描 ──▶ MoveRun{folders, include}
                          │
                          ├─ 用户增删 chip
                          ▼
                     开工 ──▶ 每文件一次 /v1/systemone
                          │      └ dest: choice
                          ▼
                     answers ──▶ 表格（可勾选 / 逐个确认）
                          │
                          ▼
                   应用 N 行 ──▶ fileManager.renameFile
                          │
                          ▼
                       撤销 ──▶ 移回原位
```

run 的全部状态存在 `MoveRun` 里，落盘到插件 `data.json`，重启 Obsidian 后原样恢复。

## 3. 候选生成

`collectFolderOptions(app)`：遍历全库文件，按父目录聚合，每个目录带上至多 8 个已有文件名。空目录丢弃——没人往里放东西的目录不是「它装什么」的证据，而且每个额外选项都要在每次请求里重复付费。

`isIgnoredFolder` 排除 `.obsidian`、`.trash`、`.git` 与配置目录。

## 4. 判定

### 4.1 请求

每个文件一次 POST `{baseUrl}/v1/systemone`：

```jsonc
{
  "model": "jev-1.14.0",
  "state": { "note_title": "周复盘", "note_body": "本周完成三件事…" },   // 或 { file_name, file_type }
  "questions": {
    "dest": {
      "type": "choice",
      "instructions": "Which of these existing folders should this file be filed into? …",
      "criteria": {
        "reviews": "reviews/ already contains: 复盘模板, Q3 复盘.",
        "keep": "Leave it in inbox/."
      }
    }
  }
}
```

`criteria` 里每个目录写的是它已有的文件名。只给目录名时模型没有依据，实测会把所有文件判成 `keep`。

**当前目录不进选项列表**，由 `keep` 单独代表。两者并存会把「别动它」的概率劈成两半，两边都跌破阈值，结果每个文件都要人工确认。

单次请求最多 255 个 `choice` 选项（第 256 个返回 422）；目录超出时截断到 254 + `keep`。

非 Markdown 文件只发 `file_name` 与 `file_type`，不发内容。

### 4.2 判定

`classifyMove` 按以下顺序短路：

| 条件 | 结果 |
|---|---|
| 模型没答 / 不是 choice | `confirm` (`no-answer`) |
| 选了 `keep` | `stay` |
| 选了列表外的选项 | `confirm` (`unknown-option`) |
| 目标 == 当前目录 | `stay` |
| 目标已有同名文件 | `confirm` (`collision`) |
| `min(confidence, P(choice)) ≥ τ` | `move` |
| 其余 | `confirm` (`low-confidence`) |

取 `min(confidence, 该选项概率)` 而不是只看 `confidence`：分布很平时 `confidence` 也可能很高，单次移动不该相信那个数。

`τ` 固定为 0.70，不是设置项：这个数离开当前这份选项列表就没有意义，让用户调一个自己无法校准的概率只会更难用。

### 4.3 缓存

`MoveCache` 以文件为组（同文件只留一条，编辑即替换），键：

```
filePath · contentFingerprint · foldersHash · modelId · promptVersion
```

`foldersHash` 覆盖目录路径与例名：目录列表一变，旧答案回答的是旧问题。

`promptVersion` 是对提示词模板取哈希得来的，改文案自动失效。

非 Markdown 文件的内容指纹取 `name + size + mtime`。

### 4.4 失败与中断

| 情况 | 行为 |
|---|---|
| 可重试的失败（429 / 5xx / 网络中断） | 重试两次（0.6s、1.8s），仍失败才计入 `failed` |
| 单个文件失败 | 计入 `failed`，继续下一个；最终状态 `partial` |
| 连续 5 个失败 | 立刻停整个 run，状态 `partial`，`abortedAfter` 记下失败数——每个文件都是同一种问法，连续失败是共同条件坏了，不是运气 |
| HTTP 402 / 额度耗尽 | 立刻停整个 run，弹 15 秒 Notice，状态 `failed` |
| 用户点「停止」 | 当前文件做完即停，状态 `stopped` |
| 插件重启时 run 仍是 `judging` | 标记为 `stopped`：原 loop 已随进程消失，否则「停止」按钮会永远亮着 |

## 5. 移动与撤销

`moveFile` 走 `fileManager.renameFile`：Obsidian 负责按用户偏好更新链接，并记入文件操作历史。

移动前检查目标路径是否已被占用；占用则不移动，返回错误。

同名文件被移走后，原路径可能被别的文件占了——`moveBack` 同样先检查，冲突就报错而不是覆盖。

## 6. 界面

单视图 `systemone-move-view`。

**工具栏**：状态徽标、进度与耗时、进度条、停止 / 撤销按钮。失败时状态条下面直接显示停在哪个文件、为什么（`lastError`），不只在控制台。

**控制行**：范围下拉（`整个工作区` + vault 各级目录）、`扫描`、`开工`、当前文件数。范围是递归的：选中目录即包含其全部子目录。

**候选区**：一行目录 chip，每个可 × 删除，行尾输入框回车新增（目录不存在会提示）。

**结果表**：勾选 / 文件 / 目的地 / 操作。

- 目的地列：`inbox → reviews`，待确认的加 `?`，未判定显示 `—`，正在判定显示「判定中…」，不动的显示「保持原位」
- 操作列：`confirm` 状态给一个「确认」按钮，单个放行该文件
- 已移动的行显示 `✓ 已移动` 与目标目录
- 判定中自动滚动，让正在判定的那一行保持在视野里
- 底部：`应用 N 行`

## 7. 设置

| 键 | 默认 | 说明 |
|---|---|---|
| `baseUrl` | `https://api.typesafe.ai` | 请求打到 `{base}/v1/systemone` |
| `apiKey` | `""` | Bearer token |
| `modelId` | `jev-1.14.0` | |
| `bodyChars` | `800` | 每篇笔记发送前多少字给模型看 |
| `lastFolder` | `""` | 上次的文件夹，续用 |

`data.json` 里不认识的键在加载时丢弃：配置文件比设置项活得久。

## 8. 传输

必须走 `requestUrl`。渲染进程的 `fetch` 对任何不在 allowlist 里的 origin 都会被 CORS 拦掉，`api.typesafe.ai` 对 `Origin: app://obsidian.md` 直接回 `Disallowed CORS origin`。`requestUrl` 走主进程代理，绕开这条限制。

## 9. 已知限制

- 不新建目录：目的地必须是已有的。
- 判定是串行的：一个文件一次请求，排队跑完。并发会让进度、停止和额度错误处理都变复杂，收益不抵复杂度。
