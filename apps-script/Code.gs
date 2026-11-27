const SPREADSHEET_ID = '1p8iVm9GQCxHwTr4CI4wWNiJPO4JuupfO';
const SESSION_TTL = 21600;
const HASH_ROUNDS = 4000;

const SCHEMAS = {
  Accesos_Sistema: ['usuario','hash_contrasena','salt','rol','activo','creado','ultimo_acceso','empleado_id'],
  Boletines: ['id','titulo','resumen','contenido','fecha','estado','publico','imagen'],
  Documentos: ['id','titulo','descripcion','url','categoria','fecha','estado','publico'],
  Galeria: ['id','titulo','descripcion','imagen','fecha','publico'],
  Proyectos: ['id','nombre','descripcion','avance','estado','url','publico'],
  Estadisticas: ['id','indicador','valor','unidad','periodo','publico','orden'],
  Empleados: ['id','nombre','correo','telefono','puesto','departamento','fecha_ingreso','estado'],
  Paginas: ['id','titulo','slug','contenido','estado','publico'],
  Historial: ['fecha','usuario','accion','modulo','detalle']
};

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  if (p.api === 'publicStats') return publicStats_(p.callback || '');
  const view = p.view === 'empleados' ? 'Empleados' : 'Index';
  let output;
  try { output = HtmlService.createHtmlOutputFromFile(view); }
  catch (error) { output = HtmlService.createHtmlOutputFromFile(view.toLowerCase()); }
  return output
    .setTitle(view === 'Empleados' ? 'Portal de colaboradores | Grupo AVASA' : 'AVASA Control')
    .addMetaTag('viewport','width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function inicializarEstructura() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Object.keys(SCHEMAS).forEach(name => {
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(SCHEMAS[name]);
      sh.setFrozenRows(1);
    }
  });
  return 'Estructura revisada. No se modificaron ni eliminaron usuarios existentes.';
}

function apiLogin(usernameInput,passwordInput) {
  const username = norm_(usernameInput);
  const password = String(passwordInput || '');
  if (!username || !password || password.length > 256) return {ok:false,message:'Usuario o contraseña incorrectos.'};
  const sh = usersSheet_(), rows = sh.getDataRange().getValues();
  for (let i=1;i<rows.length;i++) {
    const r=rows[i];
    if (norm_(r[0]) !== username || r[4] !== true) continue;
    if (!safeEqual_(hash_(password,String(r[2])),String(r[1]))) break;
    const role = normalizeRole_(r[3]);
    const token = Utilities.getUuid()+Utilities.getUuid()+Utilities.getUuid();
    const session = {username:username,role:role,employeeId:String(r[7]||''),expires:Date.now()+SESSION_TTL*1000};
    CacheService.getScriptCache().put('avasa_'+digest_(token),JSON.stringify(session),SESSION_TTL);
    sh.getRange(i+1,7).setValue(new Date());
    audit_(username,'Inicio de sesión','Accesos_Sistema','Acceso correcto');
    return {ok:true,token:token,username:username,role:role,expires:session.expires};
  }
  return {ok:false,message:'Usuario o contraseña incorrectos.'};
}

function apiValidateSession(token) {
  const s=session_(token);
  return s ? {ok:true,username:s.username,role:s.role,employeeId:s.employeeId} : {ok:false};
}

function apiLogout(token) {
  if(token) CacheService.getScriptCache().remove('avasa_'+digest_(String(token)));
  return {ok:true};
}

function apiDashboard(token) {
  const s=requireSession_(token), ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  const count=name=>{const sh=ss.getSheetByName(name);return sh?Math.max(0,sh.getLastRow()-1):0;};
  return {ok:true,username:s.username,role:s.role,users:Math.max(0,usersSheet_().getLastRow()-1),boletines:count('Boletines'),documentos:count('Documentos'),galeria:count('Galeria'),proyectos:count('Proyectos'),empleados:count('Empleados'),estadisticas:count('Estadisticas')};
}

function apiListUsers(token) {
  requireRole_(token,['ADMIN']);
  const values=usersSheet_().getDataRange().getValues();
  return {ok:true,users:values.slice(1).filter(r=>r[0]).map(r=>({username:String(r[0]),role:normalizeRole_(r[3]),active:r[4]===true,created:r[5] instanceof Date?r[5].toISOString():String(r[5]||''),employeeId:String(r[7]||'')}))};
}

function apiCreateUser(token,usernameInput,passwordInput,roleInput,employeeId) {
  const actor=requireRole_(token,['ADMIN']);
  const username=norm_(usernameInput), password=String(passwordInput||''), role=normalizeRole_(roleInput);
  if(!/^[a-z0-9._-]{4,32}$/.test(username)) return {ok:false,message:'El usuario debe tener entre 4 y 32 caracteres.'};
  if(password.length<12 || password.length>256) return {ok:false,message:'La contraseña debe tener entre 12 y 256 caracteres.'};
  if(!['ADMIN','RH','EDITOR','EMPLOYEE'].includes(role)) return {ok:false,message:'Rol no válido.'};
  const sh=usersSheet_(), rows=sh.getDataRange().getValues();
  if(rows.slice(1).some(r=>norm_(r[0])===username)) return {ok:false,message:'El usuario ya existe.'};
  const salt=Utilities.getUuid()+Utilities.getUuid();
  sh.appendRow([username,hash_(password,salt),salt,role,true,new Date(),' ',String(employeeId||'')]);
  audit_(actor.username,'Creó usuario','Accesos_Sistema',username+' · '+role);
  return {ok:true};
}

function apiSetUserActive(token,usernameInput,active) {
  const actor=requireRole_(token,['ADMIN']);
  const sh=usersSheet_(), rows=sh.getDataRange().getValues(), username=norm_(usernameInput);
  for(let i=1;i<rows.length;i++) if(norm_(rows[i][0])===username) {
    sh.getRange(i+1,5).setValue(active===true);
    audit_(actor.username,active?'Activó usuario':'Desactivó usuario','Accesos_Sistema',username);
    return {ok:true};
  }
  return {ok:false,message:'Usuario no encontrado.'};
}

function apiListRecords(token,module) {
  const s=requireSession_(token), name=moduleName_(module);
  authorizeRead_(s,name);
  const sh=ensureSheet_(name), values=sh.getDataRange().getValues();
  const headers=values[0]||[];
  const records=values.slice(1).filter(r=>r.some(v=>v!=='' && v!==null)).map(r=>{
    const o={};headers.forEach((h,i)=>o[String(h)]=serialize_(r[i]));return o;
  });
  return {ok:true,headers:headers,records:records};
}

function apiSaveRecord(token,module,data) {
  const s=requireSession_(token), name=moduleName_(module);
  requireRole_(token, name==='Empleados'?['ADMIN','RH']:['ADMIN','EDITOR']);
  const sh=ensureSheet_(name), headers=SCHEMAS[name], item=data||{};
  const id=String(item.id||Utilities.getUuid());
  const row=headers.map(h=>h==='id'?id:(item[h]===undefined?'':item[h]));
  if(name==='Historial') return {ok:false,message:'El historial es de solo registro.'};
  const values=sh.getDataRange().getValues();
  let rowNumber=-1;
  if(headers.includes('id')) for(let i=1;i<values.length;i++) if(String(values[i][0])===id){rowNumber=i+1;break;}
  if(rowNumber>0) sh.getRange(rowNumber,1,1,row.length).setValues([row]);
  else sh.appendRow(row);
  audit_(s.username,'Guardó registro',name,id);
  return {ok:true,id:id};
}

function apiDeleteRecord(token,module,id) {
  const s=requireSession_(token), name=moduleName_(module);
  requireRole_(token,name==='Empleados'?['ADMIN','RH']:['ADMIN','EDITOR']);
  if(name==='Historial' || name==='Accesos_Sistema') throw new Error('Este módulo no permite eliminar registros.');
  const sh=ensureSheet_(name), values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++) if(String(values[i][0])===String(id)) {
    sh.deleteRow(i+1);audit_(s.username,'Eliminó registro',name,String(id));return {ok:true};
  }
  return {ok:false,message:'Registro no encontrado.'};
}

function apiMyProfile(token) {
  const s=requireSession_(token);
  const sh=ensureSheet_('Empleados'), values=sh.getDataRange().getValues();
  for(let i=1;i<values.length;i++) if(String(values[i][0])===s.employeeId || norm_(values[i][2])===s.username) {
    const h=values[0],o={};h.forEach((x,j)=>o[String(x)]=serialize_(values[i][j]));return {ok:true,profile:o};
  }
  return {ok:true,profile:{nombre:s.username,puesto:'Colaborador',departamento:'Por asignar'}};
}

function publicStats_(callback) {
  const sh=ensureSheet_('Estadisticas'), values=sh.getDataRange().getValues();
  const result=values.slice(1).filter(r=>r[5]===true).map(r=>({indicador:String(r[1]||''),valor:String(r[2]||''),unidad:String(r[3]||''),periodo:String(r[4]||'')}));
  const json=JSON.stringify({ok:true,stats:result}).replace(/</g,'\\u003c');
  const safe=/^[a-zA-Z_$][0-9a-zA-Z_$\.]*$/.test(callback)?callback:'callback';
  return ContentService.createTextOutput(safe+'('+json+');').setMimeType(ContentService.MimeType.JAVASCRIPT);
}

function moduleName_(value) {
  const allowed=['Boletines','Documentos','Galeria','Proyectos','Estadisticas','Empleados','Paginas','Historial'];
  if(!allowed.includes(String(value))) throw new Error('Módulo no válido.');
  return String(value);
}
function authorizeRead_(s,name) {
  if(name==='Empleados' && !['ADMIN','RH'].includes(s.role)) throw new Error('No tienes permiso para consultar el directorio.');
  if(name==='Historial' && s.role!=='ADMIN') throw new Error('Acceso restringido.');
}
function requireRole_(token,roles) {
  const s=requireSession_(token);
  if(!roles.includes(s.role)) throw new Error('No tienes permisos para esta acción.');
  return s;
}
function requireSession_(token) {
  const s=session_(token);
  if(!s) throw new Error('Sesión vencida. Inicia sesión nuevamente.');
  return s;
}
function session_(token) {
  if(!token || String(token).length>256) return null;
  const raw=CacheService.getScriptCache().get('avasa_'+digest_(String(token)));
  if(!raw) return null;
  try {const s=JSON.parse(raw);return s.expires>Date.now()?s:null;} catch(e){return null;}
}
function usersSheet_(){return ensureSheet_('Accesos_Sistema');}
function ensureSheet_(name) {
  const ss=SpreadsheetApp.openById(SPREADSHEET_ID);
  let sh=ss.getSheetByName(name);
  if(!sh) sh=ss.insertSheet(name);
  const headers=SCHEMAS[name];
  if(sh.getLastRow()===0){sh.appendRow(headers);sh.setFrozenRows(1);}
  return sh;
}
function audit_(user,action,module,detail) {
  const sh=ensureSheet_('Historial');
  sh.appendRow([new Date(),user,action,module,detail]);
}
function normalizeRole_(role) {
  const r=String(role||'EMPLOYEE').trim().toUpperCase();
  if(r==='ADMINISTRADOR') return 'ADMIN';
  if(r==='RECURSOS_HUMANOS') return 'RH';
  if(['ADMIN','RH','EDITOR','EMPLOYEE'].includes(r)) return r;
  return 'EMPLOYEE';
}
function norm_(v){return String(v||'').trim().toLowerCase();}
function hash_(password,salt) {
  let value=String(password)+'|'+salt;
  for(let i=0;i<HASH_ROUNDS;i++) value=Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(value,salt));
  return value;
}
function digest_(value){return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value)));}
function safeEqual_(a,b){a=String(a);b=String(b);if(a.length!==b.length)return false;let n=0;for(let i=0;i<a.length;i++)n|=a.charCodeAt(i)^b.charCodeAt(i);return n===0;}
function serialize_(v){return v instanceof Date?v.toISOString():v;}
