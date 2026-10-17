/**
 * Users.js — login + session + guards
 * Patterns: rules/security.md Rules #1-#3
 */

// ── Login: issue a session token — never trust a client-held userId (Rule #2)
function login(username, password) {
  try {
    Logger.log('[login] username=' + username);
    const user = readSheet_(getSs_().getSheetByName('Users'))
      .find(u => String(u.Username) === String(username));
    if (!user) return { ok: false, message: 'Incorrect username or password' };
    if (user.Active === false || user.Active === 'false') {
      return { ok: false, message: 'This account has been disabled' };
    }

    const expected = hashPassword_(password, String(user.PasswordSalt));
    if (expected !== String(user.PasswordHash)) {
      return { ok: false, message: 'Incorrect username or password' };
    }

    const token = Utilities.getUuid();
    appendRowByHeaders_(getSs_().getSheetByName('Sessions'), {
      Token: token,
      UserID: user.UserID,
      ExpiresAt: Date.now() + 8 * 60 * 60 * 1000, // 8 hours
      CreatedAt: new Date().toISOString(),
    });
    Logger.log('[login] OK userId=' + user.UserID);
    return { ok: true, token: token, displayName: user.DisplayName, role: user.Role };
  } catch (err) {
    Logger.log('[login] EXCEPTION: ' + (err.stack || err));
    return { ok: false, message: 'Something went wrong, please try again' };
  }
}

// ── Guards — call at the top of every RPC (Rule #1)
function requireSession_(token) {
  if (!token) throw new Error('Please log in');
  const s = readSheet_(getSs_().getSheetByName('Sessions')).find(r => String(r.Token) === String(token));
  if (!s || Number(s.ExpiresAt) < Date.now()) throw new Error('Session expired, please log in again');
  const user = readSheet_(getSs_().getSheetByName('Users')).find(u => String(u.UserID) === String(s.UserID));
  if (!user) throw new Error('User not found');
  return user;
}

function requireRole_(user, allowedRoles) {
  if (!Array.isArray(allowedRoles)) allowedRoles = [allowedRoles];
  if (!allowedRoles.includes(user.Role)) throw new Error('You do not have permission to perform this action');
}

// ── Password hashing — PBKDF2-style loop using GAS (Rule #3)
function hashPassword_(password, salt) {
  let bytes = Utilities.newBlob(password).getBytes();
  const saltBytes = Utilities.newBlob(salt).getBytes();
  for (let i = 0; i < 10000; i++) {
    bytes = Utilities.computeHmacSha256Signature(bytes, saltBytes);
  }
  return Utilities.base64Encode(bytes);
}

// Run once from the editor to create the first admin, then change the password immediately
function _setup_createAdmin() {
  ensureSchema();
  const salt = Utilities.getUuid();
  appendRowByHeaders_(getSs_().getSheetByName('Users'), {
    UserID: 'U001',
    Username: 'admin',
    DisplayName: 'System Administrator',
    Role: 'admin',
    PasswordHash: hashPassword_('changeme', salt),
    PasswordSalt: salt,
    Active: 'true',
  });
}