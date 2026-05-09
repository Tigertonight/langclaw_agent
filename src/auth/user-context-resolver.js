import { loadJson } from "../data/load-json.js";
import { fetchJson } from "../integrations/http.js";
import { TokenCache } from "../integrations/token-cache.js";

export class UserContextResolver {
  constructor({ directory, permissionProvider }) {
    this.directory = directory;
    this.permissionProvider = permissionProvider;
  }

  async resolve(input) {
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
      accessible_customer_ids: access.accessible_customer_ids ?? [],
      permissions: access.permissions ?? []
    };
  }
}

export class LocalUserDirectory {
  constructor() {
    this.usersCache = null;
  }

  async resolveIdentity(input) {
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

  async loadUsers() {
    if (!this.usersCache) {
      this.usersCache = await loadJson("data/users.json");
    }
    return this.usersCache;
  }
}

export class MockWeComDirectory {
  constructor({ localDirectory = new LocalUserDirectory() } = {}) {
    this.localDirectory = localDirectory;
    this.usersCache = null;
  }

  async resolveIdentity(input) {
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

  async findWeComUser(userId) {
    const users = await this.loadUsers();
    return users.find((user) => user.userid === userId);
  }

  async loadUsers() {
    if (!this.usersCache) {
      this.usersCache = await loadJson("data/wecom-users.json");
    }
    return this.usersCache;
  }
}

export class WeComDirectory {
  constructor({ corpId, contactSecret, baseUrl = "https://qyapi.weixin.qq.com", fallbackDirectory = new LocalUserDirectory(), tokenCache = new TokenCache() }) {
    this.corpId = corpId;
    this.contactSecret = contactSecret;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fallbackDirectory = fallbackDirectory;
    this.tokenCache = tokenCache;
  }

  async resolveIdentity(input) {
    const userId = input.wecomUserId ?? input.wecom_userid ?? input.userId ?? input.user_id;
    if (!userId) return anonymousIdentity();

    const token = await this.getAccessToken();
    const url = `${this.baseUrl}/cgi-bin/user/get?access_token=${encodeURIComponent(token)}&userid=${encodeURIComponent(userId)}`;
    const payload = await fetchJson(url);

    if (payload.errcode && payload.errcode !== 0) {
      const error = new Error(`WeCom user/get failed: ${payload.errmsg ?? payload.errcode}`);
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

  async getAccessToken() {
    const cached = this.tokenCache.get("wecom_contact_access_token");
    if (cached) return cached;

    const url = `${this.baseUrl}/cgi-bin/gettoken?corpid=${encodeURIComponent(this.corpId)}&corpsecret=${encodeURIComponent(this.contactSecret)}`;
    const payload = await fetchJson(url);
    if (payload.errcode && payload.errcode !== 0) {
      const error = new Error(`WeCom gettoken failed: ${payload.errmsg ?? payload.errcode}`);
      error.payload = payload;
      throw error;
    }
    this.tokenCache.set("wecom_contact_access_token", payload.access_token, payload.expires_in ?? 7200);
    return payload.access_token;
  }
}

export class LocalPermissionProvider {
  async resolveAccess(identity) {
    return {
      role: identity.role,
      department: identity.department,
      accessible_customer_ids: identity.accessible_customer_ids ?? [],
      permissions: identity.permissions ?? []
    };
  }
}

export function summarizeUser(user) {
  return {
    id: user.id,
    name: user.name,
    role: user.role,
    department: user.department,
    source: user.source
  };
}

function anonymousIdentity(userId) {
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
