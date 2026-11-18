/* Dispositivos via IP — painel estático sem dependências.
   Guarda a configuração em localStorage e envia comandos HTTP para os dispositivos. */
(() => {
  'use strict';

  const STORAGE_KEY = 'chatfilipe:dispositivos:v1';
  const LOG_KEY = 'chatfilipe:log:v1';
  const MAX_LOG = 60;
  const RADMIN_HELPER = 'C:\\Users\\JCPereira\\Desktop\\Filipe Pereira\\ChatFilipe\\conectar-radmin.cmd';
  const RADMIN_PORTA = '4899';

  // Valores fixos: o formulário só pede o IP, o nome e o tipo.
  const FIXO = { porta: '80', https: false, cors: true, timeout: 3000, modulo: '0' };

  const TIPO_LABELS = {
    pc: 'PC', tasmota: 'Tasmota', shelly: 'Shelly', generico: 'HTTP', custom: 'Personalizado'
  };

  const PRESETS = {
    pc: {
      modulo: false,
      on: () => 'on',
      off: () => 'off',
      status: () => 'status'
    },
    tasmota: {
      modulo: true,
      on: (m) => `cm?cmnd=Power${m}%20On`,
      off: (m) => `cm?cmnd=Power${m}%20Off`,
      status: (m) => `cm?cmnd=Power${m}`
    },
    shelly: {
      modulo: true,
      on: (m) => `relay/${m}?turn=on`,
      off: (m) => `relay/${m}?turn=off`,
      status: (m) => `relay/${m}`
    },
    generico: {
      modulo: false,
      on: () => 'on',
      off: () => 'off',
      status: () => 'status'
    },
    custom: { modulo: false, on: () => '', off: () => '', status: () => '' }
  };

  const DEMO_DEVICES = [
    { id: 'demo-1', nome: 'Tomada da secretária', host: '192.168.1.50', porta: 80, tipo: 'tasmota', modulo: 0, on: 'cm?cmnd=Power%20On', off: 'cm?cmnd=Power%20Off', status: 'cm?cmnd=Power', notas: 'Exemplo Tasmota', https: false, cors: true, timeout: 3000, state: 'off', online: true },
    { id: 'demo-2', nome: 'Luz da-oficina', host: '192.168.1.51', porta: 80, tipo: 'shelly', modulo: 0, on: 'relay/0?turn=on', off: 'relay/0?turn=off', status: 'relay/0', notas: 'Exemplo Shelly', https: false, cors: true, timeout: 3000, state: 'on', online: true },
    { id: 'demo-3', nome: 'PC do escritório', host: '192.168.1.60', porta: 80, tipo: 'pc', modulo: 0, on: 'on', off: 'off', status: 'status', notas: 'Exemplo de PC na rede', https: false, cors: true, timeout: 3000, state: 'unknown', online: false }
  ];

  const $ = (sel) => document.querySelector(sel);
  const els = {
    lista: $('#list'), vazio: $('#empty'), log: $('#log'), search: $('#search'),
    modal: $('#modal'), form: $('#device-form'), toast: $('#toast'),
    fileImport: $('#file-import'), btnDemo: $('#btn-demo')
  };

  let devices = carregar(STORAGE_KEY, []);
  let logs = carregar(LOG_KEY, []);
  let demo = false;
  let comandos = 0;
  let editandoId = null;
  let toastTimer = null;

  /* ---------- utilitários ---------- */

  function carregar(chave, fallback) {
    try {
      const valor = JSON.parse(localStorage.getItem(chave));
      return Array.isArray(valor) ? valor : fallback;
    } catch (_) { return fallback; }
  }

  function guardar() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(devices.map(({ state, online, ...d }) => d)));
    } catch (e) { aviso('Não foi possível guardar no localStorage.'); }
  }

  function guardarLog() {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(logs.slice(0, MAX_LOG))); } catch (_) { /* sem espaço */ }
  }

  function uid() {
    return 'd' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function el(tag, classe, texto) {
    const n = document.createElement(tag);
    if (classe) n.className = classe;
    if (texto !== undefined) n.textContent = texto;
    return n;
  }

  function baseUrl(d) {
    return `${d.https ? 'https' : 'http'}://${d.host}${d.porta ? ':' + d.porta : ''}`;
  }

  function fullUrl(d, caminho) {
    if (/^https?:\/\//i.test(caminho)) return caminho;
    return baseUrl(d) + '/' + String(caminho || '').replace(/^\/+/, '');
  }

  function caminho(d, acao) {
    const valor = d[acao];
    return typeof valor === 'string' ? valor.trim() : '';
  }

  function parseEstado(d, texto) {
    if (!texto) return 'unknown';
    try {
      const obj = JSON.parse(texto);
      const v = obj.POWER ?? obj.power ?? obj.ison ?? obj.state ?? obj.value ?? obj.on ?? obj.status;
      if (typeof v === 'boolean') return v ? 'on' : 'off';
      if (typeof v === 'number') return v ? 'on' : 'off';
      if (typeof v === 'string') {
        if (/^(on|true|1|ligad)/i.test(v)) return 'on';
        if (/^(off|false|0|deslig)/i.test(v)) return 'off';
      }
    } catch (_) { /* texto simples */ }
    if (/\b(POWER|state|status)\b["'=:\s]+(ON|on|true|1|ligado)\b/i.test(texto)) return 'on';
    if (/\b(POWER|state|status)\b["'=:\s]+(OFF|off|false|0|desligado)\b/i.test(texto)) return 'off';
    return 'unknown';
  }

  function toast(msg, tipo = '') {
    els.toast.textContent = msg;
    els.toast.className = 'toast' + (tipo ? ' ' + tipo : '');
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { els.toast.hidden = true; }, 3600);
  }

  function registrar(msg, tipo = '') {
    logs.unshift({ hora: new Date().toISOString(), msg, tipo });
    logs = logs.slice(0, MAX_LOG);
    guardarLog();
    renderLog();
  }

  /* ---------- comunicação ---------- */

  async function pedir(d, acao, metodo = 'GET') {
    const path = acao === 'ping' ? '/' : caminho(d, acao);
    if (!path) return { ok: false, erro: `Sem caminho para "${acao}".` };

    if (demo) {
      await new Promise((r) => setTimeout(r, 220 + Math.random() * 260));
      if (acao === 'ping') return { ok: true, opaco: true, texto: '' };
      if (acao === 'status') {
        return { ok: true, opaco: false, texto: JSON.stringify({ POWER: d.state === 'on' ? 'ON' : 'OFF' }) };
      }
      if (acao === 'on' || acao === 'off') {
        d.state = acao === 'on' ? 'on' : 'off';
        return { ok: true, opaco: false, texto: 'ok' };
      }
      return { ok: true, opaco: false, texto: 'ok' };
    }

    const url = fullUrl(d, path);
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), Number(d.timeout) || 3000);
    try {
      const resp = await fetch(url, {
        method: metodo,
        mode: d.cors ? 'cors' : 'no-cors',
        cache: 'no-store',
        credentials: 'omit',
        signal: ctrl.signal
      });
      clearTimeout(timer);
      const opaco = resp.type === 'opaque';
      let texto = '';
      if (!opaco) texto = await resp.text().catch(() => '');
      return { ok: true, opaco, status: resp.status, texto };
    } catch (e) {
      clearTimeout(timer);
      const erro = e.name === 'AbortError' ? 'Tempo limite excedido' : (e.message || 'Falha de rede');
      return { ok: false, erro };
    }
  }

  async function executar(d, acao) {
    if (!demo) comandos++;
    const resultado = await pedir(d, acao);

    if (!resultado.ok) {
      d.online = false;
      registrar(`${d.nome}: falha em ${acao} — ${resultado.erro}`, 'erro');
      render();
      return false;
    }

    d.online = true;
    if (acao === 'ping') {
      registrar(`${d.nome}: dispositivo acessível em ${baseUrl(d)}.`, 'ok');
    } else if (acao === 'status') {
      if (resultado.opaco) {
        d.state = 'unknown';
        registrar(`${d.nome}: resposta opaca (usa CORS para ler o estado).`, 'aviso');
      } else {
        d.state = parseEstado(d, resultado.texto);
        registrar(`${d.nome}: estado = ${d.state === 'on' ? 'ligado' : d.state === 'off' ? 'desligado' : 'desconhecido'}.`, d.state === 'unknown' ? 'aviso' : 'ok');
      }
    } else {
      d.state = acao === 'on' ? 'on' : 'off';
      const detalhe = resultado.opaco ? 'enviado (resposta opaca)' : `HTTP ${resultado.status ?? 'ok'}`;
      registrar(`${d.nome}: comando ${acao.toUpperCase()} ${detalhe}.`, 'ok');
      if (d.cors && !resultado.opaco) {
        setTimeout(() => { pedir(d, 'status').then((r) => {
          if (r.ok && !r.opaco) d.state = parseEstado(d, r.texto);
          render();
        }); }, 450);
      }
    }
    render();
    return true;
  }

  async function verificarTodos() {
    if (!devices.length) { toast('Não há dispositivos para verificar.', 'aviso'); return; }
    registrar('Verificação geral iniciada.', 'aviso');
    await Promise.all(devices.map((d) => pedir(d, 'status').then((r) => {
      if (!r.ok) { d.online = false; return; }
      d.online = true;
      if (!r.opaco) d.state = parseEstado(d, r.texto);
    })));
    registrar('Verificação geral concluída.', 'ok');
    render();
  }

  /* ---------- renderização ---------- */

  function render() {
    const termo = els.search.value.trim().toLocaleLowerCase('pt-PT');
    const visiveis = devices.filter((d) =>
      !termo || `${d.nome} ${d.host} ${d.notas || ''}`.toLocaleLowerCase('pt-PT').includes(termo));

    els.lista.replaceChildren();
    els.vazio.hidden = visiveis.length > 0;

    visiveis.forEach((d) => {
      const card = el('article', 'card' + (d.online === false ? ' is-offline' : ''));

      const topo = el('div', 'card-top');
      const titulo = el('div', 'card-title');
      titulo.append(el('h3', '', d.nome), el('span', 'badge', TIPO_LABELS[d.tipo] || d.tipo || 'custom'));
      const acoesTopo = el('div', 'card-actions-top');
      const btnEditar = el('button', 'icon-btn', '✎');
      btnEditar.type = 'button'; btnEditar.title = 'Editar'; btnEditar.setAttribute('aria-label', 'Editar ' + d.nome);
      btnEditar.addEventListener('click', () => abrirModal(d));
      const btnApagar = el('button', 'icon-btn', '×');
      btnApagar.type = 'button'; btnApagar.title = 'Remover'; btnApagar.setAttribute('aria-label', 'Remover ' + d.nome);
      btnApagar.addEventListener('click', () => remover(d));
      acoesTopo.append(btnEditar, btnApagar);
      topo.append(titulo, acoesTopo);

      const endpoint = el('div', 'card-endpoint', fullUrl(d, caminho(d, 'status') || '/'));

      const pills = el('div', 'pills');
      const online = d.online === undefined ? 'unknown' : (d.online ? 'online' : 'offline');
      const pillOnline = el('span', 'pill ' + online);
      pillOnline.append(el('span', 'dot'), document.createTextNode(
        online === 'online' ? 'Online' : online === 'offline' ? 'Offline' : 'Por verificar'));
      const estado = d.state === 'on' || d.state === 'off' ? d.state : 'unknown';
      const pillEstado = el('span', 'pill ' + (estado === 'on' ? 'state-on' : estado === 'unknown' ? 'unknown' : ''));
      pillEstado.append(el('span', 'dot'), document.createTextNode(
        estado === 'on' ? 'Ligado' : estado === 'off' ? 'Desligado' : 'Estado ?'));
      pills.append(pillOnline, pillEstado);

      const acoes = el('div', 'card-actions');
      acoes.append(
        btnAcao('Ligar', 'btn btn-small btn-on', d, 'on'),
        btnAcao('Desligar', 'btn btn-small btn-off', d, 'off'),
        btnAcao('Ver estado', 'btn btn-small', d, 'status'),
        btnAcao('Testar ligação', 'btn btn-small', d, 'ping'),
        btnAbrirRadmin(d),
        btnCopiarRadmin(d)
      );

      card.append(topo, endpoint);
      if (d.notas) card.append(el('p', 'card-note', d.notas));
      card.append(pills, acoes);
      els.lista.append(card);
    });

    $('#stat-total').textContent = devices.length;
    $('#stat-online').textContent = devices.filter((d) => d.online === true).length;
    $('#stat-on').textContent = devices.filter((d) => d.state === 'on').length;
    $('#stat-commands').textContent = comandos;
  }

  function btnAcao(texto, classe, d, acao) {
    const b = el('button', classe, texto);
    b.type = 'button';
    b.addEventListener('click', async () => {
      b.disabled = true;
      try { await executar(d, acao); }
      finally { b.disabled = false; }
    });
    return b;
  }

  function btnAbrirRadmin(d) {
    const b = el('button', 'btn btn-small', 'Abrir no Radmin');
    b.type = 'button';
    b.title = 'Abre o Radmin Viewer diretamente (requer registar-protocolo.reg)';
    b.addEventListener('click', () => {
      window.location.href = `radfilipe://${d.host}:${RADMIN_PORTA}/`;
      registrar(`${d.nome}: pedido de ligação Radmin para ${d.host}:${RADMIN_PORTA}.`);
      toast('A abrir o Radmin… se nada acontecer, executa registar-protocolo.reg.', 'ok');
    });
    return b;
  }

  function btnCopiarRadmin(d) {
    const b = el('button', 'btn btn-small', 'Copiar comando Radmin');
    b.type = 'button';
    b.title = 'Copia o comando para colar no Executar (Win+R)';
    b.addEventListener('click', async () => {
      const comando = `"${RADMIN_HELPER}" ${d.host} ${RADMIN_PORTA}`;
      const copiado = await copiarTexto(comando);
      if (copiado) {
        toast('Comando Radmin copiado. Cola no Executar (Win+R).', 'ok');
        registrar(`${d.nome}: comando Radmin copiado para ${d.host}:${RADMIN_PORTA}.`);
      } else {
        toast('Não foi possível copiar. Comando: ' + comando, 'erro');
      }
    });
    return b;
  }

  async function copiarTexto(texto) {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(texto);
        return true;
      }
    } catch (_) { /* tenta o método antigo */ }
    try {
      const ta = el('textarea');
      ta.value = texto;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.append(ta);
      ta.select();
      const ok = document.execCommand('copy');
      ta.remove();
      return ok;
    } catch (_) { return false; }
  }

  function renderLog() {
    els.log.replaceChildren();
    if (!logs.length) {
      const li = el('li', 'log-vazio', 'Sem atividade registada.');
      els.log.append(li);
      return;
    }
    logs.forEach((item) => {
      const li = el('li');
      const data = new Date(item.hora);
      li.append(el('time', '', isNaN(data) ? '--:--' : data.toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })));
      li.append(el('span', 'log-msg ' + (item.tipo || ''), item.msg));
      els.log.append(li);
    });
  }

  /* ---------- modal / formulário ---------- */

  function presetPaths(tipo, modulo) {
    const p = PRESETS[tipo] || PRESETS.custom;
    const m = String(modulo ?? 0);
    return p.modulo ? { on: p.on(m), off: p.off(m), status: p.status(m) }
                    : { on: p.on(), off: p.off(), status: p.status() };
  }

  function abrirModal(d) {
    editandoId = d ? d.id : null;
    $('#modal-titulo').textContent = d ? 'Editar dispositivo' : 'Adicionar dispositivo';
    $('#btn-save').textContent = d ? 'Guardar alterações' : 'Guardar dispositivo';
    $('#f-host').value = d?.host || '';
    $('#f-nome').value = d?.nome || '';
    $('#f-tipo').value = d && PRESETS[d.tipo] ? d.tipo : 'pc';
    els.modal.hidden = false;
    setTimeout(() => $('#f-host').focus(), 30);
  }

  function fecharModal() {
    els.modal.hidden = true;
    editandoId = null;
  }

  function guardarForm(e) {
    e.preventDefault();
    const f = new FormData(els.form);
    const host = String(f.get('host') || '').trim();
    if (!host) { toast('Indica o endereço IP do dispositivo.', 'erro'); return; }
    const tipo = String(f.get('tipo') || 'pc');
    const nomeOuAuto = String(f.get('nome') || '').trim();
    const nome = nomeOuAuto || `${TIPO_LABELS[tipo] || 'Dispositivo'} ${host}`;
    const paths = presetPaths(tipo, FIXO.modulo);

    const dados = {
      id: editandoId || uid(),
      nome, host, tipo,
      porta: FIXO.porta,
      modulo: FIXO.modulo,
      on: paths.on, off: paths.off, status: paths.status,
      notas: '',
      https: FIXO.https,
      cors: FIXO.cors,
      timeout: FIXO.timeout
    };

    const anterior = devices.find((d) => d.id === dados.id);
    Object.assign(dados, { state: anterior?.state || 'unknown', online: anterior?.online });

    if (editandoId) {
      const i = devices.findIndex((d) => d.id === editandoId);
      if (i >= 0) devices[i] = dados;
      registrar(`${dados.nome}: dispositivo atualizado.`, 'ok');
    } else {
      devices.push(dados);
      registrar(`${dados.nome}: dispositivo adicionado.`, 'ok');
    }
    guardar(); render(); fecharModal();
    toast(editandoId ? 'Dispositivo atualizado.' : 'Dispositivo adicionado.', 'ok');
  }

  function remover(d) {
    if (!confirm(`Remover "${d.nome}" da lista?`)) return;
    devices = devices.filter((x) => x.id !== d.id);
    guardar(); render();
    registrar(`${d.nome}: removido da lista.`, 'aviso');
  }

  /* ---------- importar / exportar / demo ---------- */

  function exportar() {
    const dados = JSON.stringify({ versao: 1, exportadoEm: new Date().toISOString(), dispositivos: devices }, null, 2);
    const url = URL.createObjectURL(new Blob([dados], { type: 'application/json' }));
    const a = el('a');
    a.href = url; a.download = 'dispositivos-ip.json';
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('Lista exportada.', 'ok');
  }

  function importar(file) {
    const leitor = new FileReader();
    leitor.onload = () => {
      try {
        const json = JSON.parse(String(leitor.result));
        const lista = Array.isArray(json) ? json : json.dispositivos;
        if (!Array.isArray(lista)) throw new Error('formato inválido');
        const limpos = lista
          .filter((d) => d && typeof d.host === 'string')
          .map((d) => ({
            id: d.id || uid(),
            nome: String(d.nome || d.host).slice(0, 60),
            host: String(d.host).slice(0, 120),
            porta: String(d.porta || '').slice(0, 5),
            tipo: PRESETS[d.tipo] ? d.tipo : 'custom',
            modulo: String(d.modulo || '0'),
            on: String(d.on || ''), off: String(d.off || ''), status: String(d.status || ''),
            notas: String(d.notas || '').slice(0, 140),
            https: !!d.https, cors: d.cors !== false,
            timeout: Number(d.timeout) || 3000,
            state: 'unknown', online: undefined
          }));
        if (!limpos.length) throw new Error('lista vazia');
        if (!confirm(`Importar ${limpos.length} dispositivo(s)? A lista atual será substituída.`)) return;
        devices = limpos;
        guardar(); render();
        registrar(`${limpos.length} dispositivo(s) importados.`, 'ok');
        toast('Importação concluída.', 'ok');
      } catch (e) {
        toast('Não foi possível importar o ficheiro.', 'erro');
      }
    };
    leitor.readAsText(file);
  }

  function alternarDemo() {
    demo = !demo;
    els.btnDemo.setAttribute('aria-pressed', String(demo));
    els.btnDemo.textContent = demo ? 'Modo demo: ON' : 'Modo demo';
    if (demo && !devices.length) {
      devices = DEMO_DEVICES.map((d) => ({ ...d }));
      guardar();
      registrar('Modo demo ativado com 3 dispositivos de exemplo.', 'aviso');
    } else {
      registrar(`Modo demo ${demo ? 'ativado' : 'desativado'}.`, 'aviso');
    }
    render();
  }

  /* ---------- eventos ---------- */

  $('#btn-add').addEventListener('click', () => abrirModal());
  $('#btn-close-modal').addEventListener('click', fecharModal);
  $('#btn-cancel').addEventListener('click', fecharModal);
  $('#btn-check-all').addEventListener('click', verificarTodos);
  $('#btn-export').addEventListener('click', exportar);
  els.btnDemo.addEventListener('click', alternarDemo);
  els.form.addEventListener('submit', guardarForm);
  els.search.addEventListener('input', render);
  els.fileImport.addEventListener('change', (e) => {
    if (e.target.files?.[0]) importar(e.target.files[0]);
    e.target.value = '';
  });
  $('#btn-clear-log').addEventListener('click', () => {
    logs = []; guardarLog(); renderLog(); toast('Registo limpo.');
  });
  els.modal.addEventListener('click', (e) => { if (e.target === els.modal) fecharModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !els.modal.hidden) fecharModal(); });

  render();
  renderLog();
})();
