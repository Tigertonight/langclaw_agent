import { loadJson } from "../data/load-json.js";
import { fetchJson } from "../integrations/http.js";
import { TokenCache } from "../integrations/token-cache.js";
import type { JsonObject, JsonValue, UserContext } from "../types/agent-contracts.js";

export interface ResolveUserContextInput {
  userId?: string;
  user_id?: string;
  wecomUserId?: string;
  wecom_userid?: string;
  userContext?: UserContext;
}

export interface UserIdentity extends UserContext {
  external_id?: string;
  source?: string;
  department_id?: string | number;
  position?: string;
  mobile?: string;
  email?: string;
  alias?: string;
  wecom?: WeComUserRecord;
}

export interface UserAccess {
  role?: string;
  department?: string;
  accessible_customer_ids?: string[];
  permissions?: string[];
}

export interface UserDirectory {
  resolveIdentity(input: ResolveUserContextInput): Promise<UserIdentity>;
}

export interface PermissionProvider {
  resolveAccess(identity: UserIdentity): Promise<UserAccess>;
}

interface LocalUserRecord extends UserContext {
  default_store?: string;
}

interface WeComUserRecord extends JsonObject {
  userid: string;
  name?: string;
  department?: number[];
  department_name?: string;
  main_department?: number;
  role?: string;
  position?: string;
  mobile?: string;
  email?: string;
  alias?: string;
  accessible_customer_ids?: string[];
  permissions?: string[];
}

interface WeComUserPayload extends JsonObject {
  errcode?: number;
  errmsg?: string;
  userid?: string;
  name?: string;
  department?: number[] | number;
  position?: string;
  mobile?: string;
  email?: string;
}

interface WeComTokenPayload extends JsonObject {
  errcode?: number;
  errmsg?: string;
  access_token: string;
  expires_in?: number;
}

export class UserContextResolver {
  private readonly directory: UserDirectory;
  private readonly permissionProvider: PermissionProvider;

  constructor({ directory, permissionProvider }: { directory: UserDirectory; permissionProvider: PermissionProvider }) {
    this.directory = directory;
    this.permissionProvider = permissionProvider;
  }

  async resolve(input: ResolveUserContextInput): Promise<UserContext> {
    if (input.userContext) return input.userContext;

    const identity = await this.directory.resolveIdentity(input);
    const access = await this.permissionProvider.resolveAccess(identity);

    return {
      id: identity.id,
      external_id: identity.external_id,
      source: identity.source,
      name: identity.name,
      role: access.role ?? identity.role ?? "employee",
      department: access.department ?? identity.department ?? "unknown",
      department_id: identity.department_id,
      position: identity.position,
      mobile: identity.mobile,
      email: identity.email,
      alias: identity.alias,
      wecom: identity.wecom,
      default_store: identity.default_store ?? null,
      accessible_customer_ids: access.accessible_customer_ids ?? [],
      permissions: access.permissions ?? []
    };
  }
}

export class LocalUserDirectory implements UserDirectory {
  private usersCache: LocalUserRecord[] | null = null;

  async resolveIdentity(input: ResolveUserContextInput): Promise<UserIdentity> {
    const userId = input.userId ?? input.user_id;
    const users = await this.loadUsers();
    const user = users.find((item) => item.id === userId);
    if (!user) {
      return anonymousIdentity(userId);
    }
    return {
      ...user,
      external_id: user.id,
      source: "local"
    };
  }

  async loadUsers(): Promise<LocalUserRecord[]> {
    if (!this.usersCache) {
      this.usersCache = await loadJson<LocalUserRecord[]>("data/users.json");
    }
    return this.usersCache;
  }
}

export class MockWeComDirectory implements UserDirectory {
  private readonly localDirectory: LocalUserDirectory;
  private usersCache: WeComUserRecord[] | null = null;

  constructor({ localDirectory = new LocalUserDirectory() }: { localDirectory?: LocalUserDirectory } = {}) {
    this.localDirectory = localDirectory;
  }

  async resolveIdentity(input: ResolveUserContextInput): Promise<UserIdentity> {
    const wecomUserId = input.wecomUserId ?? input.wecom_userid;
    if (!wecomUserId) {
      return this.localDirectory.resolveIdentity(input);
    }

    const wecomUser = await this.findWeComUser(wecomUserId);
    if (!wecomUser) {
      const local = await this.localDirectory.resolveIdentity({ userId: wecomUserId });
      return {
        ...local,
        external_id: wecomUserId,
        source: "wecom_mock"
      };
    }

    const local = await this.localDirectory.resolveIdentity({ userId: wecomUser.userid });
    return {
      ...local,
      id: wecomUser.userid,
      external_id: wecomUser.userid,
      source: "wecom_mock",
      name: wecomUser.name ?? local.name,
      department: wecomUser.department_name ?? local.department,
      department_id: wecomUser.main_department ?? wecomUser.department?.[0],
      role: wecomUser.role ?? local.role,
      position: wecomUser.position,
      mobile: wecomUser.mobile,
      email: wecomUser.email,
      alias: wecomUser.alias,
      wecom: wecomUser,
      accessible_customer_ids: wecomUser.accessible_customer_ids ?? local.accessible_customer_ids ?? [],
      permissions: wecomUser.permissions ?? local.permissions ?? []
    };
  }

  async findWeComUser(userId: string): Promise<WeComUserRecord | undefined> {
    const users = await this.loadUsers();
    return users.find((user) => user.userid === userId);
  }

  async loadUsers(): Promise<WeComUserRecord[]> {
    if (!this.usersCache) {
      this.usersCache = await loadJson<WeComUserRecord[]>("data/wecom-users.json");
    }
    return this.usersCache;
  }
}

export class WeComDirectory implements UserDirectory {
  private readonly corpId: string;
  private readonly contactSecret: string;
  private readonly baseUrl: string;
  private readonly fallbackDirectory: UserDirectory;
  private readonly tokenCache: TokenCache<string>;

  constructor({
    corpId,
    contactSecret,
    baseUrl = "https://qyapi.weixin.qq.com",
    fallbackDirectory = new LocalUserDirectory(),
    tokenCache = new TokenCache<string>()
  }: {
    corpId: string;
    contactSecret: string;
    baseUrl?: string;
    fallbackDirectory?: UserDirectory;
    tokenCache?: TokenCache<string>;
  }) {
    this.corpId = corpId;
    this.contactSecret = contactSecret;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fallbackDirectory = fallbackDirectory;
    this.tokenCache = tokenCache;
  }

  async resolveIdentity(input: ResolveUserContextInput): Promise<UserIdentity> {
    const userId = input.wecomUserId ?? input.wecom_userid ?? input.userId ?? input.user_id;
    if (!userId) return anonymousIdentity();

    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/cgi-bin/user/get?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(userId)}`;
    const payload = await fetchJson<WeComUserPayload>(url);

    if (payload.errcode && payload.errcode !== 0) {
      const error = new Error(`WeCom user/get failed: ${payload.errmsg ?? payload.errcode}`) as Error & { payload?: WeComUserPayload };
      error.payload = payload;
      throw error;
    }

    const fallback = await this.fallbackDirectory.resolveIdentity({ userId });
    return {
      ...fallback,
      id: payload.userid ?? userId,
      external_id: payload.userid ?? userId,
      source: "wecom",
      name: payload.name ?? fallback.name,
      department_id: Array.isArray(payload.department) ? payload.department[0] : payload.department,
      position: payload.position,
      mobile: payload.mobile,
      email: payload.email
    };
  }

  async getAccessToken(): Promise<string> {
    const cached = this.tokenCache.get("wecom_contact_access_token");
    if (cached) return cached;

    const url = `${this.baseUrl}/cgi-bin/gettoken?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.contactSecret)}`;
    const payload = await fetchJson<WeComTokenPayload>(url);
    if (payload.errcode && payload.errcode !== 0) {
      const error = new Error(`WeCom gettoken failed: ${payload.errmsg ?? payload.errcode}`) as Error & { payload?: WeComTokenPayload };
      error.payload = payload;
      throw error;
    }
    this.tokenCache.set("wecom_contact_access_token", payload.access_token, payload.expires_in ?? 7200);
    return payload.access_token;
  }
}

export class LocalPermissionProvider implements PermissionProvider {
  async resolveAccess(identity: UserIdentity): Promise<UserAccess> {
    return {
      role: identity.role,
      department: identity.department,
      accessible_customer_ids: identity.accessible_customer_ids ?? [],
      permissions: identity.permissions ?? []
    };
  }
}

export function summarizeUser(user: UserContext): Pick<UserContext, "id" | "name" | "role" | "department"> & { source?: JsonValue } {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    department: user.department,
    source: user.source as JsonValue
  };
}

function anonymousIdentity(userId?: string): UserIdentity {
  return {
    id: userId ?? "anonymous",
    external_id: userId ?? "anonymous",
    source: "local",
    name: "未知用户",
    role: "anonymous",
    department: "unknown",
    accessible_customer_ids: [],
    permissions: []
  };
}
