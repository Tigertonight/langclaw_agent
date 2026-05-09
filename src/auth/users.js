import {
  LocalPermissionProvider,
  LocalUserDirectory,
  UserContextResolver,
  summarizeUser
} from "./user-context-resolver.js";

const defaultResolver = new UserContextResolver({
  directory: new LocalUserDirectory(),
  permissionProvider: new LocalPermissionProvider()
});

export async function getUserContext(userId) {
  return defaultResolver.resolve({ userId });
}

export { summarizeUser };
