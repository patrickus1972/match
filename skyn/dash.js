/* ============================================================
   SKYN — dashboard ("pick up where you left off") interactions
   Custom what's-new player + resume/upload actions.
   ============================================================ */
(() => {
  'use strict';

  /* ---- toast ---- */
  const toast = document.getElementById('db-toast');
  let tT;
  const showToast = (m) => {
    if (!toast) return;
    toast.textContent = m; toast.classList.add('show');
    clearTimeout(tT); tT = setTimeout(() => toast.classList.remove('show'), 2600);
  };

  /* ---- video player ---- */
  const player  = document.getElementById('player');
  const video   = document.getElementById('db-video');
  const bigPlay = document.getElementById('db-bigplay');
  const playBtn = document.getElementById('db-play');
  const stopBtn = document.getElementById('db-stop');
  const seek    = document.getElementById('db-seek');
  const vol     = document.getElementById('db-vol');
  const timeEl  = document.getElementById('db-time');
  const segs    = [...document.querySelectorAll('.db-seg')];

  const fmt = (s) => {
    if (!isFinite(s)) s = 0;
    const m = Math.floor(s / 60);
    return m + ':' + String(Math.floor(s % 60)).padStart(2, '0');
  };
  const playIcon  = '<path d="M8 5.5v13l11-6.5-11-6.5Z"/>';
  const pauseIcon = '<path d="M8 5h3v14H8zM13 5h3v14h-3z"/>';

  const setPlayIcon = (playing) => {
    const svg = playBtn?.querySelector('svg');
    if (svg) svg.innerHTML = playing ? pauseIcon : playIcon;
  };

  const play  = () => { video?.play().catch(() => showToast('Demo video coming soon.')); };
  const pause = () => { video?.pause(); };

  bigPlay?.addEventListener('click', play);
  playBtn?.addEventListener('click', () => (video.paused ? play() : pause()));
  stopBtn?.addEventListener('click', () => {
    if (!video) return;
    video.pause(); video.currentTime = 0;
  });

  if (video) {
    // reflect known duration (0:58) until metadata loads
    const known = 58;
    video.addEventListener('play', () => { player.classList.add('playing'); setPlayIcon(true); });
    video.addEventListener('pause', () => { setPlayIcon(false); });
    video.addEventListener('ended', () => {
      player.classList.remove('playing'); setPlayIcon(false);
      video.currentTime = 0; seek.value = 0; seek.style.setProperty('--p', '0%');
      segs.forEach((s, i) => s.classList.toggle('done', i === 0));
    });
    video.addEventListener('timeupdate', () => {
      const dur = video.duration || known;
      const pct = dur ? (video.currentTime / dur) * 100 : 0;
      seek.value = pct;
      seek.style.setProperty('--p', pct + '%');
      timeEl.textContent = fmt(video.currentTime) + ' / ' + fmt(dur);
      // light up the three story segments as playback advances
      const filled = Math.min(segs.length, Math.floor((pct / 100) * segs.length) + 1);
      segs.forEach((s, i) => s.classList.toggle('done', i < filled));
    });

    seek?.addEventListener('input', () => {
      const dur = video.duration || known;
      video.currentTime = (seek.value / 100) * dur;
      seek.style.setProperty('--p', seek.value + '%');
    });

    // volume
    video.volume = 0.7;
    vol.style.setProperty('--v', '70%');
    vol?.addEventListener('input', () => {
      video.volume = vol.value / 100;
      vol.style.setProperty('--v', vol.value + '%');
    });
  }

  /* ---- resume / upload actions ---- */
  document.getElementById('db-start')?.addEventListener('click', () => {
    /* in the combined build the router intercepts [data-nav]; standalone falls back */
    if (document.querySelector('#pgsw')) return;
    showToast('Opening a new design…');
    setTimeout(() => { window.location.href = 'page2.html'; }, 650);
  });

  document.getElementById('db-switch')?.addEventListener('click', (e) => {
    e.preventDefault();
    showToast('Switching account…');
  });
})();
