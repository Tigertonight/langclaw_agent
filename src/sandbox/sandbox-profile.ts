/**
 * macOS sandbox-exec profile 生成器。
 *
 * 默认策略：
 *   - allow default：先放开所有，便于 bash + 常用 unix 工具能正常启动
 *   - deny network*：彻底禁网（DNS 都解析不了）
 *   - deny file-write* (require-not (subpath workspace.root))：除了 workspace 根，其余地方都不能写
 *
 * 之所以用 "allow default + 几条 deny"，是因为 macOS 上 bash + coreutils + python 启动会读
 * 几十个系统目录、连 mach-bootstrap 之类的服务，逐条 allow 维护成本极高且容易漏。
 * 反过来收紧成本低、抗逃逸足够。
 *
 * 风险残留：
 *   - 进程能 fork、能读全机文件（含 ~/.ssh/）—— 默认禁网兜住了"读了也带不走"。后续要更紧可以
 *     再叠加 (deny file-read* (subpath "<sensitive>"))。
 *   - bash 内可以用 builtin 的 echo > 把 workspace 内的文件写满。这是用户自己的工作区，能接受。
 *
 * 不允许动态注入用户控制的字符串：profile 一旦把 path 拼进去就变成 sandbox 语言的 string literal，
 * 路径里的 " 或 \ 必须先转义，否则可被 SBPL 注入。escapeSbpl 负责转义。
 */

export interface SandboxProfileOptions {
  /** workspace 根目录，是允许写入的唯一子树。 */
  workspaceRoot: string;
  /** 关闭网络。默认 true。极少数场景（用户主动开 allow_network）才传 false。 */
  denyNetwork?: boolean;
  /** 额外允许写入的子树（绝对路径）。例如 /tmp 下的临时目录。 */
  extraWritableSubpaths?: string[];
}

export function buildSandboxProfile(opts: SandboxProfileOptions): string {
  if (!opts.workspaceRoot || typeof opts.workspaceRoot !== "string") {
    throw new Error("buildSandboxProfile: workspaceRoot is required");
  }
  const denyNetwork = opts.denyNetwork ?? true;
  const writable = [opts.workspaceRoot, ...(opts.extraWritableSubpaths ?? [])];

  // require-not (any-of subpath ...)：路径不在白名单内的写都拒
  const writableClause = writable.length === 1
    ? `(subpath "${escapeSbpl(writable[0])}")`
    : `(any-of ${writable.map((p) => `(subpath "${escapeSbpl(p)}")`).join(" ")})`;

  const lines = [
    "(version 1)",
    "(allow default)",
    denyNetwork ? "(deny network*)" : "",
    `(deny file-write* (require-not ${writableClause}))`
  ].filter((s) => s.length > 0);

  return lines.join("\n");
}

/**
 * 转义 SBPL（Sandbox Profile Language，Scheme 方言）字符串。
 * SBPL 字符串规则比较保守：" 必须 \"，反斜杠 \\。
 * 同时拒绝包含控制字符的路径（防 \r\n 把 profile 注入裂开）。
 */
export function escapeSbpl(input: string): string {
  if (/[\x00-\x1f]/.test(input)) {
    throw new Error("escapeSbpl: control characters are not allowed in sandbox paths");
  }
  return input.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
