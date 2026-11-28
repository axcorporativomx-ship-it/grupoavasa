/* Grupo AVASA API transport: GitHub Pages -> Apps Script via hidden form iframe. */
(() => {
  'use strict';
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbzRA5dJ8SsRasl4iDux_wOpIRHwRrCHo3WHc9q0wghVuRxAHHayQHAhp3p1x3OySqWP/exec';
  const pending = new Map();

  const normalizeRole = role => {
    const value = String(role || '').toLowerCase();
    if (value === 'admin') return 'ADMIN';
    if (value === 'editor') return 'EDITOR';
    if (value === 'rh') return 'RH';
    return 'EMPLOYEE';
  };

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== 'AVASA_API' || !msg.nonce) return;
    const task = pending.get(msg.nonce);
    if (!task) return;
    pending.delete(msg.nonce);
    clearTimeout(task.timer);
    task.form.remove();
    task.iframe.remove();
    if (msg.result && typeof msg.result === 'object') task.resolve(msg.result);
    else task.reject(new Error('Respuesta inválida del servidor.'));
  });

  function request(action, data = {}) {
    return new Promise((resolve, reject) => {
      const nonce = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(36).slice(2));
      const iframe = document.createElement('iframe');
      iframe.name = 'avasa_api_' + nonce.replace(/[^a-z0-9]/gi, '');
      iframe.title = 'Conexión con Grupo AVASA';
      iframe.hidden = true;
      iframe.setAttribute('aria-hidden', 'true');

      const form = document.createElement('form');
      form.method = 'POST';
      form.action = ENDPOINT;
      form.target = iframe.name;
      form.hidden = true;

      const input = document.createElement('input');
      input.type = 'hidden';
      input.name = 'payload';
      input.value = JSON.stringify({ action, data, token: data.token || '', nonce });
      form.appendChild(input);

      const timer = setTimeout(() => {
        pending.delete(nonce);
        form.remove();
        iframe.remove();
        reject(new Error('El servidor tardó demasiado. Verifica la implementación de Apps Script e inténtalo otra vez.'));
      }, 30000);

      pending.set(nonce, { resolve, reject, iframe, form, timer });
      document.body.append(iframe, form);
      try { form.submit(); }
      catch (error) {
        pending.delete(nonce);
        clearTimeout(timer);
        form.remove();
        iframe.remove();
        reject(error);
      }
    });
  }

  async function login(username, password) {
    const r = await request('login', { username, password });
    if (r.ok && r.user) return { ...r, username: r.user.usuario, role: normalizeRole(r.user.rol) };
    return r;
  }

  async function validateSession(token) {
    const r = await request('validateSession', { token });
    if (r.ok && r.user) return { ...r, username: r.user.usuario, role: normalizeRole(r.user.rol) };
    return r;
  }

  async function dashboard(token) {
    const r = await request('dashboard', { token });
    if (!r.ok) return r;
    const s = r.estadisticas || {};
    return {
      ...r,
      users: s.Usuarios || 0,
      boletines: s.Boletines || 0,
      documentos: s.Documentos || 0,
      proyectos: s.Proyectos || 0,
      galeria: s.Galeria || 0,
      empleados: s.Empleados || 0,
      estadisticas: s.Estadisticas || 0
    };
  }

  async function listUsers(token) {
    const r = await request('listUsers', { token });
    if (!r.ok) return r;
    return {
      ...r,
      users: (r.users || []).map(u => ({
        username: u.usuario,
        role: normalizeRole(u.rol),
        active: u.activo === true || String(u.activo).toLowerCase() === 'true',
        created: u.creado,
        lastLogin: u.ultimo_acceso,
        employeeId: u.empleado_id
      }))
    };
  }

  function createUser(token, username, password, role, employeeId = '') {
    const roles = { ADMIN: 'admin', EDITOR: 'editor', RH: 'editor', EMPLOYEE: 'consulta' };
    return request('createUser', {
      token, usuario: username, password,
      rol: roles[String(role).toUpperCase()] || 'consulta',
      empleado_id: employeeId
    });
  }

  function setUserActive(token, username, active) {
    return request('setUserActive', { token, usuario: username, activo: active });
  }

  window.AvasaAPI = Object.freeze({
    request,
    login,
    validateSession,
    logout: token => request('logout', { token }),
    dashboard,
    listUsers,
    createUser,
    setUserActive,
    listRecords: (token, module) => request('listRecords', { token, modulo: module }),
    saveRecord: (token, module, record) => request('saveRecord', { token, modulo: module, record }),
    deleteRecord: (token, module, id) => request('deleteRecord', { token, modulo: module, id }),
    myProfile: token => request('myProfile', { token }),
    generateDocument: (token, documentData) => request('generateDocument', { token, documentData })
  });
})();