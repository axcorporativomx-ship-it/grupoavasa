const SPREADSHEET_ID = '1p8iVm9GQCxHwTr4CI4wWNiJPO4JuupfO';
const SESSION_TTL_SECONDS = 60 * 60 * 8;
const HASH_ROUNDS = 4000;

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('AVASA Control')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function crearAdministradorInicial() {
  const ui = SpreadsheetApp.getUi();
  const userPrompt = ui.prompt('AVASA Control', 'Nombre de usuario del administrador:', ui.ButtonSet.OK_CANCEL);
  if (userPrompt.getSelectedButton() !== ui.Button.OK) return;
  const username = normalizarUsuario_(userPrompt.getResponseText());
  if (!/^[a-z0-9._-]{4,32}$/.test(username)) throw new Error('El usuario debe tener entre 4 y 32 caracteres.');
  const passPrompt = ui.prompt('AVASA Control', 'Contraseña (mínimo 12 caracteres):', ui.ButtonSet.OK_CANCEL);
  if (passPrompt.getSelectedButton() !== ui.Button.OK) return;
  const password = passPrompt.getResponseText();
  if (password.length < 12) throw new Error('La contraseña debe tener al menos 12 caracteres.');

  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = obtenerHojaUsuarios_();
    if (sheet.getLastRow() > 1) throw new Error('Ya existe al menos un usuario. No se creó otro administrador.');
    guardarUsuario_(sheet, username, password, 'ADMIN');
    ui.alert('Administrador creado', 'El usuario ' + username + ' ya puede entrar.', ui.ButtonSet.OK);
  } finally {
    lock.releaseLock();
  }
}

function apiLogin(usernameInput, passwordInput) {
  const username = normalizarUsuario_(usernameInput);
  const password = String(passwordInput || '');
  if (!username || !password || password.length > 256) return {ok:false,message:'Usuario o contraseña incorrectos.'};
  const sheet = obtenerHojaUsuarios_();
  const rows = sheet.getDataRange().getValues();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (normalizarUsuario_(row[0]) !== username || row[4] !== true) continue;
    const actual = hashPassword_(password, String(row[2]));
    if (!constantTimeEqual_(actual, String(row[1]))) break;
    const token = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
    const expires = Date.now() + SESSION_TTL_SECONDS * 1000;
    PropertiesService.getScriptProperties().setProperty('session_' + digest_(token), JSON.stringify({username:username,role:String(row[3]),expires:expires}));
    sheet.getRange(i + 1, 7).setValue(new Date());
    const roleRaw=String(row[3]||'USER').toUpperCase();\n    const role=(roleRaw==='ADMINISTRADOR'||roleRaw==='ADMIN')?'ADMIN':(roleRaw==='EDITOR'?'EDITOR':'USER');\n    return {ok:true,token:token,username:username,role:role,expires:expires};
  }
  return {ok:false,message:'Usuario o contraseña incorrectos.'};
}

function apiValidateSession(token) {
  const s = obtenerSesion_(token);
  return s ? {ok:true,username:s.username,role:s.role,expires:s.expires} : {ok:false};
}

function apiLogout(token) {
  if (token) PropertiesService.getScriptProperties().deleteProperty('session_' + digest_(String(token)));
  return {ok:true};
}

function apiDashboard(token) {
  const s = exigirSesion_(token);
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const count = name => { const sh=ss.getSheetByName(name); return sh ? Math.max(0,sh.getLastRow()-1) : 0; };
  return {ok:true,username:s.username,role:s.role,users:count(obtenerHojaUsuarios_().getName()),boletines:count('Boletines'),paginas:count('Paginas'),documentos:count('Documentos'),proyectos:count('Proyectos'),empleados:count('Empleados'),sheets:ss.getSheets().map(sh=>sh.getName())};
}

function apiListUsers(token) {
  exigirAdmin_(token);
  const sh=obtenerHojaUsuarios_(), rows=sh.getDataRange().getValues(), users=[];
  for(let i=1;i<rows.length;i++) users.push({username:String(rows[i][0]),role:String(rows[i][3]),active:rows[i][4]===true,created:rows[i][5] ? new Date(rows[i][5]).toISOString() : ''});
  return {ok:true,users:users};
}

function apiCreateUser(token, usernameInput, passwordInput, roleInput) {
  exigirAdmin_(token);
  const username=normalizarUsuario_(usernameInput), password=String(passwordInput||'');
  const role=String(roleInput||'USER').toUpperCase();
  if(!/^[a-z0-9._-]{4,32}$/.test(username)) return {ok:false,message:'Usuario inválido: usa 4 a 32 caracteres.'};
  if(password.length<12 || password.length>256) return {ok:false,message:'La contraseña debe tener entre 12 y 256 caracteres.'};
  if(!['ADMIN','EDITOR','USER'].includes(role)) return {ok:false,message:'Rol no válido.'};
  const sh=obtenerHojaUsuarios_(), rows=sh.getDataRange().getValues();
  if(rows.slice(1).some(r=>normalizarUsuario_(r[0])===username)) return {ok:false,message:'Ese usuario ya existe.'};
  guardarUsuario_(sh,username,password,role);
  return {ok:true};
}

function apiSetUserActive(token, usernameInput, active) {
  exigirAdmin_(token);
  const username=normalizarUsuario_(usernameInput), sh=obtenerHojaUsuarios_(), rows=sh.getDataRange().getValues();
  for(let i=1;i<rows.length;i++) if(normalizarUsuario_(rows[i][0])===username) {
    sh.getRange(i+1,5).setValue(active===true);
    return {ok:true};
  }
  return {ok:false,message:'Usuario no encontrado.'};
}

function obtenerSesion_(token) {
  if(!token || String(token).length>256) return null;
  const props=PropertiesService.getScriptProperties(), key='session_'+digest_(String(token)), raw=props.getProperty(key);
  if(!raw) return null;
  try { const s=JSON.parse(raw); if(!s.expires || Date.now()>s.expires){props.deleteProperty(key);return null;} return s; }
  catch(e){props.deleteProperty(key);return null;}
}
function exigirSesion_(token){const s=obtenerSesion_(token);if(!s)throw new Error('Sesión vencida. Inicia sesión nuevamente.');return s;}
function exigirAdmin_(token){const s=exigirSesion_(token);if(s.role!=='ADMIN')throw new Error('No tienes permisos para administrar usuarios.');return s;}

function obtenerHojaUsuarios_() {
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  const candidates=['Accesos_Sistema','Usuarios'];
  let sheet=null;
  for(const name of candidates){const sh=ss.getSheetByName(name);if(sh && sh.getLastRow()>1){sheet=sh;break;}}
  if(!sheet) for(const name of candidates){const sh=ss.getSheetByName(name);if(sh){sheet=sh;break;}}
  if(!sheet) sheet=ss.insertSheet('Accesos_Sistema');
  if(sheet.getLastRow()===0){sheet.appendRow(['usuario','hash_contrasena','salt','rol','activo','creado','ultimo_acceso']);sheet.setFrozenRows(1);}
  return sheet;
}
function guardarUsuario_(sh,username,password,role){const salt=Utilities.getUuid()+Utilities.getUuid();sh.appendRow([username,hashPassword_(password,salt),salt,role,true,new Date(),'']);}
function normalizarUsuario_(v){return String(v||'').trim().toLowerCase();}
function hashPassword_(password,salt){let v=String(password)+'|'+salt;for(let i=0;i<HASH_ROUNDS;i++)v=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(v,salt));return v;}
function digest_(v){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(v)));}
function constantTimeEqual_(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0;}
