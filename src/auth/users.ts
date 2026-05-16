import {
  LocalPermissionProvider,
  LocalUserDirectory,
  UserContextResolver,
  summarizeUser
} from "./user-context-resolver.js";
import type { ResolveUserContextInput } from "./user-context-resolver.js";
import type { UserContext } from "../types/agent-contracts.js";

const defaultResolver = new UserContextResolver({
  directory: new LocalUserDirectory(),
  permissionProvider: new LocalPermissionProvider()
});

export async function getUserContext(userId: string): Promise<UserContext> {
  return defaultResolver.resolve({ userId } satisfies ResolveUserContextInput);
}

export { summarizeUser };
