import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import type { WorkspaceContext } from "../runtime/workspace-context.js";
import type { UserChannelPrefs } from "./types.js";

/**
 * 用户消息偏好的存储 —— 简单文件 + 内存缓存。
 *
 * 路径：<workspace>/messaging/prefs.json（一个 user_id 一个文件不必要，全用户合一足够）
 *
 * 默认偏好：
 *   - 文件不存在 → 第一 channel = "console"，所有 channel 落进列表
 *   - 调用方未设置 → fallback 到 default
 *
 * 第二版可换成全局 data/user-channel-prefs.json + IM SDK 同步。
 */

const PREFS_FILENAME = "messaging/prefs.json";

interface PrefsFile {
  prefs: Record<string, UserChannelPrefs>;
}

export interface ChannelPrefsStoreOptions {
  /** 找不到偏好时的默认 channel 顺序。 */
  defaultChannels?: string[];
}

export class UserChannelPrefsStore {
  private readonly defaults: string[];
  private readonly cache = new Map<string, PrefsFile>();

  constructor(opts: ChannelPrefsStoreOptions = {}) {
    this.defaults = opts.defaultChannels ?? ["console"];
  }

  async resolve(workspace: WorkspaceContext, userId: string): Promise<UserChannelPrefs> {
    const file = await this.load(workspace);
    const found = file.prefs[userId];
    if (found && found.preferred_channels?.length) return found;
    return { user_id: userId, preferred_channels: [...this.defaults] };
  }

  async setPrefs(workspace: WorkspaceContext, prefs: UserChannelPrefs): Promise<void> {
    const file = await this.load(workspace);
    file.prefs[prefs.user_id] = { ...prefs };
    await this.save(workspace, file);
  }

  private async load(workspace: WorkspaceContext): Promise<PrefsFile> {
    const cached = this.cache.get(workspace.root);
    if (cached) return cached;
    const filePath = path.join(workspace.root, PREFS_FILENAME);
    try {
      const raw = await readFile(filePath, "utf8");
      const parsed = JSON.parse(raw) as PrefsFile;
      const file: PrefsFile = { prefs: parsed.prefs ?? {} };
      this.cache.set(workspace.root, file);
      return file;
    } catch {
      const empty: PrefsFile = { prefs: {} };
      this.cache.set(workspace.root, empty);
      return empty;
    }
  }

  private async save(workspace: WorkspaceContext, file: PrefsFile): Promise<void> {
    const filePath = path.join(workspace.root, PREFS_FILENAME);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, JSON.stringify(file, null, 2), "utf8");
    this.cache.set(workspace.root, file);
  }
}
