/* ============================================================
   🖼️ УПРАВЛЕНИЕ ФОТОГРАФИЯМИ САЙТА (меняем прямо здесь!)
   ============================================================
   Примеры:
     avatar: 'images/avatar.jpg'
     hero: 'images/hero.jpg'
     bio: 'images/bio.jpg'
   Пустая строка ('') — показывается SVG-иконка.
   ============================================================ */
const SITE_PHOTOS = {
  avatar: '',
  hero: 'https://storage.yandexcloud.net/b.fotovssylku.ru/2026/10/04/image8ab62dad2d2b30b4.md.png',
  bio: 'https://storage.yandexcloud.net/b.fotovssylku.ru/2026/10/04/image8ab62dad2d2b30b4.md.png'
};
/* ============================================================ */

(function(){
  'use strict';

  const STORAGE_KEY = 'clinic_requests_v1';
  const SCHEDULE_BLOCKS_KEY = 'clinic_schedule_blocks_v1';
  const TIME_SLOTS = ['09:00','10:30','12:00','13:30','15:00','16:30','18:00'];
  const DAY_NAMES = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];

  function toLocalISO(date){
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function loadRequests(){
    try{ const raw = localStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : []; }
    catch(e){ return []; }
  }
  function saveRequests(list){ localStorage.setItem(STORAGE_KEY, JSON.stringify(list)); }
  function loadBlocks(){
    try{ const raw = localStorage.getItem(SCHEDULE_BLOCKS_KEY); return raw ? JSON.parse(raw) : []; }
    catch(e){ return []; }
  }

  // ============================================================
  // ПОДСТАНОВКА ФОТОГРАФИЙ
  // ============================================================
  function applyPhotos(){
    const logoMark = document.getElementById('logoMark');
    if(logoMark){
      if(SITE_PHOTOS.avatar){
        logoMark.innerHTML = `<img src="${SITE_PHOTOS.avatar}" alt="">`;
      } else {
        logoMark.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C8 2 5 5 5 9c0 3 2 5 4 6-2 1-4 3-4 6 0 0 4 1 7 1s7-1 7-1c0-3-2-5-4-6 2-1 4-3 4-6 0-4-3-7-7-7z"/></svg>`;
      }
    }

    const heroEl = document.getElementById('heroPhoto');
    if(heroEl && SITE_PHOTOS.hero){
      heroEl.innerHTML = `<img src="${SITE_PHOTOS.hero}" alt="Шумиловская Вероника Сергеевна">`;
    }

    const bioEl = document.getElementById('bioPhoto');
    if(bioEl && SITE_PHOTOS.bio){
      bioEl.innerHTML = `<img src="${SITE_PHOTOS.bio}" alt="Шумиловская Вероника Сергеевна">`;
    }
  }

  // ============================================================
  // НАВИГАЦИЯ: скролл-эффект
  // ============================================================
  const nav = document.getElementById('topNav');
  let ticking = false;
  window.addEventListener('scroll', () => {
    if(!ticking){
      requestAnimationFrame(() => {
        nav.classList.toggle('scrolled', window.scrollY > 30);
        ticking = false;
      });
      ticking = true;
    }
  }, { passive: true });

  // ============================================================
  // ПАРАЛЛАКС декоративных элементов
  // ============================================================
  const parallaxEls = document.querySelectorAll('[data-parallax]');
  let parallaxTicking = false;
  window.addEventListener('scroll', () => {
    if(!parallaxTicking){
      requestAnimationFrame(() => {
        const scrollY = window.scrollY;
        parallaxEls.forEach(el => {
          const speed = parseFloat(el.dataset.parallax) || 0.1;
          el.style.transform = `translate3d(0, ${scrollY * speed}px, 0)`;
        });
        parallaxTicking = false;
      });
      parallaxTicking = true;
    }
  }, { passive: true });

  // ============================================================
  // ПУБЛИЧНОЕ РАСПИСАНИЕ
  // ============================================================
  function renderPublicSchedule(){
    const grid = document.getElementById('publicScheduleGrid');
    if(!grid) return;

    const requests = loadRequests();
    const blocks = loadBlocks();
    const today = new Date();
    const monday = new Date(today);
    const day = today.getDay();
    const diff = (day === 0 ? -6 : 1 - day);
    monday.setDate(today.getDate() + diff);

    let html = '';
    const todayISO = toLocalISO(today);

    for(let i = 0; i < 7; i++){
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const iso = toLocalISO(d);
      const isWeekend = i >= 5;
      const isPast = iso < todayISO;
      const isToday = iso === todayISO;
      let slotsHtml = '';

      TIME_SLOTS.forEach(t => {
        const key = iso + '_' + t;
        const isBlocked = (isWeekend && (t === '15:00' || t === '16:30' || t === '18:00')) || blocks.includes(key);
        const isBooked = requests.some(r =>
          r.date === iso && r.time === t &&
          r.status !== 'cancelled' && r.status !== 'done'
        );

        let cls, statusText;
        if(isPast){ cls = 'blocked'; statusText = 'Прошло'; }
        else if(isBlocked){ cls = 'blocked'; statusText = 'Недоступно'; }
        else if(isBooked){ cls = 'booked'; statusText = 'Занято'; }
        else { cls = 'free'; statusText = 'Свободно'; }

        const onclick = cls === 'free' ? ` data-slot="${iso}|${t}"` : '';
        slotsHtml += `<div class="pub-slot ${cls}"${onclick}><span class="s-time">${t}</span><span class="s-status">${statusText}</span></div>`;
      });

      html += `<div class="pub-day${isToday ? ' today' : ''}">
        <div class="day-name">${DAY_NAMES[i]}${isToday ? ' · сегодня' : ''}</div>
        <div class="day-date">${d.getDate()} ${d.toLocaleDateString('ru-RU',{month:'short'})}</div>
        ${slotsHtml}
      </div>`;
    }
    grid.innerHTML = html;
  }

  document.addEventListener('click', (e) => {
    const slot = e.target.closest('.pub-slot.free');
    if(!slot || !slot.dataset.slot) return;
    const [iso, time] = slot.dataset.slot.split('|');
    pickSlot(iso, time);
  });

  function pickSlot(iso, time){
    const dateInput = document.getElementById('date');
    const timeSelect = document.getElementById('time');
    const nameInput = document.getElementById('name');
    if(dateInput) dateInput.value = iso;
    if(timeSelect) timeSelect.value = time;
    document.getElementById('contacts').scrollIntoView({behavior:'smooth', block:'start'});
    setTimeout(() => { if(nameInput) nameInput.focus(); }, 500);
  }

  const dateInput = document.getElementById('date');
  if(dateInput){
    dateInput.min = toLocalISO(new Date());
  }

  // ============================================================
  // ОТПРАВКА ФОРМЫ
  // ============================================================
  const form = document.getElementById('appointmentForm');
  const successBox = document.getElementById('formSuccess');

  if(form){
    form.addEventListener('submit', function(e){
      e.preventDefault();

      const submitBtn = form.querySelector('button[type="submit"]');
      if(submitBtn.disabled) return;

      const name = document.getElementById('name').value.trim();
      const phone = document.getElementById('phone').value.trim();
      const email = document.getElementById('email').value.trim();
      const service = document.getElementById('service').value;
      const date = document.getElementById('date').value;
      const time = document.getElementById('time').value;
      const message = document.getElementById('message').value.trim();

      if(!name || !phone || !date || !time){ alert('Заполните обязательные поля'); return; }

      submitBtn.disabled = true;
      const originalText = submitBtn.innerHTML;
      submitBtn.innerHTML = '⏳ Отправка...';

      const requests = loadRequests();
      const isTaken = requests.some(r =>
        r.date === date && r.time === time &&
        r.status !== 'cancelled' && r.status !== 'done'
      );

      requests.push({
        id: Date.now(),
        name, phone,
        email: email || '—',
        type: service,
        date, time,
        status: isTaken ? 'pending' : 'new',
        comment: message || '—',
        createdAt: new Date().toISOString()
      });

      saveRequests(requests);
      form.reset();
      if(dateInput) dateInput.min = toLocalISO(new Date());
      successBox.classList.add('show');
      renderPublicSchedule();

      setTimeout(() => {
        successBox.classList.remove('show');
        submitBtn.disabled = false;
        submitBtn.innerHTML = originalText;
      }, 3000);
    });
  }

  // ============================================================
  // АНИМАЦИЯ ПОЯВЛЕНИЯ ПРИ СКРОЛЛЕ
  // ============================================================
  const fadeEls = document.querySelectorAll('.fade-up');
  if('IntersectionObserver' in window){
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting){
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    fadeEls.forEach(el => observer.observe(el));
  } else {
    fadeEls.forEach(el => el.classList.add('visible'));
  }

  // ============================================================
  // СЧЁТЧИКИ
  // ============================================================
  let countersDone = false;
  const statsSection = document.getElementById('experience');

  if(statsSection && 'IntersectionObserver' in window){
    const counterObserver = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if(entry.isIntersecting && !countersDone){
          countersDone = true;
          counterObserver.unobserve(entry.target);
          document.querySelectorAll('[data-target]').forEach(el => {
            const target = parseInt(el.getAttribute('data-target'), 10);
            const duration = 1600;
            const startTime = performance.now();
            function tick(now){
              const elapsed = now - startTime;
              const progress = Math.min(elapsed / duration, 1);
              const eased = 1 - Math.pow(1 - progress, 3);
              el.textContent = Math.round(target * eased);
              if(progress < 1) requestAnimationFrame(tick);
              else el.textContent = target;
            }
            requestAnimationFrame(tick);
          });
        }
      });
    }, { threshold: 0.35 });
    counterObserver.observe(statsSection);
  }

  // ============================================================
  // ПЛАВНАЯ ПРОКРУТКА
  // ============================================================
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function(e){
      const href = this.getAttribute('href');
      if(href === '#' || href === '') return;
      const target = document.querySelector(href);
      if(target){
        e.preventDefault();
        const pos = target.getBoundingClientRect().top + window.pageYOffset - 85;
        window.scrollTo({ top: pos, behavior: 'smooth' });
      }
    });
  });

  window.addEventListener('storage', function(e){
    if(e.key === STORAGE_KEY || e.key === SCHEDULE_BLOCKS_KEY) renderPublicSchedule();
  });

  applyPhotos();
  renderPublicSchedule();

  console.log('%c🩺 Сайт загружен', 'color:#2E5E4E;font-weight:bold;font-size:14px');
})();