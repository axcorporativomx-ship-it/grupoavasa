const SPREADSHEET_ID = '1p8iVm9GQCxHwTr4CI4wWNiJPO4JuupfO';
const USERS_SHEET = 'Usuarios';
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const HASH_ROUNDS = 4000;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('AVASA Control')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/**
 * Ejecuta esta función manualmente desde el editor de Apps Script como propietario.
 * Crea el primer administrador de forma privada; nunca habilita el registro público.
 */
function crearAdministradorInicial() {
  const ui = SpreadsheetApp.getUi();
  const userPrompt = ui.prompt('AVASA Control', 'Escribe el nombre de usuario del administrador:', ui.ButtonSet.OK_CANCEL);
  if (userPrompt.getSelectedButton() !== ui.Button.OK) return;
  const username = normalizarUsuario_(userPrompt.getResponseText());
  if (!/^[a-z0-9._-]{4,32}$/.test(username)) throw new Error('El usuario debe tener entre 4 y 32 caracteres: letras, números, punto, guion o guion bajo.');

  const passPrompt = ui.prompt('AVASA Control', 'Crea una contraseña de al menos 12 caracteres. No la compartas:', ui.ButtonSet.OK_CANCEL);
  if (passPrompt.getSelectedButton() !== ui.Button.OK) return;
  const password = passPrompt.getResponseText();
  if (password.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = obtenerHojaUsuarios_();
    if (sheet.getLastRow() > 1) throw new Error('Ya existen usuarios. No se puede volver a crear el administrador inicial.');
    const salt = Utilities.getUuid() + Utilities.getUuid();
    const hash = hashPassword_(password, salt);
    sheet.appendRow([username, hash, salt, 'ADMIN', true, new Date(), '']);
    ui.alert('Administrador creado', 'El usuario ' + username + ' ya puede iniciar sesión en AVASA Control.', ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

function apiLogin(usernameInput, passwordInput) {
  const username = normalizarUsuario_(usernameInput);
  const password = String(passwordInput || '');
  if (!username || !password || password.length > 256) return { ok: false, message: 'Usuario o contraseña incorrectos.' };

  const sheet = obtenerHojaUsuarios_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (String(row[0]).toLowerCase() !== username || row[4] !== true) continue;
    const expected = String(row[1]);
    const actual = hashPassword_(password, String(row[2]));
    if (!constantTimeEqual_(actual, expected)) break;

    const token = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    const tokenHash = digest_(token);
    const expires = Date.now() + SESSION_TTL_SECONDS * 1000;
    PropertiesService.getScriptProperties().setProperty('session_' + tokenHash, JSON.stringify({
      username: username, role: String(row[3]), expires: expires
    }));
    sheet.getRange(i + 1, 7).setValue(new Date());
    return { ok: true, token: token, username: username, role: String(row[3]), expires: expires };
  }
  return { ok: false, message: 'Usuario o contraseña incorrectos.' };
}

function apiValidateSession(token) {
  const session = obtenerSesion_(token);
  if (!session) return { ok: false };
  return { ok: true, username: session.username, role: session.role, expires: session.expires };
}

function apiLogout(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('session_' + digest_(String(token)));
  return { ok: true };
}

function obtenerSesion_(token) {
  if (!token || String(token).length > 256) return null;
  const key = 'session_' + digest_(String(token));
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(key);
  if (!raw) return null;
  try {
    const session = JSON.parse(raw);
    if (!session.expires || Date.now() > session.expires) {
      props.deleteProperty(key);
      return null;
    }
    return session;
  } catch (e) {
    props.deleteProperty(key);
    return null;
  }
}

function obtenerHojaUsuarios_() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet = ss.getSheetByName(USERS_SHEET);
  if (!sheet) sheet = ss.insertSheet(USERS_SHEET);
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(['usuario', 'hash_contrasena', 'salt', 'rol', 'activo', 'creado', 'ultimo_acceso']);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function normalizarUsuario_(value) {
  return String(value || '').trim().toLowerCase();
}

function hashPassword_(password, salt) {
  let value = String(password) + '|' + salt;
  for (let i = 0; i < HASH_ROUNDS; i++) {
    value = Utilities.base64EncodeWebSafe(
      Utilities.computeHmacSha256Signature(value, salt)
    );
  }
  return value;
}

function digest_(value) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value))
  );
}

function constantTimeEqual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
