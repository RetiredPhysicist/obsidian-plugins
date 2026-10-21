import { App, TFile } from "obsidian";
import { frontmatterTags, normalizeTag } from "./tags";

/**
 * The vault's own vocabulary, most used first. Taking tags from the notes in
 * scope instead would offer only what those notes already carry, and the write
 * step filters out existing tags — the list would propose nothing.
 */
export function scanVaultTags(app: App): string[] {
  const counts = new Map<string, number>();
  const cache =
    (app.metadataCache as unknown as { getTags?: () => Record<string, number> })
      .getTags?.() ?? {};
  for (const [raw, count] of Object.entries(cache)) {
    const tag = normalizeTag(raw);
    if (tag) counts.set(tag, (counts.get(tag) ?? 0) + count);
  }
  // getTags() covers inline tags only; frontmatter tags need their own pass.
  for (const file of app.vault.getMarkdownFiles()) {
    for (const tag of frontmatterTags(app.metadataCache.getFileCache(file)?.frontmatter)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([tag]) => tag);
}

/**
 * The vocabulary offered when the vault has too few tags to work from. Asking
 * noul questions against a fixed word list is the only way to "generate" tags
 * here: the endpoint answers in typed values, so it cannot return free text.
 */
export const SEED_TAGS = [
  "会议", "复盘", "读书笔记", "日记", "项目", "设计", "营销", "产品",
  "技术", "写作", "研究", "财务", "招聘", "健康", "旅行", "学习",
  "灵感", "待办", "资料", "归档", "前端", "后端", "数据库", "架构",
  "测试", "部署", "安全", "性能", "文档", "教程", "论文", "工具",
  "效率", "团队", "客户", "销售", "运营", "数据", "报告", "想法",
  "计划", "总结", "模板", "清单", "参考", "重要", "长期", "实验",
];

/**
 * Snippets of the notes a run will act on. Grading the seed vocabulary against
 * the whole vault buries a small scope in unrelated notes: the theme has to be
 * present in the files that will actually be tagged.
 */
export async function scopeSummary(
  app: App,
  files: TFile[],
  limit = 60
): Promise<string> {
  const lines: string[] = [];
  for (const file of files.slice(0, limit)) {
    const content = await app.vault.cachedRead(file);
    const body = content.replace(/^---[\s\S]*?---/, "").replace(/\s+/g, " ").trim();
    lines.push(`${file.basename} | ${body.slice(0, 100)}`);
  }
  return lines.join("\n");
}