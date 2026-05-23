/**
 * 命令黑名单：在交给 sandbox-exec 前先静态扫一遍 bash 命令，挡住一类显然有害的调用。
 *
 * 设计原则：
 *   1. 黑名单是"主动越权拦截"，sandbox-exec 是"运行时兜底"。少了任何一层都不够稳。
 *   2. 静态扫描不可能 100% 准（bash 太活，eval $X 之类绕得过），所以**这层只挡常见低级越权**，
 *      复杂逃逸交给 sandbox 兜底。
 *   3. 不做语法分析（没必要拉 bash parser），用 word 边界正则提取 token，命中黑名单 word 直接拒。
 *
 * 黑名单分两类：
 *   - 网络系：curl/wget/scp/ssh/sftp/nc/ncat/socat —— 默认禁网下其实跑不通，但提前拒错误更友好
 *   - 不可逆破坏 / 系统级：rm -rf /、sudo、chmod 777 /、shutdown、reboot、kill -9 1
 *   - 其他危险：mkfs、dd of=/dev/、curl|sh 之类 pipe-execution
 */

export interface BlacklistCheckResult {
  ok: boolean;
  reason?: string;
  matched?: string;
}

const FORBIDDEN_BINARIES = new Set([
  // 网络出站
  "curl", "wget", "scp", "sftp", "nc", "ncat", "netcat", "socat", "ssh", "rsync",
  // 提权 / 系统
  "sudo", "su", "doas", "shutdown", "reboot", "halt", "poweroff",
  // 文件系统破坏
  "mkfs", "fdisk", "diskutil",
  // 进程级别破坏
  "killall"
]);

/**
 * 危险参数组合：哪怕命令本身合法，参数组合也是显著危险信号。
 * 用 "命令名 + 子串" 形式表达，匹配中任意一条就拒。
 */
const FORBIDDEN_PHRASES: Array<{ phrase: RegExp; reason: string }> = [
  // rm -rf 接近根
  { phrase: /\brm\s+(?:-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)\s+\/(\s|$|[^a-zA-Z0-9_.-])/, reason: "rm -rf 不允许针对根目录" },
  { phrase: /\brm\s+-rf?\s+~(?:\/|$)/, reason: "rm -rf ~ 不允许" },
  { phrase: /\brm\s+-rf?\s+\$HOME/, reason: "rm -rf $HOME 不允许" },
  // dd 写设备
  { phrase: /\bdd\s+[^&|;]*of=\/dev\//, reason: "dd 不允许写设备节点" },
  // pipe-to-shell
  { phrase: /\|\s*(?:bash|sh|zsh|fish)(\s|$|;|&|\|)/, reason: "禁止 | bash / | sh 这类 pipe-to-shell" },
  // chmod 777 根
  { phrase: /\bchmod\s+(?:777|-R\s+777|a\+rwx)\s+\//, reason: "禁止 chmod 777 根目录" },
  // kill -9 1（init）
  { phrase: /\bkill\s+(?:-9\s+|-KILL\s+)?1\b/, reason: "禁止 kill PID 1" }
];

/**
 * 检查 bash 命令文本是否命中黑名单。
 * 不会做完整 shell 解析；只做 word-token 扫描 + 危险短语正则。
 */
export function checkCommandBlacklist(command: string): BlacklistCheckResult {
  if (!command || typeof command !== "string") {
    return { ok: false, reason: "empty_command" };
  }
  // word token：连续字母/数字/下划线/点/破折号
  const tokens = command.match(/\b[a-zA-Z][a-zA-Z0-9_.-]*\b/g) ?? [];
  for (const tok of tokens) {
    // basename：兼容 /usr/bin/curl 形式
    const base = tok.includes("/") ? tok.slice(tok.lastIndexOf("/") + 1) : tok;
    if (FORBIDDEN_BINARIES.has(base)) {
      return { ok: false, reason: `禁止调用 ${base}（黑名单）`, matched: base };
    }
  }
  // 也扫一下原始 path 形式（/usr/bin/curl 之类），上面 token 化已经处理；但 ssh-agent 这种带连字符的也要拦
  const pathPattern = /\b\/(?:usr\/(?:local\/)?bin|bin|sbin)\/([a-zA-Z][a-zA-Z0-9_.-]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = pathPattern.exec(command)) !== null) {
    if (FORBIDDEN_BINARIES.has(m[1])) {
      return { ok: false, reason: `禁止调用 ${m[1]}（绝对路径）`, matched: m[1] };
    }
  }
  for (const { phrase, reason } of FORBIDDEN_PHRASES) {
    if (phrase.test(command)) {
      return { ok: false, reason, matched: phrase.source };
    }
  }
  return { ok: true };
}
