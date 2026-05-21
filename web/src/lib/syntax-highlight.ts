import Prism from "prismjs";

// Curated language set — kept lean. Loaded once at module import.
// Order matters: prism-clike must load before c-derived languages.
import "prismjs/components/prism-clike";
import "prismjs/components/prism-markup";
import "prismjs/components/prism-markup-templating";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-jsx";
import "prismjs/components/prism-tsx";
import "prismjs/components/prism-python";
import "prismjs/components/prism-go";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-ruby";
import "prismjs/components/prism-swift";
import "prismjs/components/prism-bash";
import "prismjs/components/prism-markdown";
import "prismjs/components/prism-json";
import "prismjs/components/prism-yaml";
import "prismjs/components/prism-toml";
import "prismjs/components/prism-css";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-sql";
import "prismjs/components/prism-java";
import "prismjs/components/prism-kotlin";
import "prismjs/components/prism-c";
import "prismjs/components/prism-cpp";
import "prismjs/components/prism-objectivec";
import "prismjs/components/prism-php";
import "prismjs/components/prism-diff";

const EXTENSION_TO_LANG: Record<string, string> = {
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  jsx: "jsx",
  ts: "typescript",
  tsx: "tsx",
  py: "python",
  pyi: "python",
  go: "go",
  rs: "rust",
  rb: "ruby",
  swift: "swift",
  sh: "bash",
  bash: "bash",
  zsh: "bash",
  fish: "bash",
  md: "markdown",
  mdx: "markdown",
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "toml",
  css: "css",
  scss: "scss",
  sass: "scss",
  html: "markup",
  htm: "markup",
  xml: "markup",
  svg: "markup",
  vue: "markup",
  sql: "sql",
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  c: "c",
  h: "c",
  cpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  m: "objectivec",
  mm: "objectivec",
  php: "php",
  patch: "diff",
  diff: "diff",
};

const FILENAME_TO_LANG: Record<string, string> = {
  Dockerfile: "bash",
  Makefile: "bash",
  ".gitignore": "bash",
  ".env": "bash",
};

export function detectLanguage(filePath: string): string | null {
  const segments = filePath.split("/");
  const base = segments[segments.length - 1];
  if (FILENAME_TO_LANG[base]) return FILENAME_TO_LANG[base];

  const dotIdx = base.lastIndexOf(".");
  if (dotIdx <= 0) return null;
  const ext = base.slice(dotIdx + 1).toLowerCase();
  return EXTENSION_TO_LANG[ext] ?? null;
}

export function highlightCode(code: string, lang: string | null): string {
  if (!lang || !Prism.languages[lang]) {
    return escapeHtml(code);
  }
  try {
    return Prism.highlight(code, Prism.languages[lang], lang);
  } catch {
    return escapeHtml(code);
  }
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
