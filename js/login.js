(function(){
  'use strict';

  const CREDENTIALS = { username: 'doctor', password: '1234' };
  const SESSION_KEY = 'clinic_session_v1';

  if(localStorage.getItem(SESSION_KEY) === 'true'){
    window.location.replace('admin.html');
    return;
  }

  const form = document.getElementById('loginForm');
  const errorBox = document.getElementById('loginError');
  const errorText = document.getElementById('loginErrorText');
  const passToggle = document.getElementById('passToggle');
  const passInput = document.getElementById('password');

  passToggle.addEventListener('click', function(){
    const isPass = passInput.type === 'password';
    passInput.type = isPass ? 'text' : 'password';
    this.textContent = isPass ? '🙈' : '👁';
    this.setAttribute('aria-label', isPass ? 'Скрыть пароль' : 'Показать пароль');
  });

  form.addEventListener('submit', function(e){
    e.preventDefault();

    const user = document.getElementById('username').value.trim();
    const pass = document.getElementById('password').value;

    if(user === CREDENTIALS.username && pass === CREDENTIALS.password){
      localStorage.setItem(SESSION_KEY, 'true');
      errorBox.classList.remove('show');

      const btn = form.querySelector('.login-btn');
      btn.textContent = '✅ Успешный вход';
      btn.style.background = '#3E7A5B';
      btn.disabled = true;

      setTimeout(() => { window.location.href = 'admin.html'; }, 500);
    } else {
      errorText.textContent = 'Неверный логин или пароль. Попробуйте снова.';
      errorBox.classList.add('show');
      passInput.value = '';
      passInput.focus();

      errorBox.style.animation = 'none';
      void errorBox.offsetWidth;
      errorBox.style.animation = 'shake 0.4s ease';
    }
  });
})();