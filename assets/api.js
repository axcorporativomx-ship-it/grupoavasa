/* Grupo AVASA API transport: GitHub Pages -> Apps Script via hidden form iframe. */
(() => {
  'use strict';
  const ENDPOINT = 'https://script.google.com/macros/s/AKfycbybSp25g8kRdOrk90CQ1zdLrqowOjEfdDvKlhGvw__GHQj434D66c0gpV8aKJXySA7W4Q/exec';
  const pending = new Map();

  window.addEventListener('message', (event) => {
    const msg = event.data;
    if (!msg || msg.channel !== 'AVASA_API' || !msg.nonce) return;
    const task = pending.get(msg.nonce);
    // Apps Script HtmlService puede envolver la respuesta en un frame interno;
    // el WindowProxy del emisor puede no coincidir con el iframe exterior.
    // El nonce aleatorio vincula la respuesta con la solicitud pendiente.
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
      iframe.title = 'Conexión segura con Grupo AVASA';
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
      input.value = JSON.stringify({ action, data, nonce });
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

  window.AvasaAPI = Object.freeze({
    request,
    login: (username, password) => request('login', { username, password }),
    validateSession: token => request('validateSession', { token }),
    logout: token => request('logout', { token }),
    dashboard: token => request('dashboard', { token }),
    listUsers: token => request('listUsers', { token }),
    createUser: (token, username, password, role, employeeId = '') => request('createUser', { token, username, password, role, employeeId }),
    setUserActive: (token, username, active) => request('setUserActive', { token, username, active }),
    listRecords: (token, module) => request('listRecords', { token, module }),
    saveRecord: (token, module, record) => request('saveRecord', { token, module, record }),
    deleteRecord: (token, module, id) => request('deleteRecord', { token, module, id }),
    myProfile: token => request('myProfile', { token })
  });
})();
