(() => {
  'use strict';
  const players = new Map();
  const observer = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const player = players.get(entry.target);
      if (entry.isIntersecting) player?.load();
      else if (entry.target.getClientRects().length === 0) player?.video.pause();
    }
  }, { rootMargin: '160px 0px' });
  function enhance() {
    for (const [card, player] of players) if (!card.isConnected) { observer.unobserve(card); player.dispose(); players.delete(card); }
    for (const card of document.querySelectorAll('.markdown-body .folio-video')) {
      if (players.has(card)) continue;
      const video = card.querySelector('video'), play = card.querySelector('.folio-video-play'), status = card.querySelector('.folio-video-status');
      const duration = card.querySelector('.folio-video-duration');
      if (!video || !play || !status || !duration) continue;
      let loaded = false, starting = false, timer;
      const message = text => { if (status.textContent !== text) status.textContent = text; };
      const stopWaiting = () => { clearTimeout(timer); card.classList.remove('is-loading'); play.removeAttribute('aria-busy'); };
      function failed() {
        stopWaiting(); starting = false; video.controls = false; play.hidden = false;
        card.classList.add('has-error'); play.setAttribute('aria-label', '重试播放视频'); message('视频暂时无法播放，可重试或打开原视频');
      }
      function load() {
        if (loaded) return;
        try {
          const url = new URL(video.dataset.src);
          if (url.protocol !== 'https:' || url.username || url.password) return;
          loaded = true; video.preload = 'metadata'; video.src = url.href;
        } catch { /* Leave malformed media inert; the Markdown link remains available. */ }
      }
      function waiting() {
        card.classList.add('is-loading'); play.setAttribute('aria-busy', 'true'); message('正在加载视频…');
        clearTimeout(timer); timer = setTimeout(() => { if (!card.isConnected) return; message('加载较慢，可继续等待或打开原视频'); }, 12000);
      }
      play.addEventListener('click', event => {
        event.preventDefault(); event.stopPropagation(); if (starting) return;
        const retry = card.classList.contains('has-error'); card.classList.remove('has-error'); starting = true; load();
        if (retry) video.load();
        waiting();
        void video.play().then(() => { starting = false; }, error => {
          starting = false; if (!card.isConnected || error.name === 'AbortError' && !video.error) { stopWaiting(); return; } failed();
        });
      });
      video.addEventListener('loadedmetadata', () => {
        if (!Number.isFinite(video.duration)) return;
        const seconds = Math.floor(video.duration), minutes = Math.floor(seconds / 60);
        duration.textContent = `${minutes}:${String(seconds % 60).padStart(2, '0')}`; duration.hidden = false;
      });
      video.addEventListener('loadeddata', () => { card.classList.add('has-frame'); if (!starting) message(''); });
      video.addEventListener('play', () => {
        for (const player of players.values()) if (player.video !== video && !player.video.paused) player.video.pause();
        const keyboardFocus = document.activeElement === play;
        video.controls = true; play.hidden = true; duration.hidden = true;
        if (keyboardFocus) video.focus({ preventScroll: true });
      });
      video.addEventListener('playing', () => { stopWaiting(); message(''); });
      video.addEventListener('waiting', () => { if (!video.paused) waiting(); });
      video.addEventListener('pause', () => { stopWaiting(); if (!video.error) message(''); });
      video.addEventListener('ended', () => { stopWaiting(); play.hidden = false; play.setAttribute('aria-label', '重新播放视频'); });
      video.addEventListener('error', failed);
      // Playback never enters the Markdown block editor or triggers Cursor's link handling.
      card.addEventListener('pointerdown', event => event.stopPropagation());
      card.addEventListener('dblclick', event => event.stopPropagation());
      players.set(card, { video, load, dispose() { clearTimeout(timer); video.pause(); } }); observer.observe(card);
    }
  }
  document.addEventListener('visibilitychange', () => { if (document.hidden) for (const player of players.values()) player.video.pause(); });
  window.addEventListener('beforeunload', () => { observer.disconnect(); for (const player of players.values()) player.dispose(); players.clear(); });
  window.FolioVideos = { enhance };
})();
