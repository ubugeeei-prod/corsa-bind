/** Markdown page passed through the docs Vite plugin. */
export type MarkdownPage = {
  readonly route: string;
  readonly sourcePath: string;
  readonly markdown: string;
};

/** Heading metadata returned by `@void/md` compilation. */
export type MarkdownHeading = {
  readonly depth: number;
  readonly slug: string;
  readonly text: string;
};

/** Compiled Markdown result from `@void/md`'s Ox Content pipeline. */
export type CompiledMarkdown = {
  readonly html: string;
  readonly frontmatter: Record<string, unknown>;
  readonly headings: readonly MarkdownHeading[];
  readonly title: string;
};

/** API entry extracted from TypeScript documentation comments. */
export type ApiEntry = {
  readonly name: string;
  readonly kind: string;
  readonly description: string;
  readonly signature: string;
  readonly sourcePath: string;
  readonly line: number;
  readonly params: readonly ApiParam[];
  readonly returns?: string;
};

/** Function or method parameter documentation. */
export type ApiParam = {
  readonly name: string;
  readonly type: string;
  readonly description: string;
};
