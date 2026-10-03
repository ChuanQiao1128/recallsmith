"use strict";

const { parseGroups } = require("../../common/validate");

const API_VERSION = process.env.API_VERSION || "v1";

const COGNITO_REGION = process.env.COGNITO_REGION || process.env.AWS_REGION || null;
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || null;

const ADMIN_GROUPS_ENV = process.env.ADMIN_GROUPS || '["super_admin","editor"]';
const DEFAULT_NEW_ADMIN_GROUPS_ENV = process.env.DEFAULT_NEW_ADMIN_GROUPS || '["editor"]';

const COGNITO_SUPPRESS_INVITE =
  String(process.env.COGNITO_SUPPRESS_INVITE || "true").trim().toLowerCase() === "true";

let _client = null;
let _initError = null;

function cognitoClient() {
  if (_client) return _client;
  if (_initError) throw _initError;

  if (!COGNITO_REGION || !COGNITO_USER_POOL_ID) {
    _initError = new Error("Missing env: COGNITO_REGION/AWS_REGION and COGNITO_USER_POOL_ID are required");
    throw _initError;
  }

  const { CognitoIdentityProviderClient } = require("@aws-sdk/client-cognito-identity-provider");
  _client = new CognitoIdentityProviderClient({ region: COGNITO_REGION });
  return _client;
}

function sdk() {
  return require("@aws-sdk/client-cognito-identity-provider");
}

function getCognitoAttr(attrs, name) {
  if (!Array.isArray(attrs)) return null;
  const found = attrs.find((a) => a && a.Name === name);
  return found ? found.Value : null;
}

async function listUsersInGroupAll(groupName) {
  const client = cognitoClient();
  const { ListUsersInGroupCommand } = sdk();

  const out = [];
  let nextToken = undefined;

  do {
    const resp = await client.send(
      new ListUsersInGroupCommand({
        UserPoolId: COGNITO_USER_POOL_ID,
        GroupName: groupName,
        Limit: 60,
        NextToken: nextToken,
      })
    );

    out.push(...(resp?.Users || []));
    nextToken = resp?.NextToken;
  } while (nextToken);

  return out;
}

async function listAdminUsersFromCognito() {
  const adminGroups = parseGroups(ADMIN_GROUPS_ENV);

  const usersByUsername = new Map();
  const groupsByUsername = new Map();

  for (const g of adminGroups) {
    try {
      const users = await listUsersInGroupAll(g);
      for (const u of users) {
        const username = u?.Username ? String(u.Username) : null;
        if (!username) continue;

        if (!groupsByUsername.has(username)) groupsByUsername.set(username, new Set());
        groupsByUsername.get(username).add(g);

        if (!usersByUsername.has(username)) usersByUsername.set(username, u);
      }
    } catch (e) {
      // group 不存在等情况：不要打死接口
      // eslint-disable-next-line no-console
      console.warn(`Cognito listUsersInGroup failed: group=${g}`, e?.name || "", e?.message || e);
    }
  }

  const out = [];
  for (const [username, u] of usersByUsername.entries()) {
    const attrs = u?.Attributes || [];
    const email = getCognitoAttr(attrs, "email");
    const sub = getCognitoAttr(attrs, "sub");
    const enabled = typeof u?.Enabled === "boolean" ? u.Enabled : undefined;
    const status = u?.UserStatus ? String(u.UserStatus) : null;
    const createdAt = u?.UserCreateDate ? new Date(u.UserCreateDate).getTime() : undefined;

    const groups = Array.from(groupsByUsername.get(username) || []);
    out.push({ username, sub: sub || null, email: email || null, enabled, status, groups, createdAt });
  }

  out.sort((a, b) => {
    const as = (a.groups || []).includes("super_admin") ? 0 : 1;
    const bs = (b.groups || []).includes("super_admin") ? 0 : 1;
    if (as !== bs) return as - bs;
    return String(a.username).localeCompare(String(b.username));
  });

  return out;
}

async function createEditorUserInCognito({ username, email, tempPassword }) {
  const client = cognitoClient();
  const { AdminCreateUserCommand, AdminAddUserToGroupCommand } = sdk();

  const safeUsername = String(username).trim();
  const safeEmail = String(email).trim();
  const safeTemp = String(tempPassword);

  const groups = parseGroups(DEFAULT_NEW_ADMIN_GROUPS_ENV);
  const effective = groups.length > 0 ? groups : ["editor"];

  // 防止有人配置成 super_admin（这个入口只创建 editor 类账号）
  if (effective.some((g) => String(g).toLowerCase() === "super_admin")) {
    throw new Error("DEFAULT_NEW_ADMIN_GROUPS must not include super_admin (console only creates editors).");
  }

  const createResp = await client.send(
    new AdminCreateUserCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      Username: safeUsername,
      TemporaryPassword: safeTemp,
      MessageAction: COGNITO_SUPPRESS_INVITE ? "SUPPRESS" : undefined,
      UserAttributes: [
        { Name: "email", Value: safeEmail },
        { Name: "email_verified", Value: "true" },
      ],
    })
  );

  for (const g of effective) {
    await client.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: COGNITO_USER_POOL_ID,
        Username: safeUsername,
        GroupName: g,
      })
    );
  }

  const createdUser = createResp?.User || null;
  const attrs = createdUser?.Attributes || [];
  const sub = getCognitoAttr(attrs, "sub");
  const createdAt = createdUser?.UserCreateDate ? new Date(createdUser.UserCreateDate).getTime() : undefined;
  const enabled = typeof createdUser?.Enabled === "boolean" ? createdUser.Enabled : undefined;
  const status = createdUser?.UserStatus ? String(createdUser.UserStatus) : null;

  return {
    username: safeUsername,
    sub: sub || null,
    email: safeEmail,
    enabled,
    status,
    groups: effective,
    createdAt,
  };
}

async function disableUserInCognito(username) {
  const client = cognitoClient();
  const { AdminDisableUserCommand } = sdk();
  await client.send(
    new AdminDisableUserCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      Username: String(username).trim(),
    })
  );
  return { disabled: true };
}

async function deleteUserInCognito(username) {
  const client = cognitoClient();
  const { AdminDeleteUserCommand } = sdk();
  await client.send(
    new AdminDeleteUserCommand({
      UserPoolId: COGNITO_USER_POOL_ID,
      Username: String(username).trim(),
    })
  );
  return { deleted: true };
}

module.exports = {
  API_VERSION,
  listAdminUsersFromCognito,
  createEditorUserInCognito,
  disableUserInCognito,
  deleteUserInCognito,
};
