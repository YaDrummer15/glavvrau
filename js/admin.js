(function(){
  'use strict';

  const SESSION_KEY = 'clinic_session_v1';
  if(localStorage.getItem(SESSION_KEY) !== 'true'){
    window.location.replace('login.html');
    return;
  }

  const STORAGE_KEY = 'clinic_requests_v1';
  const PATIENTS_KEY = 'clinic_patients_v1';
  const SCHEDULE_BLOCKS_KEY = 'clinic_schedule_blocks_v1';
  const PHOTOS_KEY = 'clinic_photos_v1';
  const TIME_SLOTS = ['09:00','10:30','12:00','13:30','15:00','16:30','18:00'];
  const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  function toLocalISO(date){
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function load(key, fallback){
    try{ const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : fallback; }
    catch(e){ return fallback; }
  }
  function save(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }
    catch(e){ console.warn('Storage error:', e); }
  }

  let requests = [];
  let patients = [];
  let blocks = [];
  let currentFilter = 'all';
  let currentPatientFilter = 'all';
  let patientSearchQuery = '';
  let schedule = {};

  let bookingState = {
    mode: 'existing',
    selectedPatientId: null,
    preselectedDate: '',
    preselectedTime: ''
  };

  function formatDate(iso){
    if(!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('ru-RU',{day:'numeric',month:'long'});
  }
  function formatDateShort(iso){
    if(!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'});
  }
  function formatDateFull(iso){
    if(!iso) return '—';
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric'});
  }
  function getInitials(name){
    if(!name || typeof name !== 'string') return '??';
    return name.trim().split(/\s+/).filter(Boolean)
      .map(w => w[0]).slice(0,2).join('').toUpperCase() || '??';
  }
  function escapeHtml(s){
    if(s === null || s === undefined) return '';
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function statusLabel(s){
    const map = {new:'Новая',confirmed:'Подтверждена',pending:'Ожидает',cancelled:'Отменена',done:'Завершена',active:'Активный',archived:'Архив'};
    return map[s] || s;
  }
  function statusBadge(s){
    const map = {new:'badge-new',confirmed:'badge-confirmed',pending:'badge-pending',cancelled:'badge-cancelled',done:'badge-done',active:'badge-active',archived:'badge-archived'};
    return `<span class="badge ${map[s] || 'badge-done'}">${statusLabel(s)}</span>`;
  }

  window.switchView = function(view){
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    const target = document.getElementById('view-' + view);
    if(target) target.classList.add('active');

    document.querySelectorAll('.side-link[data-view]').forEach(l => l.classList.remove('active'));
    const link = document.querySelector(`.side-link[data-view="${view}"]`);
    if(link) link.classList.add('active');

    window.scrollTo({ top: 0, behavior: 'smooth' });
    setTimeout(() => {
      document.querySelectorAll('#view-' + view + ' .fade-up').forEach(el => el.classList.add('visible'));
    }, 30);
  };

  document.querySelectorAll('.side-link[data-view]').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      switchView(link.dataset.view);
    });
  });

  // ============================================================
  // Расписание
  // ============================================================
  function buildSchedule(){
    const today = new Date();
    const monday = new Date(today);
    const day = today.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    monday.setDate(today.getDate() + diff);

    schedule = {};
    const todayISO = toLocalISO(today);

    for(let i = 0; i < 7; i++){
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = toLocalISO(d);
      const isWeekend = i >= 5;
      const isPast = iso < todayISO;
      const isToday = iso === todayISO;

      const slots = TIME_SLOTS.map(t => {
        const key = iso + '_' + t;
        const isBlocked = (isWeekend && (t === '15:00' || t === '16:30' || t === '18:00')) || blocks.includes(key);
        const req = requests.find(r =>
          r.date === iso && r.time === t &&
          r.status !== 'cancelled' && r.status !== 'done'
        );

        if(req) return { time:t, status:'booked', patient:req.name, requestId:req.id, key };
        if(isPast) return { time:t, status:'blocked', patient:'Прошло', key };
        if(isBlocked) return { time:t, status:'blocked', patient:'Недоступно', key };
        return { time:t, status:'free', patient:'+ Записать', key };
      });

      schedule[iso] = { dayName:DAY_NAMES[i], date:d, iso, isToday, slots };
    }
  }

  function renderSchedule(){
    const grid = document.getElementById('scheduleGrid');
    if(!grid) return;

    const keys = Object.keys(schedule).sort();
    grid.innerHTML = keys.map(k => {
      const day = schedule[k];
      const slotsHtml = day.slots.map(s => {
        let cls = 'slot ';
        let onclick = '';

        if(s.status === 'booked'){
          cls += 'booked';
          if(s.requestId) onclick = ` onclick="openRequest(${s.requestId})"`;
        } else if(s.status === 'blocked'){
          cls += 'blocked';
          if(s.patient !== 'Прошло'){
            onclick = ` onclick="toggleBlock('${s.key}')"`;
          }
        } else {
          cls += 'bookable';
          onclick = ` onclick="openNewAppointmentModal('${s.key.split('_')[0]}','${s.time}')"`;
        }

        return `<div class="${cls}"${onclick} title="${s.status === 'free' ? 'Кликните, чтобы записать пациента' : ''}">
          <span class="s-time">${s.time}</span>
          <span class="s-patient">${s.patient}</span>
        </div>`;
      }).join('');

      const dateStr = `${day.date.getDate()} ${day.date.toLocaleDateString('ru-RU',{month:'short'})}`;
      return `<div class="day-col${day.isToday ? ' today' : ''}">
        <div class="day-name">${day.dayName}${day.isToday ? ' · сегодня' : ''}</div>
        <div class="day-date">${dateStr}</div>
        ${slotsHtml}
      </div>`;
    }).join('');
  }

  window.toggleBlock = function(key){
    const idx = blocks.indexOf(key);
    if(idx >= 0){
      blocks.splice(idx, 1);
      showToast('Слот разблокирован');
    } else {
      blocks.push(key);
      showToast('Слот заблокирован');
    }
    save(SCHEDULE_BLOCKS_KEY, blocks);
    buildSchedule();
    renderSchedule();
  };

  // ============================================================
  // KPI
  // ============================================================
  function renderKpi(){
    document.getElementById('kpiNew').textContent = requests.filter(r => r.status === 'new').length;
    document.getElementById('kpiConfirmed').textContent = requests.filter(r => r.status === 'confirmed').length;
    document.getElementById('kpiPending').textContent = requests.filter(r => r.status === 'pending').length;
    document.getElementById('kpiPatients').textContent = patients.length;
    document.getElementById('sideReqCount').textContent = requests.filter(r => r.status === 'new' || r.status === 'pending').length;
    document.getElementById('sidePatCount').textContent = patients.length;
  }

  // ============================================================
  // Заявки
  // ============================================================
  function renderRequests(){
    const tbody = document.getElementById('requestsBody');
    const empty = document.getElementById('emptyRequests');
    const filtered = currentFilter === 'all' ? requests : requests.filter(r => r.status === currentFilter);

    document.getElementById('cntAll').textContent = requests.length;
    document.getElementById('cntNew').textContent = requests.filter(r => r.status === 'new').length;
    document.getElementById('cntConfirmed').textContent = requests.filter(r => r.status === 'confirmed').length;
    document.getElementById('cntPending').textContent = requests.filter(r => r.status === 'pending').length;
    document.getElementById('cntCancelled').textContent = requests.filter(r => r.status === 'cancelled').length;

    if(filtered.length === 0){
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    const order = { new:0, pending:1, confirmed:2, cancelled:3, done:4 };
    const sorted = [...filtered].sort((a,b) => {
      if(order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
      return (a.date + a.time).localeCompare(b.date + b.time);
    });

    tbody.innerHTML = sorted.map(r => {
      const source = r.createdByDoctor ? '<span style="font-size:0.7rem;background:rgba(212,180,131,0.3);color:#8A6A2E;padding:0.1rem 0.4rem;border-radius:6px;margin-left:0.3rem;">врач</span>' : '';
      return `
      <tr>
        <td><div class="patient-cell">
          <div class="patient-avatar">${getInitials(r.name)}</div>
          <div style="min-width:0;">
            <div class="p-name">${escapeHtml(r.name) || '—'}${source}</div>
            <div class="p-phone">${escapeHtml(r.phone) || '—'}</div>
          </div>
        </div></td>
        <td>${escapeHtml(r.type) || '—'}</td>
        <td><div class="date-cell">
          <div class="d-day">${formatDateShort(r.date)}</div>
          <div class="d-time">${r.time || '—'}</div>
        </div></td>
        <td>${statusBadge(r.status)}</td>
        <td><div class="actions-cell">
          <button class="action-btn action-view" title="Просмотр" onclick="openRequest(${r.id})">👁</button>
          ${r.status === 'new' || r.status === 'pending' ? `
            <button class="action-btn action-approve" title="Подтвердить" onclick="changeStatus(${r.id},'confirmed')">✓</button>
            <button class="action-btn action-decline" title="Отклонить" onclick="changeStatus(${r.id},'cancelled')">✕</button>
          ` : ''}
        </div></td>
      </tr>
    `}).join('');
  }

  window.changeStatus = function(id, status){
    const req = requests.find(r => r.id === id);
    if(!req) return;
    req.status = status;
    save(STORAGE_KEY, requests);
    if(status === 'confirmed') addOrUpdatePatientFromRequest(req);
    renderKpi(); renderRequests(); renderDashboard(); buildSchedule(); renderSchedule(); renderPatients();
    showToast(`Заявка №${id} — «${statusLabel(status)}»`);
  };

  function addOrUpdatePatientFromRequest(req){
    const existing = patients.find(p => p.phone === req.phone);
    const today = toLocalISO(new Date());

    if(existing){
      existing.visits = (existing.visits || 0) + 1;
      existing.lastVisit = req.date;
      existing.status = 'active';
    } else {
      patients.push({
        id: Date.now(),
        name: req.name,
        phone: req.phone,
        email: req.email,
        birthDate: '',
        skinType: '',
        address: '',
        notes: 'Добавлен из заявки',
        diagnosis: '',
        allergies: '',
        contraindications: '',
        procedures: '',
        medications: '',
        visits: 1,
        lastVisit: req.date,
        status: 'active',
        createdAt: today
      });
    }
    save(PATIENTS_KEY, patients);
  }

  // ============================================================
  // Пациенты
  // ============================================================
  function renderPatients(){
    const tbody = document.getElementById('patientsBody');
    const empty = document.getElementById('emptyPatients');

    document.getElementById('psTotal').textContent = patients.length;
    document.getElementById('psActive').textContent = patients.filter(p => p.status === 'active').length;

    const monthAgo = new Date();
    monthAgo.setMonth(monthAgo.getMonth() - 1);
    const monthIso = toLocalISO(monthAgo);
    document.getElementById('psNew').textContent = patients.filter(p =>
      typeof p.createdAt === 'string' && p.createdAt >= monthIso
    ).length;

    document.getElementById('psVisits').textContent = patients.reduce((s,p) => s + (p.visits || 0), 0);

    document.getElementById('pcntAll').textContent = patients.length;
    document.getElementById('pcntActive').textContent = patients.filter(p => p.status === 'active').length;
    document.getElementById('pcntArchived').textContent = patients.filter(p => p.status === 'archived').length;
    document.getElementById('patientsCount').textContent = patients.length + ' записей';

    let filtered = patients;
    if(currentPatientFilter !== 'all') filtered = filtered.filter(p => p.status === currentPatientFilter);
    if(patientSearchQuery){
      const q = patientSearchQuery.toLowerCase();
      filtered = filtered.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q)
      );
    }

    if(filtered.length === 0){
      tbody.innerHTML = '';
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    filtered.sort((a,b) => (b.visits || 0) - (a.visits || 0));

    tbody.innerHTML = filtered.map(p => `
      <tr>
        <td><div class="patient-cell">
          <div class="patient-avatar">${getInitials(p.name)}</div>
          <div style="min-width:0;">
            <div class="p-name">${escapeHtml(p.name) || '—'}</div>
            <div class="p-phone">ID ${p.id.toString().slice(-6)}</div>
          </div>
        </div></td>
        <td>
          <div style="font-size:0.88rem;color:var(--emerald-deep);font-weight:500;">${escapeHtml(p.phone) || '—'}</div>
          <div style="font-size:0.78rem;color:var(--text-soft);">${escapeHtml(p.email) || '—'}</div>
        </td>
        <td>
          <div style="font-size:0.85rem;">${p.skinType ? '💧 ' + escapeHtml(p.skinType) : '—'}</div>
          <div style="font-size:0.78rem;color:var(--text-soft);">${escapeHtml(p.diagnosis) || '—'}</div>
        </td>
        <td>${p.birthDate ? formatDateFull(p.birthDate) : '—'}</td>
        <td><strong style="color:var(--emerald-deep);">${p.visits || 0}</strong></td>
        <td>${p.lastVisit ? formatDateShort(p.lastVisit) : '—'}</td>
        <td>${statusBadge(p.status || 'active')}</td>
        <td><div class="actions-cell">
          <button class="action-btn action-approve" title="Записать на приём" onclick="openNewAppointmentModal(null,null,${p.id})">📅</button>
          <button class="action-btn action-view" title="Карта пациента" onclick="openPatientCard(${p.id})">👁</button>
          <button class="action-btn action-edit" title="Редактировать" onclick="openPatientModal(${p.id})">✎</button>
          <button class="action-btn action-delete" title="Удалить" onclick="deletePatient(${p.id})">🗑</button>
        </div></td>
      </tr>
    `).join('');
  }

  window.deletePatient = function(id){
    if(!confirm('Удалить пациента из базы? Действие необратимо.')) return;
    patients = patients.filter(p => p.id !== id);
    save(PATIENTS_KEY, patients);
    renderPatients(); renderKpi(); renderDashboard();
    showToast('Пациент удалён');
  };

  // ============================================================
  // Модалка пациента
  // ============================================================
  window.openPatientModal = function(id){
    const isEdit = id !== undefined && id !== null;
    const p = isEdit
      ? patients.find(x => x.id === id)
      : { name:'', phone:'', email:'', birthDate:'', skinType:'', address:'', notes:'', diagnosis:'', allergies:'', contraindications:'', procedures:'', medications:'', status:'active' };
    if(!p) return;

    document.getElementById('modalHead').className = 'modal-head';
    document.getElementById('modalHead').innerHTML = `
      <div><h3 id="modalTitle">${isEdit ? 'Редактировать пациента' : 'Новый пациент'}</h3>
      <span class="ph-sub" id="modalSubtitle">${isEdit ? `ID ${p.id.toString().slice(-6)}` : 'Заполните информацию'}</span></div>
      <button class="modal-close" onclick="closeModal()" aria-label="Закрыть">✕</button>
    `;

    document.getElementById('modalBody').className = 'modal-body';
    document.getElementById('modalBody').innerHTML = `
      <form class="modal-form" id="patientForm">
        <div class="form-group"><label>ФИО *</label><input type="text" id="pName" value="${escapeHtml(p.name)}" placeholder="Иванова Анна Петровна" required></div>
        <div class="form-row">
          <div class="form-group"><label>Телефон *</label><input type="tel" id="pPhone" value="${escapeHtml(p.phone)}" placeholder="+7 (999) 123-45-67" required></div>
          <div class="form-group"><label>Email</label><input type="email" id="pEmail" value="${escapeHtml(p.email)}" placeholder="you@example.com"></div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Дата рождения</label><input type="date" id="pBirth" value="${p.birthDate || ''}"></div>
          <div class="form-group"><label>Тип кожи</label>
            <select id="pSkinType">
              <option value="">— не указан —</option>
              <option value="Нормальная" ${p.skinType === 'Нормальная' ? 'selected' : ''}>Нормальная</option>
              <option value="Сухая" ${p.skinType === 'Сухая' ? 'selected' : ''}>Сухая</option>
              <option value="Жирная" ${p.skinType === 'Жирная' ? 'selected' : ''}>Жирная</option>
              <option value="Комбинированная" ${p.skinType === 'Комбинированная' ? 'selected' : ''}>Комбинированная</option>
              <option value="Чувствительная" ${p.skinType === 'Чувствительная' ? 'selected' : ''}>Чувствительная</option>
            </select>
          </div>
        </div>
        <div class="form-row">
          <div class="form-group"><label>Статус</label>
            <select id="pStatus">
              <option value="active" ${p.status === 'active' ? 'selected' : ''}>Активный</option>
              <option value="archived" ${p.status === 'archived' ? 'selected' : ''}>Архив</option>
            </select>
          </div>
          <div class="form-group"><label>Адрес</label><input type="text" id="pAddress" value="${escapeHtml(p.address)}" placeholder="Москва, ул. ..."></div>
        </div>
        <div class="form-group"><label>Дерматологический диагноз</label><textarea id="pDiagnosis" placeholder="Акне, розацеа, псориаз...">${escapeHtml(p.diagnosis)}</textarea></div>
        <div class="form-row">
          <div class="form-group"><label>Аллергии</label><input type="text" id="pAllergies" value="${escapeHtml(p.allergies)}" placeholder="Например: лидокаин"></div>
          <div class="form-group"><label>Противопоказания</label><input type="text" id="pContra" value="${escapeHtml(p.contraindications)}" placeholder="Беременность, онкология..."></div>
        </div>
        <div class="form-group"><label>Проведённые процедуры</label><textarea id="pProcedures" placeholder="Чистка, пилинг, ботулотоксин...">${escapeHtml(p.procedures)}</textarea></div>
        <div class="form-group"><label>Текущая терапия / препараты</label><textarea id="pMedications" placeholder="Наружные средства, системные препараты...">${escapeHtml(p.medications)}</textarea></div>
        <div class="form-group"><label>Заметки</label><textarea id="pNotes" placeholder="Дополнительные сведения...">${escapeHtml(p.notes)}</textarea></div>
      </form>
    `;

    document.getElementById('modalFoot').className = 'modal-foot';
    document.getElementById('modalFoot').innerHTML = `
      <button class="btn btn-ghost" onclick="closeModal()">Отмена</button>
      <button class="btn btn-primary" onclick="savePatient(${isEdit ? id : 'null'})">${isEdit ? 'Сохранить' : 'Добавить'}</button>
    `;

    openModalOverlay();
  };

  window.savePatient = function(id){
    const name = document.getElementById('pName').value.trim();
    const phone = document.getElementById('pPhone').value.trim();
    if(!name || !phone){ alert('Заполните обязательные поля'); return; }

    const data = {
      name, phone,
      email: document.getElementById('pEmail').value.trim(),
      birthDate: document.getElementById('pBirth').value,
      skinType: document.getElementById('pSkinType').value,
      status: document.getElementById('pStatus').value,
      address: document.getElementById('pAddress').value.trim(),
      diagnosis: document.getElementById('pDiagnosis').value.trim(),
      allergies: document.getElementById('pAllergies').value.trim(),
      contraindications: document.getElementById('pContra').value.trim(),
      procedures: document.getElementById('pProcedures').value.trim(),
      medications: document.getElementById('pMedications').value.trim(),
      notes: document.getElementById('pNotes').value.trim()
    };

    if(id !== undefined && id !== null){
      const idx = patients.findIndex(p => p.id === id);
      if(idx >= 0) patients[idx] = { ...patients[idx], ...data };
      showToast('Карта пациента обновлена');
    } else {
      patients.push({ id: Date.now(), ...data, visits: 0, lastVisit: '', createdAt: toLocalISO(new Date()) });
      showToast('Пациент добавлен');
    }
    save(PATIENTS_KEY, patients);
    renderPatients(); renderKpi(); renderDashboard();
    closeModal();
  };

  window.openPatientCard = function(id){
    const p = patients.find(x => x.id === id);
    if(!p) return;

    document.getElementById('modalHead').className = 'modal-head';
    document.getElementById('modalHead').innerHTML = `
      <div><h3>${escapeHtml(p.name)}</h3>
      <span class="ph-sub">ID ${p.id.toString().slice(-6)} · добавлен ${formatDateFull(p.createdAt)}</span></div>
      <button class="modal-close" onclick="closeModal()" aria-label="Закрыть">✕</button>
    `;

    document.getElementById('modalBody').className = 'modal-body';
    document.getElementById('modalBody').innerHTML = `
      <div class="modal-row"><span class="m-icon">📞</span><div><div class="m-label">Телефон</div><div class="m-value">${escapeHtml(p.phone) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">✉️</span><div><div class="m-label">Email</div><div class="m-value">${escapeHtml(p.email) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">🎂</span><div><div class="m-label">Дата рождения</div><div class="m-value">${p.birthDate ? formatDateFull(p.birthDate) : '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">💧</span><div><div class="m-label">Тип кожи</div><div class="m-value">${escapeHtml(p.skinType) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">📍</span><div><div class="m-label">Адрес</div><div class="m-value">${escapeHtml(p.address) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">🩺</span><div><div class="m-label">Диагноз</div><div class="m-value">${escapeHtml(p.diagnosis) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">⚠️</span><div><div class="m-label">Аллергии</div><div class="m-value">${escapeHtml(p.allergies) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">🚫</span><div><div class="m-label">Противопоказания</div><div class="m-value">${escapeHtml(p.contraindications) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">🌿</span><div><div class="m-label">Процедуры</div><div class="m-value">${escapeHtml(p.procedures) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">💊</span><div><div class="m-label">Терапия</div><div class="m-value">${escapeHtml(p.medications) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">📅</span><div><div class="m-label">Визитов / последний</div><div class="m-value">${p.visits || 0} · ${p.lastVisit ? formatDateShort(p.lastVisit) : '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">ℹ️</span><div><div class="m-label">Статус</div><div class="m-value">${statusBadge(p.status || 'active')}</div></div></div>
      <div class="modal-row"><span class="m-icon">💬</span><div><div class="m-label">Заметки</div><div class="m-value">${escapeHtml(p.notes) || '—'}</div></div></div>
    `;

    document.getElementById('modalFoot').className = 'modal-foot';
    document.getElementById('modalFoot').innerHTML = `
      <button class="btn btn-ghost" onclick="closeModal()">Закрыть</button>
      <button class="btn btn-primary" onclick="closeModal();openPatientModal(${p.id})">Редактировать</button>
    `;

    openModalOverlay();
  };

  // ============================================================
  // Просмотр заявки
  // ============================================================
  window.openRequest = function(id){
    const r = requests.find(x => x.id === id);
    if(!r) return;

    document.getElementById('modalHead').className = 'modal-head';
    document.getElementById('modalHead').innerHTML = `
      <div><h3>Заявка на приём</h3>
      <span class="ph-sub">№${r.id} · ${escapeHtml(r.name) || '—'}</span></div>
      <button class="modal-close" onclick="closeModal()" aria-label="Закрыть">✕</button>
    `;

    document.getElementById('modalBody').className = 'modal-body';
    document.getElementById('modalBody').innerHTML = `
      <div class="modal-row"><span class="m-icon">👤</span><div><div class="m-label">Пациент</div><div class="m-value">${escapeHtml(r.name) || '—'}${r.createdByDoctor ? ' <span style="font-size:0.7rem;background:rgba(212,180,131,0.3);color:#8A6A2E;padding:0.1rem 0.4rem;border-radius:6px;">врач</span>' : ''}</div></div></div>
      <div class="modal-row"><span class="m-icon">📞</span><div><div class="m-label">Телефон</div><div class="m-value">${escapeHtml(r.phone) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">✉️</span><div><div class="m-label">Email</div><div class="m-value">${escapeHtml(r.email) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">🩺</span><div><div class="m-label">Тип приёма</div><div class="m-value">${escapeHtml(r.type) || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">📅</span><div><div class="m-label">Дата приёма</div><div class="m-value">${formatDate(r.date)}, ${r.time || '—'}</div></div></div>
      <div class="modal-row"><span class="m-icon">ℹ️</span><div><div class="m-label">Статус</div><div class="m-value">${statusBadge(r.status)}</div></div></div>
      <div class="modal-row"><span class="m-icon">💬</span><div><div class="m-label">Комментарий</div><div class="m-value">${escapeHtml(r.comment) || '—'}</div></div></div>
    `;

    let footHtml = '';
    if(r.status === 'new' || r.status === 'pending'){
      footHtml += `<button class="btn btn-primary" onclick="changeStatus(${r.id},'confirmed');closeModal();">✓ Подтвердить</button>`;
      footHtml += `<button class="btn btn-danger" onclick="changeStatus(${r.id},'cancelled');closeModal();">✕ Отклонить</button>`;
    } else if(r.status === 'confirmed'){
      footHtml += `<button class="btn btn-success" onclick="changeStatus(${r.id},'done');closeModal();">✓ Завершить</button>`;
      footHtml += `<button class="btn btn-danger" onclick="changeStatus(${r.id},'cancelled');closeModal();">✕ Отменить</button>`;
    } else {
      footHtml += `<button class="btn btn-ghost" onclick="closeModal()">← Закрыть</button>`;
    }
    document.getElementById('modalFoot').className = 'modal-foot';
    document.getElementById('modalFoot').innerHTML = footHtml;
    openModalOverlay();
  };

  // ============================================================
  // Запись пациента врачом
  // ============================================================
  window.openNewAppointmentModal = function(preselectedDate, preselectedTime, preselectedPatientId){
    bookingState = {
      mode: 'existing',
      selectedPatientId: preselectedPatientId || null,
      preselectedDate: preselectedDate || '',
      preselectedTime: preselectedTime || ''
    };

    const today = new Date();
    const todayISO = toLocalISO(today);
    const maxDate = new Date(today);
    maxDate.setDate(maxDate.getDate() + 60);
    const maxDateISO = toLocalISO(maxDate);

    document.getElementById('modalHead').className = 'modal-head modal-head-booking';
    document.getElementById('modalHead').innerHTML = `
      <div class="modal-title-wrap">
        <div class="modal-title-icon">📅</div>
        <div class="modal-title-text">
          <h3>Запись пациента на приём</h3>
          <span class="ph-sub">Выберите пациента и удобное время</span>
        </div>
      </div>
      <button class="modal-close" onclick="closeModal()" aria-label="Закрыть">✕</button>
    `;

    const body = document.getElementById('modalBody');
    body.className = 'modal-body modal-body-booking';
    body.innerHTML = `
      <div class="book-info-banner">
        <span class="bib-icon">ℹ️</span>
        <span>Запись будет создана со статусом <strong>«Подтверждена»</strong> и сразу появится в расписании.</span>
      </div>

      <div class="book-mode-switch">
        <button type="button" class="book-mode-btn active" id="modeExistingBtn">
          <span class="bmb-icon">👥</span> Из базы
        </button>
        <button type="button" class="book-mode-btn" id="modeNewBtn">
          <span class="bmb-icon">➕</span> Новый пациент
        </button>
      </div>

      <div class="book-section" id="existingPatientBlock">
        <div class="book-section-title">Пациент</div>
        <div class="book-search-wrap">
          <span class="book-search-icon">🔍</span>
          <input type="text" id="bookingPatientSearch" placeholder="Начните вводить имя или телефон..." autocomplete="off">
        </div>
        <div class="book-selected-patient" id="selectedPatientInfo">
          <div class="patient-avatar" id="selectedPatientAvatar">?</div>
          <div class="bsp-info">
            <div class="bsp-name" id="selectedPatientName"></div>
            <div class="bsp-phone" id="selectedPatientPhone"></div>
          </div>
          <button type="button" class="bsp-clear" id="clearSelectedPatient" title="Убрать">✕</button>
        </div>
        <div class="book-results" id="patientResults"></div>
      </div>

      <div class="book-section" id="newPatientBlock" style="display:none;">
        <div class="book-section-title">Новый пациент</div>
        <div class="book-form-row">
          <div class="book-field">
            <label>ФИО <span class="req">*</span></label>
            <input type="text" id="npName" placeholder="Иванова Анна Петровна">
          </div>
          <div class="book-field">
            <label>Телефон <span class="req">*</span></label>
            <input type="tel" id="npPhone" placeholder="+7 (999) 123-45-67">
          </div>
        </div>
        <div class="book-field">
          <label>Email</label>
          <input type="email" id="npEmail" placeholder="you@example.com">
        </div>
      </div>

      <div class="book-section">
        <div class="book-section-title">Детали приёма</div>
        <div class="book-form-row">
          <div class="book-field">
            <label>Дата <span class="req">*</span></label>
            <input type="date" id="bookingDate" value="${bookingState.preselectedDate || todayISO}" min="${todayISO}" max="${maxDateISO}" required>
          </div>
          <div class="book-field">
            <label>Услуга</label>
            <select id="bookingService">
              <option value="Консультация дерматолога">Консультация дерматолога</option>
              <option value="Консультация косметолога">Консультация косметолога</option>
              <option value="Инъекционная косметология">Инъекционная косметология</option>
              <option value="Аппаратная косметология">Аппаратная косметология</option>
              <option value="Трихология">Трихология</option>
              <option value="Чистка лица">Чистка лица</option>
              <option value="Другое">Другое</option>
            </select>
          </div>
        </div>
      </div>

      <div class="book-section">
        <div class="book-section-title">Время приёма <span class="req" style="color:var(--danger);">*</span></div>
        <div class="book-slots-grid" id="bookingTimeSlots"></div>
        <input type="hidden" id="bookingTime" value="${bookingState.preselectedTime || ''}">
      </div>

      <div class="book-field">
        <label>Комментарий <span style="color:var(--text-soft);font-weight:400;">(необязательно)</span></label>
        <textarea id="bookingComment" placeholder="Заметки о приёме..."></textarea>
      </div>
    `;

    document.getElementById('modalFoot').className = 'modal-foot modal-foot-booking';
    document.getElementById('modalFoot').innerHTML = `
      <button class="btn btn-cancel" onclick="closeModal()">Отмена</button>
      <button class="btn btn-submit" id="submitBookingBtn" onclick="submitBooking()">✓ Записать пациента</button>
    `;

    const modeExistingBtn = document.getElementById('modeExistingBtn');
    const modeNewBtn = document.getElementById('modeNewBtn');
    const existingBlock = document.getElementById('existingPatientBlock');
    const newBlock = document.getElementById('newPatientBlock');

    modeExistingBtn.addEventListener('click', () => {
      bookingState.mode = 'existing';
      modeExistingBtn.classList.add('active');
      modeNewBtn.classList.remove('active');
      existingBlock.style.display = '';
      newBlock.style.display = 'none';
    });

    modeNewBtn.addEventListener('click', () => {
      bookingState.mode = 'new';
      modeNewBtn.classList.add('active');
      modeExistingBtn.classList.remove('active');
      existingBlock.style.display = 'none';
      newBlock.style.display = '';
      setTimeout(() => {
        const inp = document.getElementById('npName');
        if(inp) inp.focus();
      }, 100);
    });

    const searchInput = document.getElementById('bookingPatientSearch');
    searchInput.addEventListener('input', (e) => {
      renderPatientResults(e.target.value.trim());
    });

    document.getElementById('clearSelectedPatient').addEventListener('click', () => {
      bookingState.selectedPatientId = null;
      document.getElementById('selectedPatientInfo').classList.remove('show');
      searchInput.value = '';
      renderPatientResults('');
      searchInput.focus();
    });

    document.getElementById('bookingDate').addEventListener('change', renderTimeSlots);

    renderPatientResults('');
    renderTimeSlots();

    if(bookingState.selectedPatientId){
      const p = patients.find(x => x.id === bookingState.selectedPatientId);
      if(p) selectPatient(p.id);
    }

    const modal = document.querySelector('#modalOverlay .modal');
    if(modal) modal.classList.add('modal-booking');
    openModalOverlay();
  };

  function renderPatientResults(query){
    const container = document.getElementById('patientResults');
    if(!container) return;

    let list = [...patients];
    if(query){
      const q = query.toLowerCase();
      list = list.filter(p =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.phone || '').toLowerCase().includes(q) ||
        (p.email || '').toLowerCase().includes(q)
      );
    }

    list.sort((a,b) => (b.visits || 0) - (a.visits || 0));

    if(list.length === 0){
      container.innerHTML = `<div class="book-results-empty">${query ? '🔍 Никого не найдено' : '👥 Начните вводить имя или телефон, чтобы найти пациента'}</div>`;
      return;
    }

    container.innerHTML = list.slice(0, 30).map(p => {
      const selected = p.id === bookingState.selectedPatientId;
      return `
        <div class="book-result-item${selected ? ' selected' : ''}" data-pid="${p.id}">
          <div class="patient-avatar">${getInitials(p.name)}</div>
          <div class="bri-info">
            <div class="bri-name">${escapeHtml(p.name)}</div>
            <div class="bri-phone">${escapeHtml(p.phone)}</div>
          </div>
        </div>
      `;
    }).join('');

    container.querySelectorAll('.book-result-item').forEach(el => {
      el.addEventListener('click', () => selectPatient(parseInt(el.dataset.pid, 10)));
    });
  }

  function selectPatient(pid){
    bookingState.selectedPatientId = pid;
    const p = patients.find(x => x.id === pid);
    if(!p) return;

    document.getElementById('selectedPatientAvatar').textContent = getInitials(p.name);
    document.getElementById('selectedPatientName').textContent = p.name;
    document.getElementById('selectedPatientPhone').textContent = p.phone;
    document.getElementById('selectedPatientInfo').classList.add('show');
    document.getElementById('bookingPatientSearch').value = '';
    renderPatientResults('');
  }

  function renderTimeSlots(){
    const container = document.getElementById('bookingTimeSlots');
    const hiddenInput = document.getElementById('bookingTime');
    const dateInput = document.getElementById('bookingDate');
    if(!container || !dateInput) return;

    const date = dateInput.value;
    if(!date){
      container.innerHTML = '<div class="book-slots-empty">Сначала выберите дату</div>';
      return;
    }

    const dow = new Date(date + 'T00:00:00').getDay();
    const isWeekend = dow === 0 || dow === 6;
    const todayISO = toLocalISO(new Date());
    const isPastDay = date < todayISO;

    const currentSelected = hiddenInput.value;

    container.innerHTML = TIME_SLOTS.map(t => {
      const key = date + '_' + t;
      const isBlocked = (isWeekend && (t === '15:00' || t === '16:30' || t === '18:00')) || blocks.includes(key);
      const isTaken = requests.some(r =>
        r.date === date && r.time === t &&
        r.status !== 'cancelled' && r.status !== 'done'
      );
      const disabled = isBlocked || isTaken || isPastDay;
      const selected = currentSelected === t && !disabled;

      let title = '';
      if(isPastDay) title = 'Прошедшая дата';
      else if(isTaken) title = 'Уже занято';
      else if(isBlocked) title = 'Недоступно';

      return `<button type="button" class="book-slot${selected ? ' selected' : ''}"
                data-time="${t}" ${disabled ? 'disabled' : ''} title="${title}">${t}</button>`;
    }).join('');

    if(currentSelected){
      const stillValid = container.querySelector(`.book-slot[data-time="${currentSelected}"]:not(:disabled)`);
      if(!stillValid) hiddenInput.value = '';
    }

    container.querySelectorAll('.book-slot:not(:disabled)').forEach(btn => {
      btn.addEventListener('click', () => {
        hiddenInput.value = btn.dataset.time;
        container.querySelectorAll('.book-slot').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
      });
    });
  }

  window.submitBooking = function(){
    const date = document.getElementById('bookingDate').value;
    const time = document.getElementById('bookingTime').value;
    const service = document.getElementById('bookingService').value;
    const comment = document.getElementById('bookingComment').value.trim();

    if(!date){ alert('Выберите дату приёма'); return; }
    if(!time){ alert('Выберите время приёма'); return; }

    const isTaken = requests.some(r =>
      r.date === date && r.time === time &&
      r.status !== 'cancelled' && r.status !== 'done'
    );
    if(isTaken){
      alert('Это время уже занято. Пожалуйста, выберите другое.');
      renderTimeSlots();
      return;
    }

    let patientData = null;

    if(bookingState.mode === 'existing'){
      if(!bookingState.selectedPatientId){
        alert('Выберите пациента из базы или создайте нового');
        return;
      }
      const p = patients.find(x => x.id === bookingState.selectedPatientId);
      if(!p){ alert('Пациент не найден'); return; }

      patientData = {
        patientId: p.id,
        name: p.name,
        phone: p.phone,
        email: p.email || '—'
      };

      p.visits = (p.visits || 0) + 1;
      p.lastVisit = date;
      p.status = 'active';
      save(PATIENTS_KEY, patients);

    } else {
      const name = document.getElementById('npName').value.trim();
      const phone = document.getElementById('npPhone').value.trim();
      const email = document.getElementById('npEmail').value.trim();

      if(!name || !phone){
        alert('Укажите ФИО и телефон нового пациента');
        return;
      }

      const existing = patients.find(p => p.phone === phone);
      if(existing){
        if(!confirm(`Пациент с телефоном ${phone} уже есть в базе («${existing.name}»). Использовать его?`)) return;
        existing.visits = (existing.visits || 0) + 1;
        existing.lastVisit = date;
        existing.status = 'active';
        patientData = {
          patientId: existing.id,
          name: existing.name,
          phone: existing.phone,
          email: existing.email || '—'
        };
      } else {
        const newPatient = {
          id: Date.now(),
          name, phone,
          email: email || '—',
          birthDate: '', skinType: '', address: '',
          notes: 'Создан при записи врачом',
          diagnosis: '', allergies: '', contraindications: '',
          procedures: '', medications: '',
          visits: 1, lastVisit: date,
          status: 'active',
          createdAt: toLocalISO(new Date())
        };
        patients.push(newPatient);
        patientData = {
          patientId: newPatient.id,
          name: newPatient.name,
          phone: newPatient.phone,
          email: newPatient.email
        };
      }
      save(PATIENTS_KEY, patients);
    }

    const newRequest = {
      id: Date.now() + 1,
      patientId: patientData.patientId,
      name: patientData.name,
      phone: patientData.phone,
      email: patientData.email,
      type: service,
      date, time,
      status: 'confirmed',
      comment: comment || 'Записан врачом',
      createdAt: new Date().toISOString(),
      createdByDoctor: true
    };

    requests.push(newRequest);
    save(STORAGE_KEY, requests);

    renderKpi(); renderRequests(); renderPatients(); renderDashboard();
    buildSchedule(); renderSchedule();

    closeModal();
    showToast(`✓ ${patientData.name} записан(а) на ${formatDateShort(date)} в ${time}`);
  };

  function openModalOverlay(){
    document.getElementById('modalOverlay').classList.add('open');
    document.body.style.overflow = 'hidden';
  }
  window.closeModal = function(){
    const overlay = document.getElementById('modalOverlay');
    overlay.classList.remove('open');

    const modal = overlay.querySelector('.modal');
    if(modal) modal.classList.remove('modal-booking');

    const head = document.getElementById('modalHead');
    if(head) head.className = 'modal-head';

    const body = document.getElementById('modalBody');
    if(body) body.className = 'modal-body';

    const foot = document.getElementById('modalFoot');
    if(foot) foot.className = 'modal-foot';

    document.body.style.overflow = '';
  };
  document.getElementById('modalOverlay').addEventListener('click', (e) => {
    if(e.target.id === 'modalOverlay') closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && document.getElementById('modalOverlay').classList.contains('open')) closeModal();
  });

  // ============================================================
  // Дашборд
  // ============================================================
  function renderDashboard(){
    const dashTbody = document.getElementById('dashRequestsBody');
    const dashEmpty = document.getElementById('dashEmpty');
    const recent = [...requests]
      .sort((a,b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0,5);

    if(recent.length === 0){
      dashTbody.innerHTML = '';
      dashEmpty.style.display = 'block';
    } else {
      dashEmpty.style.display = 'none';
      dashTbody.innerHTML = recent.map(r => `
        <tr>
          <td><div class="patient-cell">
            <div class="patient-avatar">${getInitials(r.name)}</div>
            <div style="min-width:0;">
              <div class="p-name">${escapeHtml(r.name) || '—'}${r.createdByDoctor ? ' <span style="font-size:0.7rem;color:var(--gold-deep);">👨‍⚕️</span>' : ''}</div>
              <div class="p-phone">${escapeHtml(r.phone) || '—'}</div>
            </div>
          </div></td>
          <td style="font-size:0.88rem;color:var(--text-soft);">${escapeHtml(r.type) || '—'}</td>
          <td style="font-size:0.88rem;">${formatDateShort(r.date)} <span style="color:var(--text-soft);">${r.time || ''}</span></td>
          <td>${statusBadge(r.status)}</td>
        </tr>
      `).join('');
    }

    const topPat = [...patients].sort((a,b) => (b.visits || 0) - (a.visits || 0)).slice(0,5);
    const dashPatBody = document.getElementById('dashPatientsBody');
    const dashPatEmpty = document.getElementById('dashPatientsEmpty');

    if(topPat.length === 0){
      dashPatBody.innerHTML = '';
      dashPatEmpty.style.display = 'block';
    } else {
      dashPatEmpty.style.display = 'none';
      dashPatBody.innerHTML = topPat.map(p => `
        <tr>
          <td><div class="patient-cell">
            <div class="patient-avatar">${getInitials(p.name)}</div>
            <div style="min-width:0;">
              <div class="p-name">${escapeHtml(p.name)}</div>
              <div class="p-phone">${escapeHtml(p.diagnosis) || '—'}</div>
            </div>
          </div></td>
          <td style="font-size:0.88rem;">${escapeHtml(p.phone) || '—'}</td>
          <td><strong style="color:var(--emerald-deep);">${p.visits || 0}</strong></td>
          <td style="font-size:0.88rem;">${p.lastVisit ? formatDateShort(p.lastVisit) : '—'}</td>
        </tr>
      `).join('');
    }
  }

  // ============================================================
  // Фильтры
  // ============================================================
  document.querySelectorAll('#filterTabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#filterTabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentFilter = tab.dataset.filter;
      renderRequests();
    });
  });

  document.querySelectorAll('#patientTabs .tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('#patientTabs .tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentPatientFilter = tab.dataset.pfilter;
      renderPatients();
    });
  });

  const searchInput = document.getElementById('patientSearch');
  if(searchInput){
    let searchTimer;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        patientSearchQuery = e.target.value.trim();
        renderPatients();
      }, 150);
    });
  }

  // ============================================================
  // Системные
  // ============================================================
  window.reloadAll = function(){
    requests = load(STORAGE_KEY, []);
    patients = load(PATIENTS_KEY, []);
    blocks = load(SCHEDULE_BLOCKS_KEY, []);
    buildSchedule();
    renderKpi(); renderRequests(); renderPatients(); renderSchedule(); renderDashboard();
  };

  window.addEventListener('storage', function(e){
    if(e.key === STORAGE_KEY || e.key === PATIENTS_KEY || e.key === SCHEDULE_BLOCKS_KEY){
      reloadAll();
      showToast('Данные обновлены');
    }
  });

  window.logout = function(){
    if(confirm('Выйти из кабинета?')){
      localStorage.removeItem(SESSION_KEY);
      window.location.href = 'login.html';
    }
  };

  window.clearAllRequests = function(){
    if(confirm('Удалить все заявки? Это действие необратимо.\n\nПациенты в базе останутся.')){
      requests = [];
      save(STORAGE_KEY, requests);
      reloadAll();
      showToast('Все заявки удалены');
    }
  };

  window.exportPatientsCsv = function(){
    if(patients.length === 0){ showToast('Нет пациентов для экспорта'); return; }
    const headers = ['ID','ФИО','Телефон','Email','Дата рождения','Тип кожи','Адрес','Диагноз','Аллергии','Противопоказания','Процедуры','Терапия','Визитов','Последний приём','Статус','Заметки'];
    const rows = patients.map(p => [p.id, p.name, p.phone, p.email, p.birthDate, p.skinType, p.address, p.diagnosis, p.allergies, p.contraindications, p.procedures, p.medications, p.visits || 0, p.lastVisit, statusLabel(p.status || 'active'), p.notes]);
    const csv = [headers, ...rows]
      .map(row => row.map(cell => `"${String(cell || '').replace(/"/g,'""')}"`).join(','))
      .join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type:'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'patients_dermatology.csv';
    a.click();
    URL.revokeObjectURL(url);
    showToast('CSV-файл скачан');
  };

  let toastTimer = null;
  window.showToast = function(text){
    const toast = document.getElementById('toast');
    const toastText = document.getElementById('toastText');
    toastText.textContent = text;
    toast.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
  };

  const fadeEls = document.querySelectorAll('.fade-up');
  if('IntersectionObserver' in window){
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.1, rootMargin: '0px 0px -30px 0px' });
    fadeEls.forEach(el => observer.observe(el));
  } else {
    fadeEls.forEach(el => el.classList.add('visible'));
  }

  // ============================================================
  // ФОТОГРАФИИ САЙТА
  // ============================================================
  function loadPhotos(){
    try{
      const raw = localStorage.getItem(PHOTOS_KEY);
      return raw ? JSON.parse(raw) : { hero: '', bio: '', avatar: '' };
    }catch(e){ return { hero: '', bio: '', avatar: '' }; }
  }
  function savePhotos(p){
    try{ localStorage.setItem(PHOTOS_KEY, JSON.stringify(p)); }
    catch(e){ alert('Не удалось сохранить фото — возможно, превышен размер хранилища'); }
  }

  function fileToDataURL(file, maxWidth = 1200, quality = 0.85){
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          let { width, height } = img;
          if(width > maxWidth){
            height = Math.round(height * (maxWidth / width));
            width = maxWidth;
          }
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = reject;
        img.src = e.target.result;
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  window.openPhotosModal = function(){
    const photos = loadPhotos();

    document.getElementById('modalHead').className = 'modal-head modal-head-booking';
    document.getElementById('modalHead').innerHTML = `
      <div class="modal-title-wrap">
        <div class="modal-title-icon">📸</div>
        <div class="modal-title-text">
          <h3>Фотографии сайта</h3>
          <span class="ph-sub">Загрузите свои фото — они появятся на сайте автоматически</span>
        </div>
      </div>
      <button class="modal-close" onclick="closeModal()" aria-label="Закрыть">✕</button>
    `;

    document.getElementById('modalBody').className = 'modal-body modal-body-booking';
    document.getElementById('modalBody').innerHTML = `
      <div class="photo-info-banner">
        <span style="font-size:1.1rem;">💡</span>
        <span>Загружайте фото в формате <strong>JPG/PNG</strong>, размер автоматически сжимается до 1200px. Фото сохраняются в браузере и появляются на сайте мгновенно.</span>
      </div>

      <div class="photos-grid">
        <div class="photo-slot ${photos.hero ? 'has-photo' : ''}">
          <div class="photo-slot-preview">
            ${photos.hero ? `<img src="${photos.hero}" alt="Hero">` : '<span>👩‍⚕️</span>'}
          </div>
          ${photos.hero ? `
            <div class="photo-slot-label">✅ Главное фото</div>
            <div class="photo-slot-actions">
              <button type="button" class="photo-slot-action upload" data-action="upload-hero">🔄 Заменить</button>
              <button type="button" class="photo-slot-action delete" data-action="delete-hero">🗑 Удалить</button>
            </div>
          ` : `
            <div class="photo-slot-label">👩‍⚕️ Главное фото</div>
            <div class="photo-slot-hint">Круглое фото в hero-секции</div>
            <button type="button" class="photo-slot-action upload" data-action="upload-hero">📤 Загрузить</button>
          `}
          <input type="file" id="fileHero" accept="image/*">
        </div>

        <div class="photo-slot ${photos.bio ? 'has-photo' : ''}">
          <div class="photo-slot-preview">
            ${photos.bio ? `<img src="${photos.bio}" alt="Bio">` : '<span>🖼️</span>'}
          </div>
          ${photos.bio ? `
            <div class="photo-slot-label">✅ Фото в биографии</div>
            <div class="photo-slot-actions">
              <button type="button" class="photo-slot-action upload" data-action="upload-bio">🔄 Заменить</button>
              <button type="button" class="photo-slot-action delete" data-action="delete-bio">🗑 Удалить</button>
            </div>
          ` : `
            <div class="photo-slot-label">🖼️ Фото в биографии</div>
            <div class="photo-slot-hint">Портрет в разделе «О враче»</div>
            <button type="button" class="photo-slot-action upload" data-action="upload-bio">📤 Загрузить</button>
          `}
          <input type="file" id="fileBio" accept="image/*">
        </div>

        <div class="photo-slot ${photos.avatar ? 'has-photo' : ''}">
          <div class="photo-slot-preview">
            ${photos.avatar ? `<img src="${photos.avatar}" alt="Avatar">` : '<span>🌿</span>'}
          </div>
          ${photos.avatar ? `
            <div class="photo-slot-label">✅ Аватар</div>
            <div class="photo-slot-actions">
              <button type="button" class="photo-slot-action upload" data-action="upload-avatar">🔄 Заменить</button>
              <button type="button" class="photo-slot-action delete" data-action="delete-avatar">🗑 Удалить</button>
            </div>
          ` : `
            <div class="photo-slot-label">🌿 Аватар</div>
            <div class="photo-slot-hint">Маленькая иконка в шапке сайта</div>
            <button type="button" class="photo-slot-action upload" data-action="upload-avatar">📤 Загрузить</button>
          `}
          <input type="file" id="fileAvatar" accept="image/*">
        </div>
      </div>
    `;

    document.getElementById('modalFoot').className = 'modal-foot modal-foot-booking';
    document.getElementById('modalFoot').innerHTML = `
      <button class="btn btn-cancel" onclick="closeModal()">Закрыть</button>
    `;

    document.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const action = btn.dataset.action;
        if(action.startsWith('upload-')){
          const type = action.replace('upload-', '');
          document.getElementById('file' + type.charAt(0).toUpperCase() + type.slice(1)).click();
        } else if(action.startsWith('delete-')){
          const type = action.replace('delete-', '');
          if(confirm('Удалить это фото?')){
            const ph = loadPhotos();
            ph[type] = '';
            savePhotos(ph);
            showToast('Фото удалено');
            openPhotosModal();
          }
        }
      });
    });

    ['hero', 'bio', 'avatar'].forEach(type => {
      const input = document.getElementById('file' + type.charAt(0).toUpperCase() + type.slice(1));
      if(!input) return;
      input.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if(!file) return;
        if(!file.type.startsWith('image/')){
          alert('Выберите изображение');
          return;
        }
        if(file.size > 8 * 1024 * 1024){
          alert('Файл слишком большой (макс. 8MB)');
          return;
        }
        try {
          const maxW = type === 'avatar' ? 300 : 1200;
          const dataUrl = await fileToDataURL(file, maxW, 0.85);
          const ph = loadPhotos();
          ph[type] = dataUrl;
          savePhotos(ph);
          showToast('✅ Фото загружено');
          openPhotosModal();
        } catch(err){
          alert('Ошибка загрузки: ' + err.message);
        }
      });
    });

    const modal = document.querySelector('#modalOverlay .modal');
    if(modal) modal.classList.add('modal-booking');
    openModalOverlay();
  };

  function applyAdminAvatar(){
    const photos = loadPhotos();
    const avatarEl = document.getElementById('adminAvatar');
    if(!avatarEl) return;
    if(photos.avatar){
      avatarEl.innerHTML = `<img src="${photos.avatar}" alt="">`;
    } else {
      avatarEl.textContent = 'ВШ';
    }
  }

  reloadAll();
  applyAdminAvatar();

  window.addEventListener('storage', (e) => {
    if(e.key === PHOTOS_KEY) applyAdminAvatar();
  });

  console.log('%c🩺 Кабинет врача загружен', 'color:#2E5E4E;font-weight:bold;font-size:14px');
})();