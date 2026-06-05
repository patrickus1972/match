// Forta Match — frontend glue. Replaces hardcoded demo behaviour with real API calls.
(() => {
  'use strict';

  const api = (path, opts = {}) => fetch(path, {
    headers: opts.body ? { 'Content-Type': 'application/json' } : {},
    ...opts,
    body: opts.body && typeof opts.body !== 'string' ? JSON.stringify(opts.body) : opts.body
  }).then(async r => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText} — ${await r.text()}`);
    return r.json();
  });

  const state = {
    activeCaseId: null,
    activeCase: null,
    feedbackTranscript: [],
    chatTranscript: [],
    status: { mock_mode: true, modus: 'snelste_hulp' },
    // Filter-state per pagina; alle defaults laten alles zien
    werklijstFilter: 'all',
    screenFilter:   { kleur: 'all', urgentie: null, type: null, belstatus: null, search: '' },
    labelsFilter:   { status: 'all', search: '' },
    tagsFilter:     { search: '' },
    // Cache zodat re-render bij filter-klik niet opnieuw fetched
    werklijstCache:  null,
    screenCache:     null,
    labelsCache:     null,
    tagsCache:       null
  };

  // ====== Web Speech API Transcription ======
  // Uses browser's built-in speech recognition for real-time transcription.
  // Works in Chrome, Edge, Safari. Falls back to server mock if unavailable.
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const speechSupported = !!SpeechRecognition;

  function createSpeechRecognizer(opts = {}) {
    if (!speechSupported) return null;
    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = opts.lang || 'nl-NL';
    recognition.maxAlternatives = 1;
    return recognition;
  }

  // Helper that manages recording + transcription together
  function createRecordingSession(opts = {}) {
    const onTranscript = opts.onTranscript || (() => {});
    const onInterim = opts.onInterim || (() => {});
    const onError = opts.onError || console.error;
    const onStart = opts.onStart || (() => {});
    const onStop = opts.onStop || (() => {});

    let mediaRecorder = null;
    let audioChunks = [];
    let recognition = null;
    let finalTranscript = '';
    let interimTranscript = '';
    let stream = null;
    let isRecording = false;

    async function start() {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (e) {
        onError('mic-denied', e);
        return false;
      }

      audioChunks = [];
      finalTranscript = '';
      interimTranscript = '';
      isRecording = true;

      // Set up audio recording for playback
      mediaRecorder = new MediaRecorder(stream);
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) audioChunks.push(e.data);
      };

      // Set up speech recognition
      if (speechSupported) {
        recognition = createSpeechRecognizer({ lang: opts.lang });
        recognition.onresult = (event) => {
          interimTranscript = '';
          for (let i = event.resultIndex; i < event.results.length; i++) {
            const result = event.results[i];
            if (result.isFinal) {
              finalTranscript += result[0].transcript + ' ';
              onTranscript(finalTranscript.trim());
            } else {
              interimTranscript += result[0].transcript;
              onInterim(finalTranscript + interimTranscript);
            }
          }
        };
        recognition.onerror = (e) => {
          if (e.error !== 'no-speech' && e.error !== 'aborted') {
            console.warn('Speech recognition error:', e.error);
          }
        };
        recognition.onend = () => {
          // Restart if still recording (recognition auto-stops after silence)
          if (isRecording && recognition) {
            try { recognition.start(); } catch (_) {}
          }
        };
        try { recognition.start(); } catch (_) {}
      }

      mediaRecorder.start();
      onStart();
      return true;
    }

    function stop() {
      isRecording = false;
      if (recognition) {
        try { recognition.stop(); } catch (_) {}
        recognition = null;
      }
      if (mediaRecorder && mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }
      if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
      }
      const blob = audioChunks.length > 0
        ? new Blob(audioChunks, { type: mediaRecorder?.mimeType || 'audio/webm' })
        : null;
      onStop({
        transcript: finalTranscript.trim(),
        audioBlob: blob,
        speechSupported
      });
    }

    function abort() {
      isRecording = false;
      if (recognition) { try { recognition.abort(); } catch (_) {} recognition = null; }
      if (mediaRecorder && mediaRecorder.state === 'recording') { mediaRecorder.stop(); }
      if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    }

    function getState() {
      return isRecording ? 'recording' : 'idle';
    }

    return { start, stop, abort, getState };
  }

  // Expose helpers globally for use by inline scripts in index.html
  window.createRecordingSession = createRecordingSession;
  window.speechSupported = speechSupported;

  // Bucket-logica voor werklijst — moet overeenkomen met badgeFor()
  function werklijstBucket(c) {
    if (c.status === 'incompleet') return 'incompleet';
    if (c.status === 'besloten')   return 'besluit';
    if (c.knockout)                return 'rood';
    if (c.advice === 'ja')         return 'groen';
    if (c.advice === 'twijfel')    return 'oranje';
    if (c.advice === 'nee')        return 'rood';
    return null;
  }

  // Deterministische belstatus + type-afgeleiden voor screen-list — zo blijven
  // ze stabiel tussen reloads zonder dat we het schema hoeven te veranderen.
  const BELSTATUS_CYCLE = ['belt', 'geen-gehoor', 'gebeld'];
  const BELSTATUS_LABEL = { 'belt':'Belt nog', 'geen-gehoor':'Geen gehoor', 'gebeld':'Gebeld' };
  function screenBelstatus(r) { return BELSTATUS_CYCLE[r.id % 3]; }
  function screenType(r) {
    if (r.knockout) return 'knockout';
    const tags = Array.isArray(r.tags) ? r.tags : [];
    if (tags.some(t => t.category === 'comorbiditeit')) return 'comorbiditeit';
    return 'onduidelijk';
  }
  function screenKleur(r) {
    return r.advice === 'nee' ? 'rood' : 'oranje';
  }
  function screenUrgentie(r) {
    const created = new Date(r.created_at + (r.created_at.includes('T') ? '' : 'Z'));
    if (isNaN(created)) return 'vandaag';
    const ageDays = (Date.now() - created.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays >= 7) return '1week';
    if (ageDays >= 3) return '3dagen';
    return 'vandaag';
  }

  const fmtScore = n => (n > 0 ? '+' + n : String(n));
  const escape = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
  const adviceLabel = a => ({ ja: 'Ja · groen', twijfel: 'Twijfel · oranje', nee: 'Nee · rood' }[a] || a);
  const adviceClass = a => ({ ja: 'beslis-groen', twijfel: 'beslis-oranje', nee: 'beslis-rood' }[a] || 'beslis-groen');

  // ====== Status banner ======
  async function loadStatus() {
    try {
      state.status = await api('/api/status');
      const banner = document.getElementById('modeBanner');
      if (banner && state.status.mock_mode) banner.style.display = 'block';
    } catch (e) { console.warn('status', e); }
  }

  // ====== Upload modal ======
  const SAMPLE_LETTER = `Geachte collega,

Hierbij verwijs ik de heer J. Klaassen (geboortejaar 1996, 28 jaar), wonende te Utrecht (3511 AB), voor verdere diagnostiek bij vermoeden van ADHD bij volwassenen.

Hulpvraag
Cliënt meldt zich met langer bestaande aandachts- en concentratieproblemen, vergeetachtigheid en moeite met plannen en organiseren. Klachten zijn op het werk hinderlijk geworden. Vanuit de jeugd geeft hij beelden van impulsiviteit en onrust aan. Hij verzoekt om diagnostisch onderzoek en, afhankelijk van de uitkomsten, behandeling.

Klachten en bevindingen
Tijdens consult valt op: snel afgeleid, springt van onderwerp naar onderwerp, milde innerlijke onrust. Mild verhoogde spanningsklachten. Geen aanwijzingen voor stemmingsstoornis of psychotische symptomen. Geen actieve suïcidaliteit besproken of waargenomen. Geen middelenmisbruik.

Voorgeschiedenis
Bekend bij de praktijk sinds 2019. In 2021 kortdurend coaching gevolgd in verband met werkstress. Geen eerdere DSM-classificatie. Lichamelijk onderzoek en bloedbeeld zijn onlangs verricht en zonder bijzonderheden.

Verzekeraar: Zilveren Kruis.
Telefoon cliënt: 06-12345678
E-mail cliënt: j.klaassen@example.nl

Met vriendelijke groet,
J. Klein, huisarts
AGB-code: 94001234
Praktijk Klein, Utrecht
Datum: ${new Date().toISOString().slice(0,10)}`;

  // ====== Bestand kiezen (PDFs, single of multiple, drag-drop of klik) ======
  function installBestandHandlers() {
    const card  = document.getElementById('cardBestand');
    const input = document.getElementById('bestandInput');
    if (!card || !input) return;

    input.addEventListener('change', e => {
      if (e.target.files.length) handleBestandFiles(e.target.files);
      input.value = '';
    });

    // Drag-and-drop op de hele kaart
    ['dragenter','dragover'].forEach(evt => {
      card.addEventListener(evt, e => {
        e.preventDefault(); e.stopPropagation();
        card.classList.add('dragover');
      });
    });
    ['dragleave','drop'].forEach(evt => {
      card.addEventListener(evt, e => {
        e.preventDefault(); e.stopPropagation();
        if (evt === 'dragleave' && card.contains(e.relatedTarget)) return;
        card.classList.remove('dragover');
      });
    });
    card.addEventListener('drop', e => {
      const files = Array.from(e.dataTransfer?.files || []).filter(f => /\.pdf$/i.test(f.name));
      if (files.length) handleBestandFiles(files);
    });
  }

  async function handleBestandFiles(filesLike) {
    const files = Array.from(filesLike);
    if (files.length === 0) return;

    const toast = document.getElementById('uploadToast');
    const setToast = (html) => {
      if (!toast) return;
      const text = toast.querySelector('div:last-child');
      if (text) text.innerHTML = html;
      toast.style.display = 'flex';
    };
    setToast(`<strong>Bezig met verwerken — ${files.length} bestand${files.length === 1 ? '' : 'en'}…</strong> extractie + check + knock-out per brief.`);

    const results = [];
    for (const file of files) {
      try {
        const fd = new FormData();
        fd.append('file', file);
        fd.append('channel', 'mailbox');
        const res = await fetch('/api/cases', { method: 'POST', body: fd }).then(async r => {
          if (!r.ok) throw new Error(await r.text());
          return r.json();
        });
        results.push(res);
      } catch (e) {
        console.error('upload mislukt voor', file.name, e);
      }
    }

    if (results.length === 1) {
      const r = results[0];
      state.activeCaseId = r.case_id;
      localStorage.setItem('forta.activeCase', r.case_id);
      if (toast) toast.style.display = 'none';
      // Match-resultaten in de chat houden zodat het hele gesprek conversationeel blijft.
      // Pas als de gebruiker een match aanklikt, springen we naar de detail-view.
      if (typeof gcShowCaseMatches === 'function' && gcChatVisible()) {
        gcShowCaseMatches(r.case_id);
      } else {
        window.goto('matching');
      }
    } else {
      setToast(`<strong>${results.length} aanvragen verwerkt</strong> — bekijk ze hieronder in de werklijst.`);
      setTimeout(() => { if (toast) toast.style.display = 'none'; }, 3500);
      renderWerklijst();
    }
  }

  // ====== Zelf opstellen (typen of inspreken) — opent gedeelde modal ======
  let internSession = null;
  let internTimer = null;
  let internSeconds = 0;

  function openInternModal() {
    const m = document.getElementById('internModal');
    if (!m) return;
    m.style.display = 'flex';
    document.getElementById('internText').value = '';
    document.getElementById('internStatus').textContent = speechSupported
      ? ''
      : 'Spraakherkenning niet ondersteund in deze browser — typ de aanvraag handmatig.';
    document.getElementById('internRecordLabel').textContent = 'Klik om op te nemen';
    document.getElementById('internRecordTimer').textContent = '00:00';
    const audio = document.getElementById('internAudio');
    audio.style.display = 'none';
    audio.src = '';
    const btn = document.getElementById('internRecordBtn');
    btn.classList.remove('recording');
    internSeconds = 0;
  }
  window.openInternModal = openInternModal;
  window.openZelfModal   = openInternModal;

  function closeInternModal() {
    const m = document.getElementById('internModal');
    if (m) m.style.display = 'none';
    if (internSession && internSession.getState() === 'recording') internSession.abort();
    internSession = null;
    clearInternTimer();
  }

  function startInternTimer() {
    clearInternTimer();
    internSeconds = 0;
    internTimer = setInterval(() => {
      internSeconds++;
      const mm = String(Math.floor(internSeconds / 60)).padStart(2, '0');
      const ss = String(internSeconds % 60).padStart(2, '0');
      const el = document.getElementById('internRecordTimer');
      if (el) el.textContent = `${mm}:${ss}`;
    }, 1000);
  }
  function clearInternTimer() { if (internTimer) { clearInterval(internTimer); internTimer = null; } }

  async function toggleInternRecording() {
    const btn = document.getElementById('internRecordBtn');
    const label = document.getElementById('internRecordLabel');
    const status = document.getElementById('internStatus');
    const textArea = document.getElementById('internText');

    // If already recording, stop
    if (internSession && internSession.getState() === 'recording') {
      internSession.stop();
      return;
    }

    // Create new recording session with real-time transcription
    internSession = createRecordingSession({
      lang: 'nl-NL',
      onTranscript: (text) => {
        // Update textarea with final transcript in real-time
        textArea.value = text;
      },
      onInterim: (text) => {
        // Show interim results (includes final + interim)
        textArea.value = text;
      },
      onError: (type, err) => {
        status.textContent = 'Microfoon-toegang geweigerd of niet beschikbaar — typ de aanvraag handmatig.';
        console.error('Recording error:', type, err);
      },
      onStart: () => {
        btn.classList.add('recording');
        label.textContent = speechSupported
          ? 'Aan het opnemen en transcriberen — klik om te stoppen'
          : 'Aan het opnemen — klik om te stoppen';
        status.textContent = speechSupported ? 'Live transcriptie actief…' : '';
        startInternTimer();
      },
      onStop: ({ transcript, audioBlob, speechSupported: supported }) => {
        clearInternTimer();
        btn.classList.remove('recording');

        // Show audio playback
        if (audioBlob) {
          const audioEl = document.getElementById('internAudio');
          audioEl.src = URL.createObjectURL(audioBlob);
          audioEl.style.display = 'block';
        }

        if (supported && transcript) {
          label.textContent = 'Transcriptie klaar';
          status.textContent = 'Live getranscribeerd — bewerk indien nodig.';
        } else if (!supported) {
          // No speech support - fall back to server (mock)
          label.textContent = 'Opname klaar — geen live transcriptie beschikbaar';
          status.textContent = 'Spraakherkenning niet ondersteund — typ de tekst handmatig of gebruik Chrome/Edge.';
        } else {
          label.textContent = 'Opname klaar';
          status.textContent = 'Geen spraak gedetecteerd — typ de tekst handmatig.';
        }
      }
    });

    const started = await internSession.start();
    if (!started) {
      internSession = null;
    }
  }

  async function submitInternRequest() {
    const text = document.getElementById('internText').value.trim();
    const status = document.getElementById('internStatus');
    if (text.length < 20) { status.textContent = 'Te kort — spreek iets in of typ minstens een paar zinnen.'; return; }
    status.textContent = 'Verwerken (extractie + check + knock-out)…';
    try {
      const res = await api('/api/cases/intern', { method: 'POST', body: { text } });
      closeInternModal();
      // Zelfde flow als PDF-upload: toon de match-lijst conversationeel in de chat
      // als die actief is; anders val terug op de volledige matching-pagina.
      state.activeCaseId = res.case_id;
      localStorage.setItem('forta.activeCase', res.case_id);
      if (typeof gcShowCaseMatches === 'function' && gcChatVisible()) {
        gcShowCaseMatches(res.case_id);
      } else {
        window.goto('matching');
      }
    } catch (e) {
      console.error(e);
      status.textContent = 'Fout: ' + e.message;
    }
  }

  function openUploadModal(/* mode */) {
    const m = document.getElementById('uploadModal');
    if (!m) return;
    m.style.display = 'flex';
    document.getElementById('modalText').value = '';
    document.getElementById('modalStatus').textContent = '';
    document.getElementById('modalFileName').textContent = '';
  }
  function closeUploadModal() { document.getElementById('uploadModal').style.display = 'none'; }
  window.openUploadModal = openUploadModal;

  async function submitUpload() {
    const text = document.getElementById('modalText').value.trim();
    const channel = document.getElementById('modalChannel').value;
    const fileInput = document.getElementById('modalFileInput');
    const status = document.getElementById('modalStatus');

    if (!text && !fileInput.files[0]) { status.textContent = 'Plak tekst of kies een bestand.'; return; }
    status.textContent = 'Verwerken (extractie + check + knock-out)…';

    let body;
    let opts;
    if (fileInput.files[0]) {
      const fd = new FormData();
      fd.append('file', fileInput.files[0]);
      fd.append('channel', channel);
      if (text) fd.append('text', text);
      opts = { method: 'POST', body: fd };
    } else {
      opts = { method: 'POST', body: JSON.stringify({ channel, text }), headers: { 'Content-Type': 'application/json' } };
    }
    try {
      const res = await fetch('/api/cases', opts).then(async r => {
        if (!r.ok) throw new Error(await r.text());
        return r.json();
      });
      state.activeCaseId = res.case_id;
      localStorage.setItem('forta.activeCase', res.case_id);
      closeUploadModal();
      if (typeof gcShowCaseMatches === 'function' && gcChatVisible()) {
        gcShowCaseMatches(res.case_id);
      } else {
        window.goto('matching');
      }
    } catch (e) {
      console.error(e);
      status.textContent = 'Fout: ' + e.message;
    }
  }

  // ====== Werklijst ======
  // ====== Cross-team overzicht ======
  function isCaseRecent(c, days) {
    if (!c.created_at) return false;
    const t = Date.parse(c.created_at.replace(' ', 'T') + 'Z');
    if (isNaN(t)) return false;
    return (Date.now() - t) / 86400000 <= days;
  }

  function splitCasesForOverview(cases) {
    const newOnes = cases.filter(c => c.status !== 'besloten' && isCaseRecent(c, 7));
    const done = cases.filter(c => c.status === 'besloten');
    return { newOnes, done };
  }

  function updateMsgPanels(cases) {
    const { newOnes, done } = splitCasesForOverview(cases);
    const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
    setText('msgWerkNewCount', String(newOnes.length));
    setText('msgWerkDoneCount', String(done.length));
    setText('msgScrNewCount',  String(newOnes.length));
    setText('msgScrDoneCount', String(done.length));
  }

  const overviewState = { tab: 'new' };

  // Outcome labels for human-readable display
  const OUTCOME_LABELS = {
    match: 'Gematched',
    afwijzen: 'Afgewezen',
    doorzetten_screenteam: 'Doorgezet naar screenteam',
    niet_bereikbaar: 'Niet bereikbaar',
    terug_naar_secretariaat: 'Terug naar secretariaat'
  };

  async function renderRecap() {
    const c = await loadActiveCase();
    if (!c) return;
    const article = document.getElementById('recapArticle');
    const aside   = document.getElementById('recapSide');
    if (!article || !aside) return;

    const isIntern = c.channel === 'intern';
    const ext = c.extraction || {};
    const fields = ext.fields || {};
    const tags = ext.tags || [];
    const dec = c.decision;

    let matchedOption = null;
    if (dec && c.last_match) {
      matchedOption = (c.last_match.options || []).find(o => o.label_id === dec.label_id && o.location_id === dec.location_id);
    }

    let questions = [];
    try { questions = await api(`/api/cases/${c.id}/questions`); } catch {}

    // ---- Article (left column) ----
    const initials = fields.patient_initials || c.patient_initials || '—';
    const age = fields.patient_age || c.patient_age || null;
    const tagsBlock = tags.length
      ? `<div class="tag-list" style="display:flex;flex-wrap:wrap;gap:6px;">${tags.map(t => `<span class="tag" title="${escape(t.evidence||'')}">${escape(t.name)} <span style="color:var(--ink-muted);font-size:10.5px;">· ${escape(t.category)}</span></span>`).join('')}</div>`
      : '<p style="font-size:12.5px;color:var(--ink-muted);">Geen tags geëxtraheerd.</p>';

    const briefSection = isIntern
      ? `<h2>Spraakbericht — interne aanvraag</h2>
         <div class="quote intern">"${escape(c.raw_text || '').replace(/\n/g, '<br>')}"</div>`
      : `<h2>Originele aanvraag</h2>
         <div class="quote">"${escape(c.raw_text || '').replace(/\n/g, '<br>')}"</div>`;

    const hulpvraagSection = fields.hulpvraag
      ? `<p><strong>Hulpvraag:</strong> ${escape(fields.hulpvraag)}</p>`
      : '';

    const questionsSection = questions.length
      ? `<h2>Belgesprek met cliënt — vragen &amp; antwoorden</h2>
         <p style="font-size:12.5px;color:var(--ink-muted);margin-top:0;">Het screenteam heeft de voorbereide vragen tijdens het telefoongesprek doorgenomen. Antwoorden zijn samengevat door de screenteamer.</p>
         <ol class="recap-questions">${questions.map(q => `
           <li>
             <div class="qa-question">${escape(q.text)}${q.source ? `<span class="source-tag">${escape(q.source)}</span>` : ''}</div>
             ${q.answer
                ? `<div class="qa-answer">${escape(q.answer).replace(/\n/g, '<br>')}</div>`
                : `<div class="qa-answer qa-empty">Geen antwoord vastgelegd tijdens het gesprek.</div>`}
           </li>`).join('')}</ol>`
      : '';

    let decisionSection = '';
    if (dec) {
      const outcomeText = OUTCOME_LABELS[dec.outcome] || dec.outcome;
      decisionSection = `<h2>Besluit</h2>
        <p><strong>${escape(outcomeText)}</strong> · door <strong>${escape(dec.actor_name)}</strong> (${escape(dec.actor_role)}) op ${escape(dec.created_at || '')}</p>
        ${dec.motivation ? `<p style="font-size:13px;color:var(--ink-soft);">${escape(dec.motivation)}</p>` : ''}`;
    }

    article.innerHTML = `
      <h2>Aanvraag · ${escape(c.ref_code)}</h2>
      <div class="recap-meta">
        Cliënt <strong>${escape(initials)}${age ? ' · ' + age + ' jr' : ''}</strong>
        · Kanaal ${isIntern ? '<span class="intern-tag">Zelf opgesteld</span>' : escape(c.channel)}
        · Aangemeld ${escape(c.created_at || '')}
      </div>
      ${briefSection}
      ${hulpvraagSection}
      <h2>Door Match herkende tags</h2>
      ${tagsBlock}
      ${questionsSection}
      ${decisionSection}`;

    // ---- Sidebar (right column) ----
    if (!matchedOption || !dec || dec.outcome !== 'match') {
      const outcomeText = dec ? (OUTCOME_LABELS[dec.outcome] || dec.outcome) : 'Geen besluit';
      aside.innerHTML = `
        <div class="recap-match-card" style="border-color:var(--rule);">
          <div class="label-name" style="color:var(--ink);">${escape(outcomeText)}</div>
          <div class="label-loc">${escape(dec?.motivation || 'Voor deze aanvraag is geen Forta-label gekozen.')}</div>
        </div>`;
      return;
    }

    const kindClass = matchedOption.kind === 'sociaal_domein' ? 'kind-sociaal-domein'
                    : matchedOption.is_online ? 'kind-online'
                    : '';
    const kindLabel = matchedOption.kind === 'sociaal_domein' ? 'Sociaal domein'
                    : matchedOption.is_online ? 'Online — Forta'
                    : 'Locatie — Forta';
    const locLine = matchedOption.kind === 'sociaal_domein'
      ? escape(matchedOption.location_name)
      : (matchedOption.is_online ? 'Forta Online' : `Forta ${escape(matchedOption.location_name)}`);

    const positiveTags = (matchedOption.breakdown || []).filter(b => b.kind === 'pos');
    const neutralTags  = (matchedOption.breakdown || []).filter(b => b.kind === 'neutral');
    const negativeTags = (matchedOption.breakdown || []).filter(b => b.kind === 'neg');

    aside.innerHTML = `
      <div class="recap-match-card ${kindClass}">
        <span class="label-kind">${kindLabel}</span>
        <div class="label-name">${escape(matchedOption.label_name)}</div>
        <div class="label-loc">${locLine}</div>
        <div class="label-meta">
          ${matchedOption.wachttijd_dagen != null ? `<div>Wachttijd ${Math.round(matchedOption.wachttijd_dagen/7)} wkn</div>` : ''}
          ${matchedOption.reisMin != null ? `<div>Reistijd ±${matchedOption.reisMin} min</div>` : ''}
          ${matchedOption.label_code ? `<div style="font-family:'Geist Mono',monospace;font-size:11px;">${escape(matchedOption.label_code)}</div>` : ''}
        </div>
        <span class="label-score">Score ${fmtScore(matchedOption.totalScore)}</span>
      </div>
      <div class="recap-match-tags">
        <h4>Tags die bijdroegen</h4>
        <div class="tag-list">
          ${positiveTags.length
            ? positiveTags.map(b => `<span class="tag tag-positive">${escape(b.tag)}</span>`).join('')
            : '<span style="color:var(--ink-muted);font-size:12.5px;">Geen scorende tags.</span>'}
        </div>
        ${negativeTags.length ? `
          <h4 style="margin-top:14px;">Aandachtspunten</h4>
          <div class="tag-list">${negativeTags.map(b => `<span class="tag tag-negative">${escape(b.tag)}</span>`).join('')}</div>` : ''}
        ${neutralTags.length ? `
          <h4 style="margin-top:14px;">Neutrale signalen</h4>
          <div class="tag-list">${neutralTags.slice(0,6).map(b => `<span class="tag tag-neutral">${escape(b.tag)}</span>`).join('')}</div>` : ''}
      </div>`;
  }

  // ============================================================
  // ============ Detail views per status ========================
  // ============================================================
  // Helper: laad case + extractie + match in één keer.
  async function loadCaseFull() {
    const id = state.activeCaseId || +localStorage.getItem('forta.activeCase');
    if (!id) return null;
    state.activeCaseId = id;
    try {
      const c = await api(`/api/cases/${id}`);
      // Als er nog geen match-run is, draai er nu één zodat we options hebben
      if (!c.last_match) {
        try { await api(`/api/cases/${id}/match`, { method: 'POST', body: {} }); }
        catch (e) { console.warn('match-run skipped', e); }
        return await api(`/api/cases/${id}`);
      }
      return c;
    } catch (e) { console.error('loadCaseFull', e); return null; }
  }

  // Volledigheidscheck als basis-view (hergebruikt op knockout + twijfel + check).
  // Bouwt de drie blokken die op page-check te zien zijn: client-card,
  // brief-pane (gestructureerde verwijsbrief) en check-pane (verplichte velden).
  function buildVolledigheidsBaseHtml(c) {
    const ext = c.extraction || {};
    const fields = ext.fields || {};
    const tags = ext.tags || [];
    const klachtPills = tags.filter(t => t.category === 'klachtprofiel').slice(0, 3);
    const items = c.completeness?.items || [];
    const okCount   = items.filter(i => i.status === 'ok').length;
    const warnCount = items.filter(i => i.status === 'warn').length;
    const missCount = items.filter(i => i.status === 'missing').length;
    const summary = items.length === 0
      ? 'Geen volledigheidscheck beschikbaar voor deze case.'
      : `${okCount} van ${items.length} velden ok${warnCount ? ` · ${warnCount} aandachtspunt${warnCount === 1 ? '' : 'en'}` : ''}${missCount ? ` · ${missCount} ontbrekend` : ''}`;

    const initials = c.patient_initials || fields.patient_initials || '—';
    const initialChar = (initials || '?').charAt(0);
    const age = c.patient_age || fields.patient_age;
    const channelLabel = ({ zorgdomein:'Zorgdomein', zivver:'ZIVVER', mailbox:'Mailbox', intern:'Zelf opgesteld' })[c.channel] || c.channel || '—';

    const briefBodyHtml = `
      <h4>Verwijzing</h4>
      <div class="field-grid">
        <div>Datum</div><div>${escape(fields.letter_date || c.created_at || '—')}</div>
        <div>Referentie</div><div>${escape(c.ref_code || '—')}</div>
        <div>Kanaal</div><div>${escape(channelLabel)}</div>
        <div>Verzekeraar</div><div>${escape(fields.insurer_name || c.insurer_name || '—')}</div>
        <div>AGB verwijzer</div><div>${escape(fields.agb_referrer || '—')}</div>
      </div>

      ${fields.hulpvraag ? `
      <h4>Hulpvraag</h4>
      <p>${escape(fields.hulpvraag)}</p>` : ''}

      ${fields.dsm_suspicion ? `
      <h4>Vermoedelijke DSM-5</h4>
      <p>${escape(fields.dsm_suspicion)}</p>` : ''}

      <h4>Door Match herkende tags</h4>
      <div class="tag-row-list" style="margin-top:4px;">
        ${tags.length ? tags.map(t => `<span class="${t.category === 'exclusie' ? 'tag-excl' : 'tag-incl'}" title="${escape(t.evidence || '')}">${escape(t.name)}</span>`).join('') : '<span class="tag-neutral">geen tags</span>'}
      </div>

      <h4 style="margin-top:18px;">Originele tekst</h4>
      <div style="background:var(--bg-deep);padding:14px 16px;border-radius:8px;font-size:13px;line-height:1.55;color:var(--ink-soft);white-space:pre-wrap;max-height:240px;overflow-y:auto;">${escape(c.raw_text || '(brief niet beschikbaar)')}</div>
    `;

    const checkItemsHtml = items.length === 0
      ? '<p style="color:var(--ink-muted);font-size:13px;padding:10px;">Geen check-resultaten opgeslagen.</p>'
      : items.map(i => {
          const icon = i.status === 'ok' ? ['ok','✓'] : i.status === 'warn' ? ['warn','!'] : ['miss','×'];
          return `
            <div class="check-item">
              <span class="check-icon ${icon[0]}">${icon[1]}</span>
              <div>
                <div class="check-label">${escape(i.label || i.field)}</div>
                <div class="check-value ${i.status === 'warn' ? 'warn-text' : ''}">${escape(i.message)}</div>
              </div>
            </div>`;
        }).join('');

    return `
      <div class="client-card" style="margin-bottom:16px;">
        <div class="client-info">
          <div class="client-avatar">${escape(initialChar)}</div>
          <div>
            <div class="client-naam">${escape(initials)}${age ? ' · ' + age + ' jr' : ''}</div>
            <div class="client-meta">${escape(channelLabel)} · ${escape(c.postcode || fields.postcode || 'postcode onbekend')} · ${escape(c.ref_code || '')}</div>
          </div>
        </div>
        <div class="client-pills">
          ${klachtPills.length ? klachtPills.map(t => `<span class="client-pill">${escape(t.name)}</span>`).join('') : '<span class="client-pill">Geen klachtprofiel-tag</span>'}
        </div>
      </div>

      <div class="detail-grid" style="margin-bottom:16px;">
        <div class="brief-pane">
          <div class="brief-pane-head">
            <span class="brief-pane-title">Verwijsbrief — volledige weergave</span>
            <span class="brief-pane-title">${escape(c.ref_code || '')}</span>
          </div>
          <div class="brief-pane-body">${briefBodyHtml}</div>
        </div>

        <div class="check-pane">
          <div class="check-head">
            <h3>Volledigheidscheck</h3>
            <p class="summary">${escape(summary)}</p>
          </div>
          <div class="check-list">${checkItemsHtml}</div>
        </div>
      </div>
    `;
  }

  // ============ Knock-out (rood) ============
  async function renderKnockout() {
    const c = await loadCaseFull();
    if (!c) return;
    const grid = document.getElementById('koGrid');
    if (!grid) return;

    document.getElementById('koRefCode').textContent = c.ref_code || '—';
    const initials = c.patient_initials || '—';
    const age = c.patient_age ? `, ${c.patient_age} jr` : '';
    const pc  = c.postcode ? ` · ${c.postcode}` : '';
    document.getElementById('koSubtitle').textContent =
      `Cliënt ${initials}${age}${pc}. Geen passend Forta-label gevonden — bekijk de knock-out-redenen hieronder.`;

    const koList = c.knockout ? [{
      title: 'Hard knock-out gemarkeerd',
      motivation: c.knockout.reasoning || c.knockout.criterion || 'Knock-out criterium getriggerd',
      criterion: c.knockout.criterion
    }] : [];

    // Per geknockt label de specifieke knockoutReason (briefing: top-3 near-miss)
    const options = c.last_match?.options || [];
    const knocked = options.filter(o => o.knockedOut);
    const live    = options.filter(o => !o.knockedOut);
    // Groepeer reasons per uniek pattern voor de hoofd-sectie
    const reasonsByPattern = {};
    for (const o of knocked) {
      const key = o.knockoutReason || 'Onbekend';
      reasonsByPattern[key] = reasonsByPattern[key] || [];
      reasonsByPattern[key].push(o);
    }
    const reasonCards = Object.entries(reasonsByPattern).map(([reason, opts]) => `
      <div class="ko-reason">
        <div class="ko-reason-icon">⊘</div>
        <div>
          <div class="ko-reason-title">${escape(reason)}</div>
          <div class="ko-reason-motivation">Geldt voor ${opts.length} label${opts.length === 1 ? '' : 's'}: ${
            opts.slice(0, 4).map(o => `<strong>${escape(o.label_code)}</strong>`).join(', ')
          }${opts.length > 4 ? ` (+${opts.length - 4})` : ''}.</div>
        </div>
      </div>
    `).join('');

    // Near-miss: hoogst-scorende live opties (als er live opties zijn die net onder ja vielen — zou hier niet moeten kunnen want rood = advice nee/knockout, maar voor zekerheid tonen)
    const ext = c.extraction || {};
    const tags = ext.tags || [];
    const inclTags = tags.filter(t => ['klachtprofiel', 'doelgroep', 'procedureel', 'zorgtype'].includes(t.category));
    const exclTags = tags.filter(t => t.category === 'exclusie');
    const otherTags = tags.filter(t => !inclTags.includes(t) && !exclTags.includes(t));

    grid.innerHTML = `
      ${buildVolledigheidsBaseHtml(c)}

      <div class="detail-section">
        <h3>Reden van knock-out <span class="section-meta">${knocked.length} van ${options.length} labels getriggerd</span></h3>
        ${koList.map(k => `
          <div class="ko-reason">
            <div class="ko-reason-icon">⊘</div>
            <div>
              <div class="ko-reason-title">${escape(k.title)}</div>
              <div class="ko-reason-motivation">${escape(k.motivation)}</div>
              ${k.criterion ? `<div class="ko-reason-evidence">Criterium: ${escape(k.criterion)}</div>` : ''}
            </div>
          </div>`).join('')}
        ${reasonCards || (!koList.length ? '<p style="color:var(--ink-muted);font-size:13px;">Geen actieve knock-outs geregistreerd voor deze case.</p>' : '')}
      </div>

      <div class="detail-section">
        <h3>Welk Forta-aanbod liep vast? <span class="section-meta">${live.length === 0 ? 'alle labels geknockt' : `${live.length} live, ${knocked.length} geknockt`}</span></h3>
        ${knocked.slice(0, 5).map(o => `
          <div class="near-miss-row">
            <div>
              <div class="near-miss-name">${escape(o.label_name)} <span class="label-code">${escape(o.label_code)}</span></div>
              <div class="near-miss-reason">${escape(o.location_name)}${o.is_online ? ' · online' : ''} — ${escape(o.knockoutReason || '')}</div>
            </div>
            <div class="near-miss-score">—</div>
          </div>`).join('')}
      </div>

      ${exclTags.length ? `
      <div class="detail-section">
        <h3>Exclusietags die de knock-out triggerden <span class="section-meta">${exclTags.length} tag${exclTags.length === 1 ? '' : 's'}</span></h3>
        <div class="tag-row-list">${exclTags.map(t => `<span class="tag-excl">${escape(t.name)}</span>`).join('')}</div>
      </div>` : ''}
    `;

    // Acties wiren
    const rejectBtn = document.getElementById('koActionReject');
    const screenBtn = document.getElementById('koActionOverruleScreen');
    const matchBtn  = document.getElementById('koActionOverruleMatch');
    if (rejectBtn) rejectBtn.onclick = () => postDecision(c.id, 'afwijzen', 'Knock-out — geen passend Forta-label.');
    if (screenBtn) screenBtn.onclick = () => postDecision(c.id, 'doorzetten_screenteam', 'Secretariaat eens met knock-out maar wil dat screenteam meekijkt.');
    if (matchBtn)  matchBtn.onclick  = () => {
      const motivation = prompt('Overrule motivatie — waarom toch matchen ondanks knock-out?');
      if (!motivation || !motivation.trim()) return;
      postDecision(c.id, 'terug_naar_secretariaat', motivation.trim()).then(() => window.goto('matching'));
    };
  }

  async function postDecision(caseId, outcome, motivation) {
    try {
      await api(`/api/cases/${caseId}/decision`, {
        method: 'POST',
        body: { actor_role: 'secretariaat', actor_name: 'Maria Boom', outcome, motivation }
      });
      window.goto('werklijst');
    } catch (e) { alert('Besluit opslaan mislukt: ' + e.message); }
  }

  // ============ Twijfel (oranje) ============
  async function renderTwijfel() {
    const c = await loadCaseFull();
    if (!c) return;
    const grid = document.getElementById('twGrid');
    if (!grid) return;

    document.getElementById('twRefCode').textContent = c.ref_code || '—';
    const initials = c.patient_initials || '—';
    const age = c.patient_age ? `, ${c.patient_age} jr` : '';
    const pc  = c.postcode ? ` · ${c.postcode}` : '';
    document.getElementById('twSubtitle').textContent =
      `Cliënt ${initials}${age}${pc}. Match-score tussen drempels — beoordeel of een Forta-traject passend is.`;

    const options = c.last_match?.options || [];
    const live = options.filter(o => !o.knockedOut);
    const top3 = live.slice(0, 3);
    const ext = c.extraction || {};
    const tags = ext.tags || [];

    // Twijfel-redenen heuristisch afleiden uit de top-optie:
    //  - score-tags met negatieve delta (waarom score laag is)
    //  - tags uit incl_desired die NIET gematched zijn ('wat is nodig voor ja')
    //  - context-signalen uit extraction (indien aanwezig)
    const twijfelReasons = deriveTwijfelReasons(c, top3[0]);

    grid.innerHTML = `
      ${buildVolledigheidsBaseHtml(c)}

      <div class="detail-section">
        <h3>Waarom is dit een twijfelgeval?</h3>
        ${twijfelReasons.summary.length === 0
          ? '<p style="color:var(--ink-muted);font-size:13px;">Geen duidelijke twijfel-signalen — score ligt simpelweg tussen drempels.</p>'
          : `<ul style="margin:0;padding-left:18px;font-size:13.5px;line-height:1.6;">${
              twijfelReasons.summary.map(s => `<li>${escape(s)}</li>`).join('')
            }</ul>`}
      </div>

      <div class="detail-section">
        <h3>Twijfel-tags <span class="section-meta">klik om de brief-context te zien</span></h3>
        <div class="twijfel-tags" id="twTagsList">
          ${twijfelReasons.tags.length === 0
            ? '<span class="tag-neutral">geen specifieke twijfel-tags</span>'
            : twijfelReasons.tags.map((t, i) => `
              <span class="twijfel-tag" data-idx="${i}" title="Klik voor details">${escape(t.label)}</span>
            `).join('')}
        </div>
        <div id="twTagDetail"></div>
      </div>

      <div class="detail-section">
        <h3>Top-3 mogelijke labels <span class="section-meta">net onder de ja-drempel</span></h3>
        ${top3.length === 0
          ? '<p style="color:var(--ink-muted);font-size:13px;">Geen live opties — alle labels geknockt.</p>'
          : top3.map((o, i) => {
              const topTags = (o.breakdown || []).filter(b => b.kind === 'pos').slice(0, 3);
              return `
              <div class="near-miss-row">
                <div>
                  <div class="near-miss-name">#${i + 1} ${escape(o.label_name)} <span class="label-code">${escape(o.label_code)} · ${escape(o.location_name)}</span></div>
                  <div class="near-miss-reason">${topTags.map(t => escape(t.tag)).join(' · ') || 'geen positieve score-bijdrages'}</div>
                </div>
                <div class="near-miss-score">${fmtScore(o.totalScore)}</div>
              </div>`;
            }).join('')}
      </div>

    `;

    // Twijfel-tag klik → evidence-popout
    const list = document.getElementById('twTagsList');
    const detail = document.getElementById('twTagDetail');
    if (list && detail) {
      list.querySelectorAll('.twijfel-tag').forEach(el => {
        el.addEventListener('click', () => {
          const i = +el.dataset.idx;
          const r = twijfelReasons.tags[i];
          detail.innerHTML = `<div class="twijfel-tag-evidence">${escape(r.evidence || '(geen brief-passage)')}</div>`;
        });
      });
    }

    // Acties
    document.getElementById('twActionScreen').onclick = () => postDecision(c.id, 'doorzetten_screenteam', 'Twijfel — vraagt klinische beoordeling.');
    document.getElementById('twActionMatch').onclick  = () => {
      if (top3.length === 0) { alert('Geen live label om aan te koppelen.'); return; }
      postDecision(c.id, 'match', `Secretariaat overtuigd dat ${top3[0].label_code} past — overrule van twijfel.`);
    };
    document.getElementById('twActionReject').onclick = () => postDecision(c.id, 'afwijzen', 'Secretariaat heeft besloten af te wijzen na twijfel-beoordeling.');
  }

  function deriveTwijfelReasons(c, topOption) {
    const summary = [];
    const tags = [];
    const ext = c.extraction || {};
    const briefTags = ext.tags || [];

    if (topOption) {
      const negTags = (topOption.breakdown || []).filter(b => b.kind === 'neg');
      if (negTags.length > 0) {
        summary.push(`Score wordt naar beneden getrokken door: ${negTags.slice(0, 3).map(b => b.tag).join(', ')}.`);
        for (const n of negTags.slice(0, 4)) {
          tags.push({ label: n.tag, evidence: `Score-impact: ${n.tag} (dimensie: ${n.dim || 'onbekend'})` });
        }
      }
      // Score-gap met ja-drempel
      const gap = 18 - (topOption.totalScore || 0);
      if (gap > 0) {
        summary.push(`Top-optie ${topOption.label_code} zit ${gap} punten onder de ja-drempel (18).`);
      }
    }

    // Klachtprofiel-ambiguïteit: meerdere klachtprofielen
    const klacht = briefTags.filter(t => t.category === 'klachtprofiel');
    if (klacht.length >= 2) {
      summary.push(`Meervoudig klachtprofiel (${klacht.map(t => t.name).join(' + ')}) — comorbiditeit-signaal.`);
      tags.push({ label: 'Ambigu klachtprofiel', evidence: `Tags gevonden: ${klacht.map(t => `${t.name} (${t.evidence || ''})`).join(' | ')}` });
    }

    // Procedureel: zowel diagnostiek als behandeling?
    const proc = briefTags.filter(t => t.category === 'procedureel');
    const procNames = proc.map(t => t.name);
    if (procNames.includes('diagnostiek') && procNames.includes('behandeling')) {
      summary.push(`Procedurevoorstel is zowel diagnostiek als behandeling — kies één pad.`);
      tags.push({ label: 'Procedure-ambiguïteit', evidence: 'Brief noemt zowel diagnostiek als behandeling als hulpvraag.' });
    }

    // Comorbiditeit-signalen
    const como = briefTags.filter(t => t.category === 'comorbiditeit');
    if (como.length > 0) {
      summary.push(`Comorbiditeit aanwezig: ${como.map(t => t.name).join(', ')} — kan match complex maken.`);
      tags.push({ label: 'Comorbiditeit', evidence: como.map(t => t.evidence || t.name).join(' · ') });
    }

    return { summary, tags };
  }

  function renderTagsByCategory(tags) {
    const byCat = {};
    for (const t of tags) (byCat[t.category] = byCat[t.category] || []).push(t);
    if (Object.keys(byCat).length === 0) return '<p style="color:var(--ink-muted);font-size:13px;">Geen tags geëxtraheerd.</p>';
    return Object.entries(byCat).map(([cat, list]) => `
      <div style="margin-bottom:10px;">
        <div style="font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:0.05em;margin-bottom:5px;">${escape(cat)}</div>
        <div class="tag-row-list">${list.map(t => `<span class="${cat === 'exclusie' ? 'tag-excl' : 'tag-incl'}">${escape(t.name)}</span>`).join('')}</div>
      </div>`).join('');
  }

  // ============ Besluit (read-only) ============
  async function renderBesluit() {
    const c = await loadCaseFull();
    if (!c) return;
    const grid = document.getElementById('bsGrid');
    if (!grid) return;

    document.getElementById('bsRefCode').textContent = c.ref_code || '—';
    const dec = c.decision;
    const initials = c.patient_initials || '—';
    const age = c.patient_age ? `, ${c.patient_age} jr` : '';

    if (!dec) {
      grid.innerHTML = `<div class="detail-section"><p style="color:var(--ink-muted);">Geen besluit-record gevonden voor deze case.</p></div>`;
      return;
    }

    document.getElementById('bsTitle').textContent = `Besluit — ${(dec.created_at || '').slice(0, 10)}`;
    document.getElementById('bsSubtitle').textContent =
      `Cliënt ${initials}${age}. Read-only review — geen wijzigingen meer mogelijk vanaf het secretariaat.`;

    const outcomeText = OUTCOME_LABELS[dec.outcome] || dec.outcome;
    const options = c.last_match?.options || [];
    const live = options.filter(o => !o.knockedOut);
    const chosen = live.find(o => o.label_id === dec.label_id) || live[0];

    // Vergelijk besluit met AI-advies
    const aiAdvice = c.last_match?.advice;
    const overruled = (aiAdvice === 'ja' && dec.outcome !== 'match') ||
                      (aiAdvice === 'nee' && dec.outcome === 'match');

    grid.innerHTML = `
      <div class="bs-summary-card">
        <div class="outcome-title">${escape(outcomeText)}${chosen && dec.outcome === 'match' ? ` — ${escape(chosen.label_name)} (${escape(chosen.location_name)})` : ''}</div>
        <div class="outcome-meta">
          <div class="lbl">Door</div><div>${escape(dec.actor_name || '—')} · ${escape(dec.actor_role || '—')}</div>
          <div class="lbl">Wanneer</div><div>${escape(dec.created_at || '—')}</div>
          <div class="lbl">Vervolg</div><div>${escape(deriveFollowupStatus(c, dec))}</div>
          ${dec.motivation ? `<div class="lbl">Motivatie</div><div style="font-style:italic;">${escape(dec.motivation)}</div>` : ''}
        </div>
        ${overruled ? `<div style="margin-top:12px;padding:8px 12px;background:var(--amber-soft);color:var(--amber);border-radius:6px;font-size:12.5px;"><strong>Overrule van AI-advies</strong> — AI gaf advies "${escape(aiAdvice)}", besluit was "${escape(dec.outcome)}".</div>` : ''}
      </div>

      ${chosen && dec.outcome === 'match' ? `
        <div class="detail-section">
          <h3>Gekozen label</h3>
          <div style="display:grid;gap:8px;">
            <div><strong>${escape(chosen.label_name)}</strong> <span style="color:var(--ink-muted);font-family:'Geist Mono',monospace;font-size:11px;">${escape(chosen.label_code)}</span></div>
            <div style="font-size:12.5px;color:var(--ink-soft);">${escape(chosen.location_name)}${chosen.is_online ? ' · online' : ''} · wachttijd ${chosen.wachttijd_dagen ?? '—'} dagen${chosen.reisMin != null ? ` · reistijd ${chosen.reisMin} min` : ''}</div>
            <div>
              <div style="font-size:11px;color:var(--ink-muted);text-transform:uppercase;letter-spacing:0.05em;margin:6px 0 4px;">Score: ${fmtScore(chosen.totalScore)}</div>
              <div class="tag-row-list">${(chosen.breakdown || []).slice(0, 8).map(b => `<span class="${b.kind === 'pos' ? 'tag-incl' : b.kind === 'neg' ? 'tag-excl' : 'tag-neutral'}">${escape(b.tag)}</span>`).join('')}</div>
            </div>
          </div>
        </div>` : ''}

      <div class="detail-section">
        <h3>Alle beoordeelde opties <span class="section-meta">${options.length} totaal · klik voor details</span></h3>
        <div id="bsOptions">
          ${options.map((o, i) => `
            <div class="bs-option-row" data-idx="${i}">
              <div class="kleur-bar ${o.knockedOut ? 'rood' : (o.totalScore >= 18 ? 'groen' : o.totalScore >= 6 ? 'oranje' : 'grijs')}"></div>
              <div>
                <div class="near-miss-name">${escape(o.label_name)} <span class="label-code">${escape(o.label_code)} · ${escape(o.location_name)}</span></div>
                <div class="near-miss-reason">${o.knockedOut ? `Knock-out: ${escape(o.knockoutReason || '')}` : `${(o.breakdown || []).filter(b => b.kind === 'pos').length} positieve · ${(o.breakdown || []).filter(b => b.kind === 'neg').length} negatieve score-tags`}</div>
              </div>
              <div class="near-miss-score">${o.knockedOut ? '—' : fmtScore(o.totalScore)}</div>
              <div class="chevron" style="color:var(--ink-muted);">›</div>
            </div>`).join('')}
        </div>
      </div>

      <div class="detail-section">
        <h3>Audit-info <span class="section-meta">versies actief op moment van besluit</span></h3>
        <div style="font-size:12.5px;color:var(--ink-soft);display:grid;grid-template-columns:140px 1fr;gap:4px 12px;">
          <div style="color:var(--ink-muted);">Modus</div><div>${escape(c.last_match?.modus || '—')}</div>
          <div style="color:var(--ink-muted);">Rules-versie</div><div>rules_v0.1 <span style="color:var(--ink-muted);font-size:11px;">(placeholder — replay nog niet beschikbaar)</span></div>
          <div style="color:var(--ink-muted);">Taxonomy-versie</div><div>taxonomy_v1.0 <span style="color:var(--ink-muted);font-size:11px;">(placeholder)</span></div>
        </div>
      </div>
    `;

    // Klik op een optie-rij toont breakdown details
    document.querySelectorAll('#bsOptions .bs-option-row').forEach(row => {
      row.addEventListener('click', () => {
        const idx = +row.dataset.idx;
        const opt = options[idx];
        // Toggle expansion
        const next = row.nextElementSibling;
        if (next && next.classList.contains('bs-option-detail')) {
          next.remove();
          row.classList.remove('expanded');
          return;
        }
        const detail = document.createElement('div');
        detail.className = 'bs-option-detail';
        detail.innerHTML = opt.knockedOut
          ? `<div><strong>Knock-out:</strong> ${escape(opt.knockoutReason || 'onbekend')}</div>`
          : (opt.breakdown || []).map(b => `<div><span style="font-family:'Geist Mono',monospace;color:${b.kind==='pos'?'var(--green)':b.kind==='neg'?'var(--red)':'var(--ink-muted)'};">${escape(b.tag)}</span></div>`).join('');
        row.classList.add('expanded');
        row.parentNode.insertBefore(detail, row.nextSibling);
      });
    });

    // Acties: open brief in nieuw venster
    document.getElementById('bsActionOpenBrief').onclick = () => {
      const w = window.open('', '_blank');
      w.document.write(`<pre style="font-family:'Geist Mono',monospace;font-size:13px;line-height:1.55;padding:20px;white-space:pre-wrap;">${(c.raw_text || '').replace(/&/g,'&amp;').replace(/</g,'&lt;')}</pre>`);
      w.document.title = `Verwijsbrief ${c.ref_code}`;
    };
  }

  function deriveFollowupStatus(c, dec) {
    if (dec.outcome === 'match') return 'Cliëntkaart aangemaakt';
    if (dec.outcome === 'afwijzen') return 'Afwijzingsbrief naar verwijzer';
    if (dec.outcome === 'doorzetten_screenteam') return 'Bij screenteam in behandeling';
    if (dec.outcome === 'niet_bereikbaar') return 'Geen contact mogelijk met cliënt';
    if (dec.outcome === 'terug_naar_secretariaat') return 'Teruggestuurd naar secretariaat';
    return '—';
  }

  function renderOvzRow(c, destinationPage) {
    const isIntern = c.channel === 'intern';
    const subLine = isIntern
      ? `<span class="intern-tag">Zelf opgesteld</span>`
      : `Kanaal: ${escape(c.channel)}`;
    let badgeCls = 'fase-badge';
    let badgeTxt = c.status;
    if (c.status === 'besloten') {
      if (c.last_outcome === 'match')   { badgeCls += ' beslis-groen'; badgeTxt = 'Gematched'; }
      else if (c.last_outcome === 'afwijzen') { badgeCls += ' beslis-rood'; badgeTxt = 'Afgewezen'; }
      else { badgeCls += ' beslis-besluit'; badgeTxt = 'Besluit genomen'; }
    } else if (c.last_outcome === 'terug_naar_secretariaat' && c.status === 'klaar_voor_match') {
      badgeCls += ' teruggestuurd'; badgeTxt = 'Terug van screenteam';
    } else if (c.status === 'wacht_screenteam') {
      badgeCls += ' beslis-oranje'; badgeTxt = 'Bij screenteam';
    } else if (c.status === 'incompleet') {
      badgeCls += ' incompleet'; badgeTxt = 'Incompleet';
    } else if (c.advice === 'ja') {
      badgeCls += ' beslis-groen'; badgeTxt = 'Match · groen';
    } else if (c.advice === 'twijfel') {
      badgeCls += ' beslis-oranje'; badgeTxt = 'Twijfel · oranje';
    } else if (c.advice === 'nee') {
      badgeCls += ' beslis-rood'; badgeTxt = 'Geen match · rood';
    } else {
      badgeTxt = 'Klaar voor match';
    }
    let barCls = 'kleur-bar grijs';
    if (c.status === 'besloten' && c.last_outcome === 'match') barCls = 'kleur-bar groen';
    else if (c.knockout || c.last_outcome === 'afwijzen') barCls = 'kleur-bar rood';
    else if (c.status === 'incompleet') barCls = 'kleur-bar geel';
    else if (c.advice === 'ja') barCls = 'kleur-bar groen';

    const div = document.createElement('div');
    div.className = 'werklijst-row' + (c.advice === 'ja' && !c.knockout && c.status !== 'incompleet' ? ' advice-ja' : '');
    div.style.cursor = 'pointer';
    div.innerHTML = `
      <div class="${barCls}"></div>
      <div>
        <div class="screen-ref">VB-${c.id.toString().padStart(4,'0')}</div>
        <div class="screen-ref-sub">${escape(c.ref_code)}</div>
      </div>
      <div>
        <div class="werklijst-naam">${escape(c.patient_initials || '—')} ${c.patient_age ? '· ' + c.patient_age + ' jr' : ''}</div>
        <div class="werklijst-naam-sub">${subLine}</div>
      </div>
      <div class="tijd-cel">${escape(c.created_at || '')}</div>
      <div><span class="${badgeCls}">${escape(badgeTxt)}</span></div>
      <div class="chevron" style="color: var(--ink-muted);">›</div>`;
    div.onclick = () => { state.activeCaseId = c.id; localStorage.setItem('forta.activeCase', c.id); window.goto(destinationPage || 'check'); };
    return div;
  }

  async function renderOverzicht() {
    let cases = [];
    try { cases = await api('/api/cases'); } catch { return; }
    const { newOnes, done } = splitCasesForOverview(cases);
    updateMsgPanels(cases);

    const countNew = document.getElementById('ovzCountNew');
    const countDone = document.getElementById('ovzCountDone');
    if (countNew) countNew.textContent = String(newOnes.length);
    if (countDone) countDone.textContent = String(done.length);

    const tabs = document.querySelectorAll('#page-overzicht .ovz-tab');
    tabs.forEach(t => {
      t.classList.toggle('active', t.dataset.tab === overviewState.tab);
      t.onclick = () => { overviewState.tab = t.dataset.tab; renderOverzicht(); };
    });

    const list = document.getElementById('overzichtList');
    if (!list) return;
    const header = list.querySelector('.werklijst-row.header');
    list.innerHTML = '';
    if (header) list.appendChild(header);
    const rows = overviewState.tab === 'new' ? newOnes : done;
    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'overzicht-empty';
      empty.textContent = overviewState.tab === 'new'
        ? 'Geen nieuwe aanvragen in de afgelopen 7 dagen.'
        : 'Nog geen afgeronde aanvragen — zodra er besluiten zijn genomen verschijnen die hier.';
      list.appendChild(empty);
      return;
    }
    rows.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''));
    const dest = overviewState.tab === 'done' ? 'recap' : 'check';
    for (const c of rows) list.appendChild(renderOvzRow(c, dest));
  }

  async function renderWerklijst({ refetch = true } = {}) {
    const table = document.getElementById('werklijstTable');
    if (!table) return;
    if (refetch || !state.werklijstCache) {
      try { state.werklijstCache = await api('/api/cases'); } catch { return; }
    }
    const cases = state.werklijstCache;
    updateMsgPanels(cases);

    // Counts per bucket bijwerken
    const counts = { all: cases.length, groen: 0, oranje: 0, rood: 0, incompleet: 0, besluit: 0 };
    for (const c of cases) {
      const b = werklijstBucket(c);
      if (b && counts[b] != null) counts[b]++;
    }
    document.querySelectorAll('#werklijstFilters .filter-chip').forEach(chip => {
      const f = chip.dataset.wlFilter;
      chip.classList.toggle('active', f === state.werklijstFilter);
      const cnt = chip.querySelector('.chip-count');
      if (cnt) cnt.textContent = String(counts[f] ?? 0);
    });

    // Filter toepassen
    const filtered = state.werklijstFilter === 'all'
      ? cases
      : cases.filter(c => werklijstBucket(c) === state.werklijstFilter);

    // Summary in de filter-bar header
    const WL_LABEL = { groen:'Gematched · groen', oranje:'Gematched · oranje', rood:'Gematched · rood', incompleet:'Incompleet', besluit:'Besluit genomen' };
    const pills = state.werklijstFilter === 'all' ? [] : [WL_LABEL[state.werklijstFilter]];
    renderFilterBarSummary('werklijst', pills, filtered.length, cases.length);
    const meta = document.getElementById('werklijstMeta');
    if (meta) meta.textContent = `${cases.length} brieven · ${cases.filter(c => c.status !== 'besloten').length} nog open`;

    const header = table.querySelector('.werklijst-row.header');
    table.innerHTML = '';
    if (header) table.appendChild(header);
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:30px;text-align:center;color:var(--ink-muted);font-size:13px;';
      empty.textContent = cases.length === 0
        ? 'Nog geen verwijsbrieven verwerkt. Klik bovenaan op "Upload verwijsbrief" om te starten.'
        : 'Geen aanvragen in deze filter — kies een ander filter.';
      table.appendChild(empty);
      return;
    }
    const colorFor = c => {
      if (c.status === 'incompleet') return 'kleur-bar geel';
      if (c.knockout) return 'kleur-bar rood';
      if (c.advice === 'ja') return 'kleur-bar groen';
      return 'kleur-bar grijs';
    };
    const badgeFor = c => {
      if (c.last_outcome === 'terug_naar_secretariaat' && c.status === 'klaar_voor_match') return ['fase-badge teruggestuurd', 'Terug van screenteam'];
      if (c.status === 'incompleet') return ['fase-badge incompleet', 'Incompleet'];
      if (c.knockout) return ['fase-badge beslis-rood', 'Knock-out'];
      if (c.advice === 'ja') return ['fase-badge beslis-groen', 'Match · groen'];
      if (c.advice === 'twijfel') return ['fase-badge beslis-oranje', 'Twijfel · oranje'];
      if (c.advice === 'nee') return ['fase-badge beslis-rood', 'Geen match · rood'];
      if (c.status === 'besloten') return ['fase-badge beslis-besluit', 'Besluit genomen'];
      return ['fase-badge', 'Klaar voor match'];
    };
    const visibleCases = state.werklijstExpanded ? filtered : filtered.slice(0, LIST_PREVIEW_COUNT);
    const hiddenCount = filtered.length - visibleCases.length;
    for (const c of visibleCases) {
      const [badgeCls, badgeTxt] = badgeFor(c);
      const isIntern = c.channel === 'intern';
      const subLine = isIntern
        ? `<span class="intern-tag">Zelf opgesteld</span>`
        : `Kanaal: ${escape(c.channel)}`;
      const div = document.createElement('div');
      div.className = 'werklijst-row' + (c.advice === 'ja' && !c.knockout && c.status !== 'incompleet' ? ' advice-ja' : '');
      div.style.cursor = 'pointer';
      div.innerHTML = `
        <div class="${colorFor(c)}"></div>
        <div>
          <div class="screen-ref">VB-${c.id.toString().padStart(4,'0')}</div>
          <div class="screen-ref-sub">${escape(c.ref_code)}</div>
        </div>
        <div>
          <div class="werklijst-naam">${escape(c.patient_initials || '—')} ${c.patient_age ? `· ${c.patient_age} jr` : ''}</div>
          <div class="werklijst-naam-sub">${subLine}</div>
        </div>
        <div class="tijd-cel">
          ${escape(c.created_at)}
        </div>
        <div><span class="${badgeCls}">${escape(badgeTxt)}</span></div>
        <div class="chevron" style="color: var(--ink-muted);">›</div>`;
      div.onclick = () => {
        state.activeCaseId = c.id;
        localStorage.setItem('forta.activeCase', c.id);
        window.goto(pageForCase(c));
      };
      table.appendChild(div);
    }
    if (hiddenCount > 0) {
      appendMoreButton(table, hiddenCount, () => {
        state.werklijstExpanded = true;
        renderWerklijst({ refetch: false });
      });
    }
  }

  // Routing per status: de werklijst-rij dispatcht naar de juiste detail-view.
  // Briefing secretariaat-detailviews — elk statustype krijgt een eigen pagina.
  function pageForCase(c) {
    if (c.status === 'incompleet')                return 'check';
    if (c.status === 'besloten')                  return 'besluit';
    if (c.knockout || c.advice === 'nee')         return 'knockout';
    if (c.advice === 'twijfel')                   return 'twijfel';
    if (c.advice === 'ja')                        return 'matching';
    return 'check';
  }

  // ====== Check page ======
  async function loadActiveCase() {
    const id = state.activeCaseId || +localStorage.getItem('forta.activeCase');
    if (!id) return null;
    state.activeCaseId = id;
    state.activeCase = await api(`/api/cases/${id}`);
    return state.activeCase;
  }

  // Cache static check-page HTML so we can restore it after viewing an intern case
  const checkSnapshot = {};
  function snapshotCheckPage() {
    if (checkSnapshot.taken) return;
    const head = document.querySelector('#page-check .page-header');
    const card = document.querySelector('#page-check .client-card');
    const briefHead = document.querySelector('#page-check .brief-pane .brief-pane-head');
    const briefBody = document.querySelector('#page-check .brief-pane .brief-pane-body');
    if (head) {
      checkSnapshot.eyebrow = head.querySelector('.page-eyebrow')?.textContent || '';
      checkSnapshot.title = head.querySelector('.page-title')?.textContent || '';
      checkSnapshot.subtitle = head.querySelector('.page-subtitle')?.textContent || '';
    }
    if (card) checkSnapshot.card = card.innerHTML;
    if (briefHead) checkSnapshot.briefHead = briefHead.innerHTML;
    if (briefBody) checkSnapshot.briefBody = briefBody.innerHTML;
    checkSnapshot.headTitle = document.getElementById('checkHeadTitle')?.textContent || 'Controle-resultaat';
    checkSnapshot.taken = true;
  }

  function buildInternChecklist(extraction) {
    const fields = extraction?.fields || extraction || {};
    const tags = extraction?.tags || [];
    const byCat = (cat) => tags.filter(t => t.category === cat);
    const klacht = byCat('klachtprofiel');
    const veiligheid = byCat('exclusie');
    const proc = byCat('procedureel');
    const items = [];
    items.push((fields.patient_initials || fields.patient_age || fields.postcode)
      ? { status: 'ok', label: 'Cliëntgegevens', message: [fields.patient_initials, fields.patient_age ? fields.patient_age + ' jr' : null, fields.postcode].filter(Boolean).join(' · ') }
      : { status: 'warn', label: 'Cliëntgegevens', message: 'Niet expliciet genoemd — vraag indiener om aanvulling' });
    items.push(klacht.length
      ? { status: 'ok', label: 'Klachtrichting herkend', message: klacht.map(t => t.name).join(', ') }
      : { status: 'warn', label: 'Klachtrichting', message: 'Geen klachtprofiel-tag uit bericht gehaald' });
    items.push(proc.length
      ? { status: 'ok', label: 'Vraagrichting', message: proc.map(t => t.name).join(', ') }
      : { status: 'warn', label: 'Vraagrichting', message: 'Diagnostiek of behandeling niet expliciet — opvragen' });
    items.push(veiligheid.length
      ? { status: 'err', label: 'Veiligheidssignaal', message: veiligheid.map(t => t.name).join(', ') }
      : { status: 'ok', label: 'Veiligheidssignalen', message: 'Geen psychose / suïcidaliteit / forensisch signaal in tekst' });
    items.push(fields.insurer_name
      ? { status: 'ok', label: 'Verzekeraar', message: fields.insurer_name + ' — afgeleid uit bericht' }
      : { status: 'warn', label: 'Verzekeraar', message: 'Niet expliciet — opvragen vóór commit' });
    items.push({ status: 'ok', label: 'Type aanvraag', message: 'Interne aanvraag · spraakbericht (ongestructureerd)' });
    return items;
  }

  async function renderCheck() {
    const c = await loadActiveCase();
    if (!c) return;
    snapshotCheckPage();

    // Header indicator
    const ind = document.getElementById('briefIndicator');
    if (ind) {
      ind.style.display = 'flex';
      const t = ind.querySelector('.indicator-text');
      if (t) t.innerHTML = `In behandeling: <strong>${escape(c.ref_code)}</strong>`;
      const m = ind.querySelector('.indicator-meta');
      if (m) m.textContent = c.created_at || '';
    }

    const isIntern = c.channel === 'intern';
    const ext = c.extraction || {};
    const tags = ext.tags || [];

    const eyebrow = document.querySelector('#page-check > .page-header .page-eyebrow');
    const title = document.querySelector('#page-check > .page-header .page-title');
    const subtitle = document.querySelector('#page-check > .page-header .page-subtitle');
    const cardEl = document.querySelector('#page-check .client-card');
    const briefHead = document.querySelector('#page-check .brief-pane .brief-pane-head');
    const briefBody = document.querySelector('#page-check .brief-pane .brief-pane-body');
    const headTitleEl = document.getElementById('checkHeadTitle');
    const secondaryBtn = document.getElementById('checkSecondaryBtn');

    if (isIntern) {
      if (eyebrow) eyebrow.textContent = 'Stap 1 van 3 · Interne aanvraag';
      if (title) title.textContent = 'Triage interne aanvraag';
      if (subtitle) subtitle.textContent = 'Een korte aanvraag van een collega-secretariaat — geen formele verwijsbrief. Match heeft het spraakbericht getranscribeerd en tags eruit gehaald. Beoordeel onderstaand en zet door naar matching, of stuur de aanvraag terug aan de indiener.';
      if (headTitleEl) headTitleEl.textContent = 'Triage-resultaat';
      if (secondaryBtn) secondaryBtn.textContent = 'Terug naar indiener';

      // Client-card → intern-specific
      if (cardEl) {
        const initials = ext.fields?.patient_initials || ext.patient_initials || '';
        const age = ext.fields?.patient_age || ext.patient_age || 0;
        const postcode = ext.fields?.postcode || ext.postcode || '';
        const klachtTags = tags.filter(t => t.category === 'klachtprofiel').slice(0, 4);
        cardEl.innerHTML = `
          <div class="client-info">
            <div class="client-avatar" style="background:var(--violet-soft);color:var(--violet);">IA</div>
            <div>
              <div class="client-naam">${initials ? escape(initials) + (age ? ' · ' + age + ' jr' : '') : 'Cliënt — details staan in het bericht'}</div>
              <div class="client-meta"><span class="intern-tag">Zelf opgesteld</span> · ontvangen ${escape(c.created_at || '')}${postcode ? ' · ' + escape(postcode) : ''}</div>
            </div>
          </div>
          <div class="client-pills">
            ${klachtTags.length ? klachtTags.map(t => `<span class="client-pill">${escape(t.name)}</span>`).join('') : '<span class="client-pill">Tags worden hieronder getoond</span>'}
          </div>`;
      }

      // Left pane: transcript + recognized tags instead of a formal verwijsbrief
      if (briefHead) {
        briefHead.innerHTML = `
          <span class="brief-pane-title">Spraakbericht — interne aanvraag</span>
          <span class="brief-pane-title">${escape(c.ref_code)}</span>`;
      }
      if (briefBody) {
        const tagBlocks = tags.length
          ? tags.map(t => `<span class="tag" title="${escape(t.evidence || '')}">${escape(t.name)} <span style="color:var(--ink-muted);font-size:10.5px;">· ${escape(t.category)}</span></span>`).join('')
          : '<span style="color:var(--ink-muted);font-size:12.5px;">Geen tags herkend in dit bericht.</span>';
        briefBody.innerHTML = `
          <h4>Bron &amp; type</h4>
          <div class="field-grid">
            <div>Type</div><div><span class="intern-tag">Zelf opgesteld</span></div>
            <div>Ontvangen</div><div>${escape(c.created_at || '')}</div>
            <div>Bron</div><div>Collega-secretariaat — spraakbericht</div>
            <div>Status</div><div><span class="highlight green">Getranscribeerd</span> · ongestructureerd</div>
            ${ext.fields?.insurer_name ? `<div>Verzekeraar</div><div>${escape(ext.fields.insurer_name)} <span style="color:var(--ink-muted);font-size:11px;">(uit bericht)</span></div>` : ''}
          </div>
          <h4>Transcriptie</h4>
          <div style="background:var(--bg-deep);padding:14px 16px;border-radius:8px;border-left:3px solid var(--violet);font-size:13.5px;line-height:1.6;color:var(--ink);font-style:italic;">
            "${escape(c.raw_text || '').replace(/\n/g, '<br>')}"
          </div>
          <h4 style="margin-top:18px;">Door Match herkend</h4>
          <div class="tag-list" style="display:flex;flex-wrap:wrap;gap:6px;">${tagBlocks}</div>
          <h4 style="margin-top:18px;">Notities</h4>
          <p style="font-size:12.5px;color:var(--ink-muted);line-height:1.55;">Dit is een korte, ongestructureerde aanvraag van een collega — geen formele verwijsbrief. AGB-code, ZD-nummer en handtekening ontbreken per definitie. Tags zijn op basis van de transcriptie afgeleid; controleer voordat je commit en vraag bij twijfel de indiener om aanvulling.</p>`;
      }
    } else {
      // Restore the original demo HTML for non-intern cases
      if (eyebrow && checkSnapshot.eyebrow) eyebrow.textContent = checkSnapshot.eyebrow;
      if (title && checkSnapshot.title) title.textContent = checkSnapshot.title;
      if (subtitle && checkSnapshot.subtitle) subtitle.textContent = checkSnapshot.subtitle;
      if (headTitleEl) headTitleEl.textContent = checkSnapshot.headTitle || 'Controle-resultaat';
      if (secondaryBtn) secondaryBtn.textContent = 'Markeer incompleet';
      if (cardEl && checkSnapshot.card) cardEl.innerHTML = checkSnapshot.card;
      if (briefHead && checkSnapshot.briefHead) briefHead.innerHTML = checkSnapshot.briefHead;
      if (briefBody && checkSnapshot.briefBody) briefBody.innerHTML = checkSnapshot.briefBody;
    }

    // Replace check-list
    const list = document.getElementById('checkList');
    const sumEl = document.getElementById('checkSummary');
    if (list) {
      list.innerHTML = '';
      const items = isIntern ? buildInternChecklist(ext) : (c.completeness?.items || []);
      for (const i of items) {
        const icon = i.status === 'ok' ? ['ok','✓'] : i.status === 'warn' ? ['warn','!'] : ['miss','×'];
        const div = document.createElement('div');
        div.className = 'check-item';
        div.innerHTML = `
          <span class="check-icon ${icon[0]}">${icon[1]}</span>
          <div>
            <div class="check-label">${escape(i.label || i.field)}</div>
            <div class="check-value ${i.status === 'warn' ? 'warn-text' : ''}">${escape(i.message)}</div>
          </div>`;
        list.appendChild(div);
      }
      const ok = items.filter(i => i.status === 'ok').length;
      const total = items.length;
      const warn = items.filter(i => i.status === 'warn').length;
      const err = items.filter(i => i.status === 'err' || i.status === 'missing').length;
      if (sumEl) {
        sumEl.textContent = isIntern
          ? `${ok} van ${total} triage-checks ok` + (warn ? ` · ${warn} aandachtspunt${warn === 1 ? '' : 'en'}` : '') + (err ? ` · ${err} signaal${err === 1 ? '' : 'en'}` : '')
          : `${ok} van ${total} velden ok` + (warn ? ` · ${warn} aandachtspunt(en)` : '') + (err ? ` · ${err} ontbrekend` : '');
      }
    }

    // Knockout banner
    const koEl = document.getElementById('knockoutBanner');
    const koTitle = document.getElementById('knockoutTitle');
    const koText = document.getElementById('knockoutText');
    if (koEl && koTitle && koText) {
      const ko = c.knockout;
      if (ko && ko.triggered) {
        koEl.style.background = 'var(--red-soft)';
        koEl.style.borderColor = 'var(--red)';
        koTitle.textContent = 'Knock-out gedetecteerd: ' + (ko.criterion || '—');
        koText.textContent = ko.reasoning || '';
      } else if (ko && ko.criterion === 'acute_suicidaliteit_signaal') {
        koEl.style.background = 'var(--amber-soft)';
        koEl.style.borderColor = 'var(--amber)';
        koTitle.textContent = 'Signaal: acute suïcidaliteit';
        koText.textContent = ko.reasoning || '';
      } else {
        koEl.style.background = '';
        koEl.style.borderColor = '';
        koTitle.textContent = 'Geen knock-out gedetecteerd';
        koText.textContent = ko?.reasoning || 'Brief is geschikt voor matching tegen alle actieve labels.';
      }
    }

    // Wire "Naar matching →" to actually run a match first
    const naar = document.querySelector('#page-check .check-actions .btn-primary');
    if (naar) {
      naar.onclick = async (e) => {
        e.preventDefault();
        await api(`/api/cases/${c.id}/match`, { method: 'POST', body: { modus: state.status.modus } });
        window.goto('matching');
      };
    }
  }

  // ====== Matching page (shared rendering helper) ======
  function populateMatching(els, c, result, ctx) {
    // Tags panel - use enriched tags from result if available (includes screenteam input)
    const panel = els.tagsPanel;
    if (panel) {
      const tags = result.tags || c.extraction?.tags || [];
      const hasScreenteamTags = result.enrichedFromScreenteam && result.additionalTagCount > 0;
      const grouped = {};
      for (const t of tags) (grouped[t.category] ||= []).push(t);

      const enrichmentNote = hasScreenteamTags
        ? `<div class="enrichment-notice" style="background:var(--green-bg);border-left:3px solid var(--green);padding:8px 12px;margin:12px 0;font-size:12px;border-radius:4px;">
            <strong>+${result.additionalTagCount} tags</strong> toegevoegd uit het belgespreksnotities
           </div>`
        : '';

      panel.innerHTML = `<h3>${ctx === 'screenteam' ? 'Uit de aanvraag' : 'Uit de brief gehaald'}</h3>
        <p class="desc">Tags die ${state.status.mock_mode ? 'de regex-fallback' : 'Claude'} uit de ${ctx === 'screenteam' ? 'aanvraag + belgespreksnotities' : 'brief'} heeft gehaald. Confidence ${(c.extraction?.llm_confidence || 0).toFixed(2)}.</p>
        ${enrichmentNote}`;

      for (const [cat, items] of Object.entries(grouped)) {
        const tg = document.createElement('div');
        tg.className = 'tag-group';
        tg.innerHTML = `<div class="tag-group-label">${escape(cat)}</div><div class="tag-list">${items.map(t => {
          const isScreenteam = t.source === 'screenteam';
          const cls = isScreenteam ? 'tag tag-screenteam' : 'tag';
          const title = isScreenteam ? `[Uit belgespreks] ${escape(t.evidence||'')}` : escape(t.evidence||'');
          return `<span class="${cls}" title="${title}">${escape(t.name)}${isScreenteam ? ' ✦' : ''}</span>`;
        }).join('')}</div>`;
        panel.appendChild(tg);
      }
    }

    if (els.toolbarText) els.toolbarText.innerHTML = `<strong>${result.options.length} opties</strong> beoordeeld · advies: <strong>${escape(adviceLabel(result.advice))}</strong>`;
    if (els.toolbarModus) els.toolbarModus.textContent = ({ snelste_hulp: 'Snelste hulp', labelbalans: 'Labelbalans', match_kwaliteit: 'Match-kwaliteit', custom: 'Custom' }[result.modus] || result.modus);

    const ml = els.matchesList;
    if (ml) {
      ml.innerHTML = '';
      const live = result.options.filter(o => !o.knockedOut);
      const dead = result.options.filter(o => o.knockedOut);
      // Forta-kolom toont alleen de levende opties; knock-outs worden
      // bovenaan samengevat in één regel met de criteria.
      const fortaOffline = live.filter(o => (o.kind || 'forta') === 'forta' && !o.is_online);
      const fortaOfflineDead = dead.filter(o => (o.kind || 'forta') === 'forta' && !o.is_online);
      const fortaOnline    = live.filter(o => (o.kind || 'forta') === 'forta' && o.is_online);
      const sociaalOptions = live.filter(o => o.kind === 'sociaal_domein');
      const alternatives   = [...fortaOnline, ...sociaalOptions]; // sorted within each by score (already)
      // top-overall option gets the "Aanbevolen" badge — but only when it's a Forta option
      const topOverall = live.find(o => (o.kind || 'forta') === 'forta') || live[0];

      const labelForKind = (o) => o.kind === 'sociaal_domein' ? 'Sociaal domein' : (o.is_online ? 'Online' : 'Offline');
      const locLineFor = (o) => {
        if (o.kind === 'sociaal_domein') return `${escape(o.location_name)}${o.is_online ? '' : (o.reisMin != null ? ` · reistijd ±${o.reisMin} min` : '')}`;
        return o.is_online ? 'Forta Online' : `Forta ${escape(o.location_name)}${o.reisMin != null ? ` · reistijd ±${o.reisMin} min` : ''}`;
      };

      const renderCard = (o, rankInColumn) => {
        const isTop = topOverall && o.label_id === topOverall.label_id && o.location_id === topOverall.location_id;
        const isSociaal = o.kind === 'sociaal_domein';
        const cls = ['match-card'];
        if (isTop) cls.push('recommended');
        if (isSociaal) cls.push('kind-sociaal-domein');
        const score = fmtScore(o.totalScore);
        const tagBlocks = (o.breakdown || []).map(b => {
          const cl = b.kind === 'pos' ? 'tag tag-positive' : b.kind === 'neg' ? 'tag tag-negative' : b.kind === 'neutral' ? 'tag tag-neutral' : 'tag';
          return `<span class="${cl}">${escape(b.tag)}</span>`;
        }).join('');
        const kindLabel = labelForKind(o);
        const rankLabel = rankInColumn === 0
          ? (isSociaal ? 'Beste sociaal domein' : (o.is_online ? 'Beste online' : 'Beste optie offline'))
          : `${rankInColumn + 1}e optie ${kindLabel.toLowerCase()}`;
        return `
          <div class="${cls.join(' ')}">
            <div class="match-head">
              <div>
                <div class="match-rank-row">
                  <span class="match-rank">${rankLabel}</span>
                  ${isSociaal ? '<span class="sociaal-domein-badge">Sociaal domein</span>' : ''}
                  ${isTop ? '<span class="recommended-badge">Aanbevolen</span>' : ''}
                </div>
                <div class="match-title">${escape(o.label_name)}</div>
                <div class="match-locatie">
                  <span>${locLineFor(o)}</span>
                  ${o.wachttijd_dagen != null ? `<span>Wachttijd ${Math.round(o.wachttijd_dagen/7)} wkn</span>` : '<span>Wachttijd onbekend</span>'}
                  <span style="color:var(--ink-muted);font-family:'Geist Mono',monospace;font-size:11px;">${escape(o.label_code || '')}</span>
                </div>
              </div>
              <div class="match-score${isTop ? '' : ' dark'}">${score}</div>
            </div>
            <div class="match-tags">${tagBlocks}</div>
            <div class="match-actions">
              <span class="match-actions-meta">${escape(o.label_description || '')}</span>
              <button class="btn ${isTop ? 'btn-primary' : 'btn-secondary'} btn-sm" data-confirm="${o.label_id}|${o.location_id}">Selecteer →</button>
            </div>
          </div>`;
      };

      const offlineSvg = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M8 1.5C5.5 1.5 3.5 3.5 3.5 6c0 3.5 4.5 8.5 4.5 8.5s4.5-5 4.5-8.5c0-2.5-2-4.5-4.5-4.5z"/><circle cx="8" cy="6" r="1.5" fill="currentColor"/></svg>`;
      const altSvg = `<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8h10M9 4l4 4-4 4"/><circle cx="3.5" cy="8" r="1.5"/></svg>`;

      // Knock-out criteria aggregeren per kolom — één strakke regel "X afgevallen vanwege: …"
      const summarizeKO = (arr) => {
        const counts = new Map();
        for (const o of arr) {
          const key = (o.knockoutReason || 'geen reden').trim();
          counts.set(key, (counts.get(key) || 0) + 1);
        }
        return [...counts.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([reason, n]) => `${escape(reason)}${n > 1 ? ` (${n}×)` : ''}`)
          .join(', ');
      };
      const fortaDroppedNotice = fortaOfflineDead.length
        ? `<div class="dropped-notice"><span class="dropped-pill">${fortaOfflineDead.length}</span> Forta-${fortaOfflineDead.length === 1 ? 'label afgevallen' : 'labels afgevallen'} vanwege: <strong>${summarizeKO(fortaOfflineDead)}</strong></div>`
        : '';
      const altDead = dead.filter(o => (o.kind || 'forta') === 'forta' ? o.is_online : true);
      const altDroppedNotice = altDead.length
        ? `<div class="dropped-notice"><span class="dropped-pill">${altDead.length}</span> ${altDead.length === 1 ? 'alternatief afgevallen' : 'alternatieven afgevallen'} vanwege: <strong>${summarizeKO(altDead)}</strong></div>`
        : '';

      ml.innerHTML = `
        <div class="matches-split">
          <div class="matches-column">
            <div class="matches-column-head offline">
              <div class="icon-circle">${offlineSvg}</div>
              <h4>Forta locaties</h4>
              <span class="count">${fortaOffline.length} ${fortaOffline.length === 1 ? 'optie' : 'opties'}</span>
            </div>
            ${fortaDroppedNotice}
            ${fortaOffline.length === 0
              ? '<div style="padding:18px;color:var(--ink-muted);font-size:12.5px;">Geen passend Forta-aanbod voor deze brief.</div>'
              : fortaOffline.slice(0, 6).map((o, i) => renderCard(o, i)).join('')}
          </div>
          <div class="matches-column">
            <div class="matches-column-head alternatieven">
              <div class="icon-circle">${altSvg}</div>
              <h4>Alternatieven</h4>
              <span class="count">${alternatives.length} ${alternatives.length === 1 ? 'optie' : 'opties'} · online + sociaal domein</span>
            </div>
            ${altDroppedNotice}
            ${alternatives.length === 0
              ? '<div style="padding:18px;color:var(--ink-muted);font-size:12.5px;">Geen passende alternatieven voor deze brief.</div>'
              : alternatives.slice(0, 6).map((o, i) => renderCard(o, i)).join('')}
          </div>
        </div>`;

      // Add deviating routes — adapted per context
      const isScreen = ctx === 'screenteam';
      const extra = document.createElement('div');
      extra.innerHTML = `
        <div class="section-divider"><span class="line"></span><span class="label">Afwijkende routes</span><span class="line"></span></div>
        ${isScreen ? `
        <div class="match-card afwijkend">
          <div class="match-head"><div>
            <div class="match-rank-row"><span class="match-rank">Terugsturen</span><span class="afwijkend-badge">Aanvulling nodig</span></div>
            <div class="match-title">Terug naar secretariaat</div>
            <div class="match-locatie"><span>Stuur terug met motivering — bijvoorbeeld als aanvullende info bij verwijzer opgevraagd moet worden.</span></div>
          </div><div class="match-score afwijkend">↺</div></div>
          <div class="match-actions"><span class="match-actions-meta">Geef de reden waarom de aanvraag terug moet.</span>
          <button class="btn btn-warn btn-sm" data-action="terugnaarsec">Terug naar secretariaat →</button></div>
        </div>` : `
        <div class="match-card afwijkend">
          <div class="match-head"><div>
            <div class="match-rank-row"><span class="match-rank">Doorsturen</span><span class="afwijkend-badge">Twijfelgeval</span></div>
            <div class="match-title">Screenteam — telefonische uitvraag</div>
            <div class="match-locatie"><span>Standaardroute bij ambigue klachten of complexe comorbiditeit</span></div>
          </div><div class="match-score afwijkend">→</div></div>
          <div class="match-actions"><span class="match-actions-meta">Geef korte reden waarom dit naar het screenteam moet.</span>
          <button class="btn btn-warn btn-sm" data-action="doorsturen">Doorsturen →</button></div>
        </div>`}
        <div class="match-card afwijzen">
          <div class="match-head"><div>
            <div class="match-rank-row"><span class="match-rank">Afwijzen</span><span class="knockout-badge">Buiten kader</span></div>
            <div class="match-title">Buiten behandelkader</div>
            <div class="match-locatie"><span>${dead.length ? dead.length + ' label-locatie combinatie(s) afgevallen door knock-out' : 'Geen passend aanbod binnen Forta'}</span></div>
          </div><div class="match-score zero">0</div></div>
          ${dead.length ? `<div class="match-tags">${dead.slice(0,5).map(d=>`<span class="tag tag-negative">${escape(d.label_name)} @ ${escape(d.location_name)} — ${escape(d.knockoutReason || 'knockout')}</span>`).join('')}</div>` : ''}
          <div class="match-actions"><span class="match-actions-meta">Genereer terugstuurbrief en sluit af.</span>
          <button class="btn btn-danger btn-sm" data-action="afwijzen">Afwijzen — terugstuurbrief →</button></div>
        </div>`;
      ml.appendChild(extra);

      const actorRole = isScreen ? 'screenteam' : 'secretariaat';
      const actorName = isScreen ? 'Linda van Dijk' : 'Maria Boom';
      const backPage  = isScreen ? 'screen-list' : 'werklijst';

      ml.querySelectorAll('button[data-confirm]').forEach(b => {
        b.onclick = async () => {
          const [labelId, locId] = b.dataset.confirm.split('|').map(Number);
          await api(`/api/cases/${c.id}/decision`, { method: 'POST', body: { outcome: 'match', label_id: labelId, location_id: locId, motivation: 'Bevestigd op basis van AI-advies', actor_role: actorRole, actor_name: actorName } });
          window.goto('decision');
        };
      });
      const btnD = ml.querySelector('button[data-action="doorsturen"]');
      if (btnD) btnD.onclick = async () => {
        const reason = prompt('Reden om door te sturen naar screenteam:');
        if (!reason) return;
        await api(`/api/cases/${c.id}/decision`, { method: 'POST', body: { outcome: 'doorzetten_screenteam', motivation: reason, actor_role: actorRole, actor_name: actorName } });
        alert('Doorgestuurd naar screenteam.');
        window.goto(backPage);
      };
      const btnT = ml.querySelector('button[data-action="terugnaarsec"]');
      if (btnT) btnT.onclick = async () => {
        const reason = prompt('Reden om terug te sturen naar het secretariaat (bv. aanvullende info nodig):');
        if (!reason) return;
        await api(`/api/cases/${c.id}/decision`, { method: 'POST', body: { outcome: 'terug_naar_secretariaat', motivation: reason, actor_role: actorRole, actor_name: actorName } });
        alert('Teruggestuurd naar secretariaat — verschijnt weer op de werklijst.');
        window.goto(backPage);
      };
      const btnA = ml.querySelector('button[data-action="afwijzen"]');
      if (btnA) btnA.onclick = async () => {
        await api(`/api/cases/${c.id}/decision`, { method: 'POST', body: { outcome: 'afwijzen', motivation: 'Geen passend aanbod', actor_role: actorRole, actor_name: actorName } });
        alert('Afgewezen.');
        window.goto(backPage);
      };
    }
  }

  async function renderMatching() {
    const c = await loadActiveCase();
    if (!c) return;
    let result = c.last_match;
    if (!result) {
      result = await api(`/api/cases/${c.id}/match`, { method: 'POST', body: { modus: state.status.modus } });
    } else {
      result = { advice: result.advice, modus: result.modus, options: result.options };
    }
    populateMatching({
      tagsPanel: document.getElementById('tagsPanel'),
      toolbarText: document.getElementById('matchToolbarText'),
      toolbarModus: document.getElementById('matchToolbarModus'),
      matchesList: document.getElementById('matchesList')
    }, c, result, 'secretariaat');
  }

  async function renderScreenMatching() {
    const c = await loadActiveCase();
    if (!c) return;
    // Always run a fresh match for the screenteam — the screenteam may have
    // updated questions / context that should be reflected. The endpoint is
    // idempotent and stores a new match_runs row each call.
    const result = await api(`/api/cases/${c.id}/match`, { method: 'POST', body: { modus: state.status.modus } });
    populateMatching({
      tagsPanel: document.getElementById('screenTagsPanel'),
      toolbarText: document.getElementById('screenMatchToolbarText'),
      toolbarModus: document.getElementById('screenMatchToolbarModus'),
      matchesList: document.getElementById('screenMatchesList')
    }, c, result, 'screenteam');
  }

  // ====== Decision page ======
  async function renderDecision() {
    const c = await loadActiveCase();
    if (!c) return;
    const summary = document.querySelector('#page-decision .decision-summary');
    if (summary && c.decision) {
      const dec = c.decision;
      const lbl = c.last_match?.options?.find(o => o.label_id === dec.label_id && o.location_id === dec.location_id);
      summary.querySelector('h4').textContent = `${c.ref_code} → ${lbl ? lbl.label_name + ' @ ' + lbl.location_name : 'beslissing genomen'}`;
      summary.querySelector('p').textContent = `${dec.outcome.toUpperCase()} · ${dec.actor_name} (${dec.actor_role}) · ${dec.created_at}`;
    }
    // Wire chatBody to feedback API
    state.chatTranscript = [];
    await renderChatTurn(document.getElementById('chatBody'));
  }

  // ====== Feedback / chat (shared logic for both #chatBody and #feedbackChatBody) ======
  async function renderChatTurn(container, opts = {}) {
    if (!container) return;
    const c = await loadActiveCase();
    if (!c) return;
    const transcriptRef = opts.feedbackPage ? state.feedbackTranscript : state.chatTranscript;

    // Render transcript so far
    container.innerHTML = transcriptRef.map(t => {
      if (t.role === 'agent') return `<div class="chat-msg agent">${opts.feedbackPage ? '<div class="avatar-mini">F</div>' : ''}<div class="chat-bubble">${escape(t.content)}</div></div>`;
      return `<div class="chat-msg user">${opts.feedbackPage ? `<div class="chat-bubble">${escape(t.content)}</div><div class="avatar-mini">M</div>` : `<div class="chat-bubble">${escape(t.content)}</div>`}</div>`;
    }).join('');

    // Fetch next agent turn
    let next;
    try { next = await api(`/api/cases/${c.id}/feedback/turn`, { method: 'POST', body: { transcript: transcriptRef } }); }
    catch (e) { console.error(e); return; }

    transcriptRef.push({ role: 'agent', content: next.agent });

    const agentDiv = document.createElement('div');
    agentDiv.className = 'chat-msg agent';
    agentDiv.innerHTML = (opts.feedbackPage ? '<div class="avatar-mini">F</div>' : '') + `<div class="chat-bubble">${escape(next.agent)}</div>`;
    container.appendChild(agentDiv);

    if ((next.options || []).length > 0) {
      const optsDiv = document.createElement('div');
      optsDiv.className = 'chat-options';
      next.options.forEach(o => {
        const b = document.createElement('button');
        b.className = 'chat-option';
        b.textContent = o;
        b.onclick = () => {
          transcriptRef.push({ role: 'user', content: o });
          renderChatTurn(container, opts);
        };
        optsDiv.appendChild(b);
      });
      container.appendChild(optsDiv);
    } else {
      // Save session
      try {
        await api(`/api/cases/${c.id}/feedback/save`, { method: 'POST', body: { transcript: transcriptRef } });
      } catch (e) { console.warn('feedback save', e); }
    }
    container.scrollTop = container.scrollHeight;

    // Update progress dots if present
    if (opts.feedbackPage) {
      const dots = document.querySelectorAll('#feedbackProgress .step-dot');
      const userTurns = transcriptRef.filter(t => t.role === 'user').length;
      dots.forEach((d, i) => {
        d.classList.remove('active','done');
        if (i < userTurns) d.classList.add('done');
        else if (i === userTurns) d.classList.add('active');
      });
    }
  }

  async function renderFeedbackPage() {
    state.feedbackTranscript = [];
    await renderChatTurn(document.getElementById('feedbackChatBody'), { feedbackPage: true });
    // Update sidebar to reflect this case
    const c = state.activeCase;
    if (!c) return;
    const labelEl = document.querySelector('.feedback-context-label');
    const locEl = document.querySelector('.feedback-context-locatie');
    const scoreEl = document.querySelector('.feedback-context-score .num');
    const top = c.last_match?.options?.find(o => !o.knockedOut);
    if (top) {
      if (labelEl) labelEl.textContent = top.label_name;
      if (locEl) locEl.textContent = top.location_name;
      if (scoreEl) scoreEl.textContent = fmtScore(top.totalScore);
    }
  }

  // ====== Screen list ======
  async function renderScreenList({ refetch = true } = {}) {
    const tbl = document.getElementById('screenTable');
    if (!tbl) return;
    if (refetch || !state.screenCache) {
      try { state.screenCache = await api('/api/screen/cases'); } catch { return; }
    }
    const rows = state.screenCache;
    // Update message panel using the global cases (independent fetch)
    if (refetch) api('/api/cases').then(updateMsgPanels).catch(() => {});

    // Counts per filter-dimensie (op de niet-gefilterde set)
    const cnt = { kleur:{all: rows.length, rood:0, oranje:0},
                  urgentie:{vandaag:0,'3dagen':0,'1week':0},
                  type:{knockout:0, comorbiditeit:0, onduidelijk:0},
                  belstatus:{belt:0,'geen-gehoor':0, gebeld:0} };
    for (const r of rows) {
      cnt.kleur[screenKleur(r)]++;
      cnt.urgentie[screenUrgentie(r)]++;
      cnt.type[screenType(r)]++;
      cnt.belstatus[screenBelstatus(r)]++;
    }
    const f = state.screenFilter;
    document.querySelectorAll('#screenToolbar .filter-chip').forEach(chip => {
      const k = chip.dataset.kleur, u = chip.dataset.urgentie, t = chip.dataset.type, b = chip.dataset.belstatus;
      let active = false, key = null, dim = null;
      if (k) { active = (f.kleur === k); key = k; dim = 'kleur'; }
      else if (u) { active = (f.urgentie === u); key = u; dim = 'urgentie'; }
      else if (t) { active = (f.type === t); key = t; dim = 'type'; }
      else if (b) { active = (f.belstatus === b); key = b; dim = 'belstatus'; }
      chip.classList.toggle('active', active);
      const cntSpan = chip.querySelector('.chip-count');
      if (cntSpan && dim && cnt[dim] && cnt[dim][key] != null) cntSpan.textContent = String(cnt[dim][key]);
    });

    // Filter toepassen (AND over dimensies, plus tekstzoek)
    const search = (f.search || '').toLowerCase().trim();
    const filtered = rows.filter(r => {
      if (f.kleur     && f.kleur     !== 'all' && screenKleur(r)     !== f.kleur)     return false;
      if (f.urgentie  && screenUrgentie(r)  !== f.urgentie)  return false;
      if (f.type      && screenType(r)      !== f.type)      return false;
      if (f.belstatus && screenBelstatus(r) !== f.belstatus) return false;
      if (search) {
        const hay = `${r.ref_code} ${r.patient_initials || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    // Summary-pillen voor filter-bar header
    const KLEUR_LABEL = { rood:'Rood', oranje:'Oranje' };
    const URG_LABEL   = { vandaag:'Vandaag binnen', '3dagen':'> 3 dagen', '1week':'> 1 week' };
    const TYPE_LABEL  = { knockout:'Knock-out kandidaat', comorbiditeit:'Comorbiditeit', onduidelijk:'Onduidelijke vraag' };
    const pills = [];
    if (f.kleur && f.kleur !== 'all') pills.push(`Kleur: ${KLEUR_LABEL[f.kleur]}`);
    if (f.urgentie)                   pills.push(`Urgentie: ${URG_LABEL[f.urgentie]}`);
    if (f.type)                       pills.push(`Type: ${TYPE_LABEL[f.type]}`);
    if (f.belstatus)                  pills.push(`Belstatus: ${BELSTATUS_LABEL[f.belstatus]}`);
    if (search)                       pills.push(`Zoek: "${search}"`);
    renderFilterBarSummary('screen', pills, filtered.length, rows.length);

    const header = tbl.querySelector('.screen-row.header');
    tbl.innerHTML = '';
    if (header) tbl.appendChild(header);
    if (filtered.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:30px;text-align:center;color:var(--ink-muted);font-size:13px;';
      empty.textContent = rows.length === 0
        ? 'Geen aanvragen open voor het screenteam.'
        : 'Geen aanvragen voor deze filtercombinatie — pas filters aan.';
      tbl.appendChild(empty);
      return;
    }
    const visibleRows = state.screenExpanded ? filtered : filtered.slice(0, LIST_PREVIEW_COUNT);
    const hiddenRows = filtered.length - visibleRows.length;
    for (const r of visibleRows) {
      const barClass = r.advice === 'ja' ? 'groen' : r.advice === 'nee' ? 'rood' : 'oranje';
      const belKey = screenBelstatus(r);
      const div = document.createElement('div');
      div.className = 'screen-row' + (r.advice === 'ja' ? ' advice-ja' : '');
      div.style.cursor = 'pointer';
      div.innerHTML = `
        <div class="kleur-bar ${barClass}"></div>
        <div><div class="screen-ref">ST-${r.id.toString().padStart(4,'0')}</div><div class="screen-ref-sub">${escape(r.ref_code)}</div></div>
        <div><div class="screen-naam">${escape(r.patient_initials || '—')} ${r.patient_age ? '· ' + r.patient_age + ' jr':''}</div>
          <div class="screen-naam-sub"><span class="complex-tag">${escape(r.reason || 'door secretariaat')}</span></div></div>
        <div>${escape(r.created_at)}</div>
        <div><span class="bel-status bel-${belKey}">${escape(BELSTATUS_LABEL[belKey])}</span></div>
        <div><span class="fase-badge">Wacht op screen</span></div>
        <div><span class="${adviceClass(r.advice)} fase-badge">${escape(adviceLabel(r.advice || '—'))}</span></div>
        <div class="chevron">›</div>`;
      div.onclick = () => { state.activeCaseId = r.id; localStorage.setItem('forta.activeCase', r.id); window.goto('screen-case'); };
      tbl.appendChild(div);
    }
    if (hiddenRows > 0) {
      appendMoreButton(tbl, hiddenRows, () => {
        state.screenExpanded = true;
        renderScreenList({ refetch: false });
      });
    }
  }

  async function renderScreenCase() {
    const c = await loadActiveCase();
    if (!c) return;
    const eyebrow = document.querySelector('#page-screen-case .page-eyebrow');
    if (eyebrow) eyebrow.innerHTML = `<a onclick="goto('screen-list')" style="color: var(--burgundy); cursor: pointer;">← Terug naar aanvragenlijst</a> · <span class="mono" style="color: var(--ink-muted);">${escape(c.ref_code)}</span>`;

    // Update case-recap with real data
    updateScreenCaseRecap(c);

    // Reset full case panel state
    const panel = document.getElementById('fullCasePanel');
    const chevron = document.getElementById('fullCaseChevron');
    if (panel) panel.style.display = 'none';
    if (chevron) chevron.style.transform = '';

    installQuestionHandlers();
    let items = [];
    try { items = await api(`/api/cases/${c.id}/questions`); } catch (e) { console.error('questions load', e); }
    renderQuestionList(items);
  }

  function updateScreenCaseRecap(c) {
    const recapEl = document.getElementById('screenCaseRecap');
    if (!recapEl || !c) return;

    const ext = c.extraction || {};
    const tags = ext.tags || [];
    const initials = c.patient_initials || ext.patient_initials || 'Cliënt';
    const age = c.patient_age || ext.patient_age;
    const postcode = ext.postcode || '';
    const insurer = ext.insurer_name || '';
    const hulpvraag = ext.hulpvraag || '';
    const channel = c.channel || 'onbekend';

    const tagNames = tags.slice(0, 5).map(t => t.name).join(', ');

    recapEl.innerHTML = `
      <p>Verwijzing via <strong>${escape(channel)}</strong>. <strong>${escape(initials)}${age ? `, ${age} jaar` : ''}</strong>${postcode ? `, ${postcode}` : ''}.${insurer ? ` Verzekeraar: ${escape(insurer)}.` : ''}</p>
      ${hulpvraag ? `<p style="margin-top:8px;"><em>"${escape(hulpvraag)}"</em></p>` : ''}
      ${tagNames ? `<p style="margin-top:8px;">Geëxtraheerde tags: <strong>${escape(tagNames)}</strong>${tags.length > 5 ? ` (+${tags.length - 5} meer)` : ''}</p>` : ''}
    `;
  }

  // Toggle full case panel
  window.toggleFullCase = async function() {
    const panel = document.getElementById('fullCasePanel');
    const chevron = document.getElementById('fullCaseChevron');
    const content = document.getElementById('fullCaseContent');
    if (!panel) return;

    const isOpen = panel.style.display !== 'none';
    if (isOpen) {
      panel.style.display = 'none';
      if (chevron) chevron.style.transform = '';
    } else {
      panel.style.display = 'block';
      if (chevron) chevron.style.transform = 'rotate(180deg)';

      // Load full case data if not already loaded
      if (content && content.textContent === 'Laden...') {
        const c = state.activeCase;
        if (c) {
          renderFullCaseContent(c, content);
        } else {
          content.innerHTML = '<p style="color:var(--ink-muted);">Geen case data beschikbaar.</p>';
        }
      }
    }
  };

  function renderFullCaseContent(c, container) {
    const ext = c.extraction || {};
    const tags = ext.tags || [];
    const completeness = c.completeness || {};
    const fields = completeness.results || [];

    // Group tags by category
    const tagsByCategory = {};
    for (const t of tags) {
      (tagsByCategory[t.category] ||= []).push(t);
    }

    let html = `
      <div style="display:grid;gap:16px;">
        <!-- Basis gegevens -->
        <div>
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--ink);">Basis gegevens</h4>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;font-size:12.5px;">
            <div><span style="color:var(--ink-muted);">Referentie:</span> <strong>${escape(c.ref_code || '-')}</strong></div>
            <div><span style="color:var(--ink-muted);">Kanaal:</span> <strong>${escape(c.channel || '-')}</strong></div>
            <div><span style="color:var(--ink-muted);">Patiënt:</span> <strong>${escape(c.patient_initials || ext.patient_initials || '-')}</strong></div>
            <div><span style="color:var(--ink-muted);">Leeftijd:</span> <strong>${c.patient_age || ext.patient_age || '-'}</strong></div>
            <div><span style="color:var(--ink-muted);">Postcode:</span> <strong>${escape(ext.postcode || '-')}</strong></div>
            <div><span style="color:var(--ink-muted);">Verzekeraar:</span> <strong>${escape(ext.insurer_name || '-')}</strong></div>
            <div><span style="color:var(--ink-muted);">AGB verwijzer:</span> <strong>${escape(ext.agb_referrer || '-')}</strong></div>
            <div><span style="color:var(--ink-muted);">Datum brief:</span> <strong>${escape(ext.letter_date || '-')}</strong></div>
            <div><span style="color:var(--ink-muted);">Handtekening:</span> <strong>${ext.signature_present ? 'Ja' : 'Nee'}</strong></div>
            <div><span style="color:var(--ink-muted);">Ziekenhuis:</span> <strong>${ext.is_hospital_referral ? 'Ja' : 'Nee'}</strong></div>
          </div>
        </div>

        <!-- Hulpvraag -->
        ${ext.hulpvraag ? `
        <div>
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--ink);">Hulpvraag</h4>
          <p style="font-size:12.5px;line-height:1.6;padding:10px;background:var(--bg-card);border-radius:6px;border-left:3px solid var(--burgundy);">${escape(ext.hulpvraag)}</p>
        </div>
        ` : ''}

        <!-- DSM vermoeden -->
        ${ext.dsm_suspicion ? `
        <div>
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--ink);">DSM-5 vermoeden</h4>
          <p style="font-size:12.5px;">${escape(ext.dsm_suspicion)}</p>
        </div>
        ` : ''}

        <!-- Tags per categorie -->
        <div>
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--ink);">Geëxtraheerde tags (${tags.length})</h4>
          ${Object.keys(tagsByCategory).length > 0 ? Object.entries(tagsByCategory).map(([cat, items]) => `
            <div style="margin-bottom:10px;">
              <div style="font-size:11px;color:var(--ink-muted);margin-bottom:4px;text-transform:uppercase;">${escape(cat)}</div>
              <div style="display:flex;flex-wrap:wrap;gap:4px;">
                ${items.map(t => `<span class="tag" title="${escape(t.evidence || '')}">${escape(t.name)}</span>`).join('')}
              </div>
            </div>
          `).join('') : '<p style="font-size:12.5px;color:var(--ink-muted);">Geen tags geëxtraheerd.</p>'}
        </div>

        <!-- Volledigheidscheck -->
        ${fields.length > 0 ? `
        <div>
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--ink);">Volledigheidscheck</h4>
          <div style="display:flex;flex-wrap:wrap;gap:6px;font-size:12px;">
            ${fields.map(f => `
              <span style="padding:4px 8px;border-radius:4px;background:${f.found ? 'var(--green-soft)' : 'var(--amber-soft)'};color:${f.found ? 'var(--green)' : 'var(--amber)'};">
                ${f.found ? '✓' : '!'} ${escape(f.field)}
              </span>
            `).join('')}
          </div>
        </div>
        ` : ''}

        <!-- Ruwe tekst -->
        <div>
          <h4 style="font-size:13px;font-weight:600;margin-bottom:8px;color:var(--ink);">Originele verwijstekst</h4>
          <div style="font-size:12px;line-height:1.6;padding:12px;background:var(--bg-card);border-radius:6px;border:1px solid var(--rule);max-height:300px;overflow-y:auto;white-space:pre-wrap;font-family:'Geist Mono',monospace;">${escape(c.raw_text || 'Geen tekst beschikbaar.')}</div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  // ====== Screenteam: voorbereide vragen (CRUD via API) ======
  const Q_ICON_EDIT = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9.5 2l2.5 2.5L4.5 12l-3 .5.5-3z"/></svg>';
  const Q_ICON_DEL  = '<svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 4h8M5 4V2.5h4V4M4 4l.5 8h5L10 4"/></svg>';

  function questionActionsHtml() {
    return `
      <button class="q-icon-btn" data-action="edit" title="Bewerken">${Q_ICON_EDIT}</button>
      <button class="q-icon-btn" data-action="delete" title="Verwijderen">${Q_ICON_DEL}</button>`;
  }

  function buildAnswerBlockHtml(answer) {
    if (answer && String(answer).trim()) {
      return `<div class="qa-answer-inline" data-action="edit-answer" title="Klik om antwoord te bewerken">
        <span class="qa-answer-label">Antwoord cliënt</span>
        <div class="qa-answer-text">${escape(answer).replace(/\n/g, '<br>')}</div>
      </div>`;
    }
    return `<button class="add-answer-btn" data-action="edit-answer" type="button">
      <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M7 2v10M2 7h10"/></svg>
      Antwoord toevoegen
    </button>`;
  }

  function buildQuestionItem(q, position) {
    const item = document.createElement('div');
    item.className = 'question-item' + (q.origin === 'user' ? ' user-added' : '');
    item.dataset.qid = q.id;
    item.dataset.answer = q.answer || '';
    item.innerHTML = `
      <div class="question-num">${position}</div>
      <div class="question-text">${escape(q.text)}${q.source ? `<div class="source-tag">${escape(q.source)}</div>` : ''}${buildAnswerBlockHtml(q.answer)}</div>
      <div class="question-actions">${questionActionsHtml()}</div>`;
    return item;
  }

  function editAnswer(item) {
    if (item.classList.contains('editing') || item.classList.contains('editing-answer')) return;
    const textDiv = item.querySelector('.question-text');
    const existing = item.dataset.answer || '';
    item.classList.add('editing-answer');
    const oldBlock = textDiv.querySelector('.qa-answer-inline, .add-answer-btn');
    if (oldBlock) oldBlock.remove();
    const editRow = document.createElement('div');
    editRow.className = 'qa-edit-row';
    editRow.innerHTML = `
      <textarea class="qa-edit-input" rows="3" placeholder="Wat antwoordde de cliënt? (Cmd/Ctrl+Enter = opslaan, Esc = annuleren)">${escape(existing)}</textarea>
      <div class="qa-edit-actions">
        <button class="btn btn-primary btn-sm" data-action="save-answer" type="button">Opslaan</button>
        <button class="btn btn-ghost btn-sm" data-action="cancel-answer" type="button">Annuleer</button>
        ${existing ? '<button class="btn btn-ghost btn-sm" data-action="clear-answer" type="button" style="color:var(--red);">Wissen</button>' : ''}
      </div>`;
    textDiv.appendChild(editRow);
    const ta = editRow.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  function rebuildAnswerBlock(item, answer) {
    const textDiv = item.querySelector('.question-text');
    const editRow = textDiv.querySelector('.qa-edit-row');
    if (editRow) editRow.remove();
    const oldBlock = textDiv.querySelector('.qa-answer-inline, .add-answer-btn');
    if (oldBlock) oldBlock.remove();
    const tmp = document.createElement('div');
    tmp.innerHTML = buildAnswerBlockHtml(answer);
    while (tmp.firstChild) textDiv.appendChild(tmp.firstChild);
    item.dataset.answer = answer || '';
    item.classList.remove('editing-answer');
  }

  async function saveAnswerQuestion(item) {
    const ta = item.querySelector('textarea.qa-edit-input');
    if (!ta) return;
    const newAnswer = ta.value.trim();
    const qid = item.dataset.qid;
    if (!qid || !state.activeCaseId) { rebuildAnswerBlock(item, newAnswer); return; }
    try {
      const q = await api(`/api/cases/${state.activeCaseId}/questions/${qid}`, {
        method: 'PUT',
        body: { answer: newAnswer === '' ? null : newAnswer }
      });
      rebuildAnswerBlock(item, q.answer);
    } catch (e) { console.error(e); alert('Antwoord opslaan mislukt: ' + e.message); }
  }

  function cancelAnswerQuestion(item) {
    rebuildAnswerBlock(item, item.dataset.answer || '');
  }

  async function clearAnswerQuestion(item) {
    if (!confirm('Antwoord wissen?')) return;
    const qid = item.dataset.qid;
    if (!qid || !state.activeCaseId) { rebuildAnswerBlock(item, ''); return; }
    try {
      await api(`/api/cases/${state.activeCaseId}/questions/${qid}`, { method: 'PUT', body: { answer: null } });
      rebuildAnswerBlock(item, '');
    } catch (e) { console.error(e); alert('Wissen mislukt: ' + e.message); }
  }

  function renderEmptyState(list) {
    const empty = document.createElement('div');
    empty.className = 'q-empty';
    empty.style.cssText = 'padding:14px;text-align:center;color:var(--ink-muted);font-size:12.5px;';
    empty.textContent = 'Nog geen vragen voorbereid — voeg er een toe.';
    list.appendChild(empty);
  }

  function renderQuestionList(items) {
    const list = document.querySelector('#page-screen-case .question-list');
    if (!list) return;
    list.innerHTML = '';
    if (!items || items.length === 0) renderEmptyState(list);
    else items.forEach((q, i) => list.appendChild(buildQuestionItem(q, i + 1)));
    updateQuestionCount();
  }

  function renumberQuestions() {
    document.querySelectorAll('#page-screen-case .question-list .question-item').forEach((it, i) => {
      const num = it.querySelector('.question-num');
      if (num) num.textContent = i + 1;
    });
  }

  function updateQuestionCount() {
    const el = document.getElementById('qCount');
    if (!el) return;
    const n = document.querySelectorAll('#page-screen-case .question-list .question-item').length;
    el.textContent = `${n} ${n === 1 ? 'vraag' : 'vragen'} klaar voor het gesprek`;
  }

  function renderViewMode(item, text) {
    const textDiv = item.querySelector('.question-text');
    const sourceTag = textDiv.querySelector('.source-tag');
    textDiv.textContent = '';
    textDiv.appendChild(document.createTextNode(text + ' '));
    if (sourceTag) textDiv.appendChild(sourceTag);
    // Re-append the answer block (preserved through edit)
    const tmp = document.createElement('div');
    tmp.innerHTML = buildAnswerBlockHtml(item.dataset.answer || '');
    while (tmp.firstChild) textDiv.appendChild(tmp.firstChild);
    item.querySelector('.question-actions').innerHTML = questionActionsHtml();
    item.classList.remove('editing');
    delete item._origText;
  }

  function editQuestion(item) {
    if (item.classList.contains('editing')) return;
    const textDiv = item.querySelector('.question-text');
    const sourceTag = textDiv.querySelector('.source-tag');
    const txt = Array.from(textDiv.childNodes).filter(n => n.nodeType === Node.TEXT_NODE).map(n => n.nodeValue).join(' ').replace(/\s+/g, ' ').trim();
    item._origText = txt;
    item.classList.add('editing');
    textDiv.innerHTML = `<textarea class="q-edit-input" rows="2">${escape(txt)}</textarea>` + (sourceTag ? sourceTag.outerHTML : '');
    item.querySelector('.question-actions').innerHTML = `
      <button class="btn btn-primary btn-sm" data-action="save">Opslaan</button>
      <button class="btn btn-ghost btn-sm" data-action="cancel">Annuleren</button>`;
    const ta = textDiv.querySelector('textarea');
    ta.focus();
    ta.setSelectionRange(ta.value.length, ta.value.length);
  }

  async function saveEditQuestion(item) {
    const ta = item.querySelector('textarea.q-edit-input');
    if (!ta) return;
    const newText = ta.value.trim();
    if (!newText) return;
    const qid = item.dataset.qid;
    if (!qid || !state.activeCaseId) { renderViewMode(item, newText); return; }
    try {
      const q = await api(`/api/cases/${state.activeCaseId}/questions/${qid}`, { method: 'PUT', body: { text: newText } });
      renderViewMode(item, q.text);
    } catch (e) { console.error(e); alert('Opslaan mislukt: ' + e.message); }
  }

  function cancelEditQuestion(item) {
    renderViewMode(item, item._origText || '');
  }

  async function deleteQuestion(item) {
    if (!confirm('Vraag verwijderen?')) return;
    const qid = item.dataset.qid;
    if (qid && state.activeCaseId) {
      try { await api(`/api/cases/${state.activeCaseId}/questions/${qid}`, { method: 'DELETE' }); }
      catch (e) { console.error(e); alert('Verwijderen mislukt: ' + e.message); return; }
    }
    item.remove();
    renumberQuestions();
    updateQuestionCount();
    const list = document.querySelector('#page-screen-case .question-list');
    if (list && list.querySelectorAll('.question-item').length === 0) renderEmptyState(list);
  }

  async function addQuestion() {
    const input = document.getElementById('newQuestionInput');
    if (!input || !input.value.trim()) return;
    if (!state.activeCaseId) { alert('Geen actieve case geselecteerd.'); return; }
    const text = input.value.trim();
    try {
      const q = await api(`/api/cases/${state.activeCaseId}/questions`, { method: 'POST', body: { text } });
      const list = document.querySelector('#page-screen-case .question-list');
      const empty = list.querySelector('.q-empty');
      if (empty) empty.remove();
      const pos = list.querySelectorAll('.question-item').length + 1;
      list.appendChild(buildQuestionItem(q, pos));
      input.value = '';
      input.focus();
      updateQuestionCount();
    } catch (e) { console.error(e); alert('Toevoegen mislukt: ' + e.message); }
  }
  window.addQuestion = addQuestion;

  function printBelkaartje() {
    const id = state.activeCaseId || +localStorage.getItem('forta.activeCase');
    if (!id) { alert('Geen actieve case geselecteerd.'); return; }
    window.open(`/api/cases/${id}/belkaartje`, '_blank', 'noopener,width=900,height=1100');
  }
  window.printBelkaartje = printBelkaartje;

  function installQuestionHandlers() {
    const qList = document.querySelector('#page-screen-case .question-list');
    if (qList && !qList._fortaInstalled) {
      qList._fortaInstalled = true;
      qList.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const item = btn.closest('.question-item');
        if (!item) return;
        const action = btn.dataset.action;
        if (action === 'edit') editQuestion(item);
        else if (action === 'delete') deleteQuestion(item);
        else if (action === 'save') saveEditQuestion(item);
        else if (action === 'cancel') cancelEditQuestion(item);
        else if (action === 'edit-answer') editAnswer(item);
        else if (action === 'save-answer') saveAnswerQuestion(item);
        else if (action === 'cancel-answer') cancelAnswerQuestion(item);
        else if (action === 'clear-answer') clearAnswerQuestion(item);
      });
      qList.addEventListener('keydown', (e) => {
        const cls = e.target.classList;
        if (!cls) return;
        const item = e.target.closest('.question-item');
        if (!item) return;
        if (cls.contains('q-edit-input')) {
          if (e.key === 'Escape') { e.preventDefault(); cancelEditQuestion(item); }
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveEditQuestion(item); }
        } else if (cls.contains('qa-edit-input')) {
          if (e.key === 'Escape') { e.preventDefault(); cancelAnswerQuestion(item); }
          else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); saveAnswerQuestion(item); }
        }
      });
    }
    const qInput = document.getElementById('newQuestionInput');
    if (qInput && !qInput._fortaInstalled) {
      qInput._fortaInstalled = true;
      qInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addQuestion(); } });
    }
  }

  // ====== Beheer: labels ======
  async function renderLabels({ refetch = true } = {}) {
    const grid = document.getElementById('labelGrid');
    if (!grid) return;
    if (refetch || !state.labelsCache) {
      try { state.labelsCache = await api('/api/labels'); } catch { return; }
    }
    const all = state.labelsCache;

    const f = state.labelsFilter;
    const search = (f.search || '').toLowerCase().trim();
    const labels = all.filter(l => {
      if (f.status !== 'all' && l.status !== f.status) return false;
      if (search) {
        const hay = `${l.name} ${l.code} ${l.description || ''}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      return true;
    });

    // Update filter-button label
    const btn = document.getElementById('labelStatusFilter');
    if (btn) btn.textContent = `Filter: ${f.status === 'all' ? 'alle' : f.status}`;

    grid.innerHTML = '';
    if (labels.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:30px;text-align:center;color:var(--ink-muted);font-size:13px;grid-column:1 / -1;';
      empty.textContent = all.length === 0 ? 'Nog geen labels — voeg er een toe.' : 'Geen labels in deze filter.';
      grid.appendChild(empty);
      return;
    }
    for (const l of labels) {
      const tagsByRole = (role) => l.tags.filter(t => t.role === role).map(t => `<span class="tag">${escape(t.name)}</span>`).join('');
      const card = document.createElement('div');
      card.className = 'label-card';
      card.innerHTML = `
        <div class="label-card-head">
          <div><h3>${escape(l.name)}</h3><div class="label-code">${escape(l.code)}</div></div>
          <div style="display:flex;align-items:center;gap:8px;">
            <button class="btn btn-secondary btn-sm label-edit-btn" data-id="${l.id}" title="Bewerken" style="padding:4px 8px;">✎</button>
            <span class="${l.status === 'actief' ? 'status-active' : 'status-inactive'}">${escape(l.status)}</span>
          </div>
        </div>
        <p style="font-size:12.5px;color:var(--ink-muted);margin:8px 0 12px;">${escape(l.description || '')}</p>
        <div class="label-section"><h5><span>Doelgroep</span></h5><div class="tag-list">${tagsByRole('doelgroep') || '<span class="tag tag-neutral">—</span>'}</div></div>
        <div class="label-section"><h5><span>Inclusie (verplicht)</span></h5><div class="tag-list">${tagsByRole('incl_required') || '<span class="tag tag-neutral">—</span>'}</div></div>
        <div class="label-section"><h5><span>Inclusie (gewenst)</span></h5><div class="tag-list">${tagsByRole('incl_desired') || '<span class="tag tag-neutral">—</span>'}</div></div>
        <div class="label-section"><h5><span>Exclusie (hard)</span></h5><div class="tag-list">${tagsByRole('excl_hard') || '<span class="tag tag-neutral">—</span>'}</div></div>
        <div class="label-section"><h5><span>Locaties</span></h5>
          <div style="display:flex;flex-direction:column;gap:6px;font-size:12.5px;">
            ${l.locations.map(loc => `<div style="display:flex;justify-content:space-between;padding:6px 8px;background:var(--bg-deep);border-radius:5px;">
              <span>${escape(loc.name)} ${loc.is_online ? '· online' : (loc.postcode ? `· ${escape(loc.postcode)}`: '')}</span>
              <span style="color:var(--ink-muted);">cap ${loc.capacity_per_month} · bezet ${Math.round(loc.current_load_pct)}% · wacht ${loc.wachttijd_dagen ?? '—'} d</span>
            </div>`).join('')}
          </div>
        </div>
        <div class="label-section"><h5><span>Behandelvorm</span></h5><div class="tag-list"><span class="tag">${escape(l.treatment_form)}</span></div></div>`;

      // Add edit button handler
      card.querySelector('.label-edit-btn').onclick = () => openLabelEditModal(l);
      grid.appendChild(card);
    }
  }

  // ====== Label Edit Modal ======
  function openLabelEditModal(label) {
    // Remove existing modal if any
    document.getElementById('labelEditModal')?.remove();

    const modal = document.createElement('div');
    modal.id = 'labelEditModal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(20,16,14,0.55);z-index:1000;display:flex;align-items:center;justify-content:center;';
    modal.innerHTML = `
      <div style="background:var(--bg-card);width:500px;max-width:92vw;border-radius:10px;padding:24px;border:1px solid var(--rule);max-height:90vh;overflow-y:auto;">
        <h3 class="serif" style="font-size:18px;font-weight:500;margin-bottom:16px;">Label bewerken</h3>

        <div style="display:flex;flex-direction:column;gap:14px;">
          <div>
            <label style="font-size:12px;font-weight:500;color:var(--ink-muted);display:block;margin-bottom:4px;">Code</label>
            <input type="text" id="labelEditCode" value="${escape(label.code)}" disabled style="width:100%;padding:8px 10px;border:1px solid var(--rule);border-radius:5px;font-size:13px;background:var(--bg-deep);color:var(--ink-muted);">
          </div>

          <div>
            <label style="font-size:12px;font-weight:500;color:var(--ink-muted);display:block;margin-bottom:4px;">Naam</label>
            <input type="text" id="labelEditName" value="${escape(label.name)}" style="width:100%;padding:8px 10px;border:1px solid var(--rule);border-radius:5px;font-size:13px;">
          </div>

          <div>
            <label style="font-size:12px;font-weight:500;color:var(--ink-muted);display:block;margin-bottom:4px;">Beschrijving</label>
            <textarea id="labelEditDesc" rows="3" style="width:100%;padding:8px 10px;border:1px solid var(--rule);border-radius:5px;font-size:13px;resize:vertical;">${escape(label.description || '')}</textarea>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--ink-muted);display:block;margin-bottom:4px;">Leeftijd min</label>
              <input type="number" id="labelEditAgeMin" value="${label.age_min ?? 18}" min="0" max="120" style="width:100%;padding:8px 10px;border:1px solid var(--rule);border-radius:5px;font-size:13px;">
            </div>
            <div>
              <label style="font-size:12px;font-weight:500;color:var(--ink-muted);display:block;margin-bottom:4px;">Leeftijd max</label>
              <input type="number" id="labelEditAgeMax" value="${label.age_max ?? 99}" min="0" max="120" style="width:100%;padding:8px 10px;border:1px solid var(--rule);border-radius:5px;font-size:13px;">
            </div>
          </div>

          <div>
            <label style="font-size:12px;font-weight:500;color:var(--ink-muted);display:block;margin-bottom:4px;">Behandelvorm</label>
            <select id="labelEditTreatment" style="width:100%;padding:8px 10px;border:1px solid var(--rule);border-radius:5px;font-size:13px;">
              <option value="individueel" ${label.treatment_form === 'individueel' ? 'selected' : ''}>Individueel</option>
              <option value="groep" ${label.treatment_form === 'groep' ? 'selected' : ''}>Groep</option>
              <option value="beide" ${label.treatment_form === 'beide' ? 'selected' : ''}>Beide</option>
            </select>
          </div>

          <div>
            <label style="font-size:12px;font-weight:500;color:var(--ink-muted);display:block;margin-bottom:4px;">Status</label>
            <select id="labelEditStatus" style="width:100%;padding:8px 10px;border:1px solid var(--rule);border-radius:5px;font-size:13px;">
              <option value="actief" ${label.status === 'actief' ? 'selected' : ''}>Actief</option>
              <option value="inactief" ${label.status === 'inactief' ? 'selected' : ''}>Inactief</option>
              <option value="concept" ${label.status === 'concept' ? 'selected' : ''}>Concept</option>
            </select>
          </div>
        </div>

        <div id="labelEditError" style="color:var(--red);font-size:12px;margin-top:12px;display:none;"></div>

        <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;">
          <button type="button" class="btn btn-secondary" id="labelEditCancel">Annuleren</button>
          <button type="button" class="btn btn-primary" id="labelEditSave">Opslaan</button>
        </div>
      </div>
    `;

    document.body.appendChild(modal);

    // Close on backdrop click
    modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    document.getElementById('labelEditCancel').onclick = () => modal.remove();

    // Save handler
    document.getElementById('labelEditSave').onclick = async () => {
      const errorEl = document.getElementById('labelEditError');
      const data = {
        name: document.getElementById('labelEditName').value.trim(),
        description: document.getElementById('labelEditDesc').value.trim(),
        age_min: parseInt(document.getElementById('labelEditAgeMin').value) || 18,
        age_max: parseInt(document.getElementById('labelEditAgeMax').value) || 99,
        treatment_form: document.getElementById('labelEditTreatment').value,
        status: document.getElementById('labelEditStatus').value
      };

      if (!data.name) {
        errorEl.textContent = 'Naam is verplicht.';
        errorEl.style.display = 'block';
        return;
      }

      try {
        await api(`/api/labels/${label.id}`, { method: 'PUT', body: data });
        modal.remove();
        state.labelsCache = null;
        renderLabels();
      } catch (e) {
        errorEl.textContent = 'Opslaan mislukt: ' + e.message;
        errorEl.style.display = 'block';
      }
    };
  }

  // ====== Beheer: tags ======
  async function renderTags({ refetch = true } = {}) {
    const grid = document.getElementById('taxonomyGrid');
    if (!grid) return;
    if (refetch || !state.tagsCache) {
      try { state.tagsCache = await api('/api/tags'); } catch { return; }
    }
    const tags = state.tagsCache;

    const search = (state.tagsFilter.search || '').toLowerCase().trim();
    const matches = t => {
      if (!search) return true;
      if (t.name.toLowerCase().includes(search)) return true;
      return (t.synonyms || []).some(s => String(s).toLowerCase().includes(search));
    };
    const byCategory = {};
    for (const t of tags) {
      if (!matches(t)) continue;
      (byCategory[t.category] ||= []).push(t);
    }

    grid.innerHTML = '';
    if (Object.keys(byCategory).length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = 'padding:30px;text-align:center;color:var(--ink-muted);font-size:13px;grid-column:1 / -1;';
      empty.textContent = 'Geen tags gevonden voor deze zoekopdracht.';
      grid.appendChild(empty);
      return;
    }
    for (const [cat, items] of Object.entries(byCategory)) {
      const card = document.createElement('div');
      card.className = 'taxonomy-card';
      card.innerHTML = `<div class="taxonomy-card-head"><h4>${escape(cat)}</h4><span class="count">${items.length} tags</span></div>
        <p class="desc">${escape({ klachtprofiel:'DSM-5 hoofdcategorieën.', doelgroep:'Leeftijds- en levensfase-categorieën.', comorbiditeit:'Bijkomende klachtenpatronen.', exclusie:'Hard- en zacht uitsluitende kenmerken.', procedureel:'Diagnostiek of behandeling.', zorgtype:'Vorm van zorg (online, individueel, …).' }[cat] || '')}</p>
        ${items.map(t => `<div class="tag-row"><div><div class="tag-name">${escape(t.name)}</div><div class="tag-syn">${escape(t.synonyms.join(', '))}</div></div><div class="tag-meta">×${t.weight}</div></div>`).join('')}`;
      grid.appendChild(card);
    }
  }

  // ====== Beheer: logica (modus + voorkeuren) ======
  async function renderLogica() {
    let modus, prefs;
    try {
      modus = await api('/api/modus');
      prefs = await api('/api/voorkeuren');
    } catch { return; }
    state.status.modus = modus.modus;
    document.querySelectorAll('#modusGrid .modus-card').forEach(card => {
      card.classList.toggle('active', card.dataset.modus === modus.modus);
      card.onclick = async () => {
        const m = card.dataset.modus;
        await api('/api/modus', { method: 'PUT', body: { modus: m } });
        state.status.modus = m;
        document.querySelectorAll('#modusGrid .modus-card').forEach(c => c.classList.toggle('active', c.dataset.modus === m));
      };
    });
    const tbody = document.querySelector('#voorkeurTable tbody');
    if (tbody) {
      tbody.innerHTML = prefs.length === 0
        ? `<tr><td colspan="5" style="text-align:center;color:var(--ink-muted);padding:24px;">Geen actieve voorkeuren.</td></tr>`
        : prefs.map(p => `<tr>
            <td>${escape(p.label_name)}${p.location_name ? `<br><span style="font-size:11px;color:var(--ink-muted);font-family:'Geist Mono',monospace;">@ ${escape(p.location_name)}</span>` : ''}</td>
            <td><span class="voorkeur-boost">${fmtScore(p.boost)}</span></td>
            <td class="voorkeur-reden">${escape(p.reason)}</td>
            <td class="voorkeur-vervaldatum">${escape(p.expires_at)}</td>
            <td class="row-actions"><a data-del="${p.id}" style="cursor:pointer;">Stop nu</a></td>
          </tr>`).join('');
      tbody.querySelectorAll('a[data-del]').forEach(a => {
        a.onclick = async () => {
          if (!confirm('Voorkeur intrekken?')) return;
          await fetch('/api/voorkeuren/' + a.dataset.del, { method: 'DELETE' });
          renderLogica();
        };
      });
    }
  }

  // ====== Goto wrapper ======
  const origGoto = window.goto;
  // Telt hoe vaak we naar werklijst zijn genavigeerd. De eerste keer is altijd
  // de initiële laad-aanroep; daar wordt de chat al door installGuidedChat()
  // geïnitialiseerd, dus moeten we niet óók in de goto-wrapper resetten.
  let gcWerklijstVisits = 0;
  window.goto = function(page) {
    origGoto(page);
    // Trigger page-specific data loading
    queueMicrotask(() => {
      if (page === 'werklijst') {
        renderWerklijst();
        gcWerklijstVisits++;
        // Pas terugkomende bezoeken (2e+) krijgen een verse welkom-staat,
        // tenzij de gebruiker het paneel bewust heeft weggeklikt.
        if (gcWerklijstVisits > 1) {
          const panel = document.getElementById('guidedChat');
          let dismissed = false;
          try { dismissed = localStorage.getItem(GC_KEY) === '1'; } catch {}
          if (panel && !dismissed && panel.style.display !== 'none') {
            gcWelcome();
          }
        }
      }
      else if (page === 'check')      renderCheck();
      else if (page === 'matching')   renderMatching();
      else if (page === 'feedback')   renderFeedbackPage();
      else if (page === 'decision')   renderDecision();
      else if (page === 'screen-list') renderScreenList();
      else if (page === 'screen-case') renderScreenCase();
      else if (page === 'screen-matching') renderScreenMatching();
      else if (page === 'overzicht')  renderOverzicht();
      else if (page === 'recap')      renderRecap();
      else if (page === 'knockout')   renderKnockout();
      else if (page === 'twijfel')    renderTwijfel();
      else if (page === 'besluit')    renderBesluit();
      else if (page === 'labels')     renderLabels();
      else if (page === 'tags')       renderTags();
      else if (page === 'logica')     renderLogica();
    });
  };

  // ====== Guided chat (secretariaat entry) ======
  // Korte conversatie die nieuwe gebruikers in twee paden duwt:
  //   1) Verwijzing aanleveren  → PDF kiezen of casus inspreken/typen
  //   2) Aanbod verkennen        → labels-overzicht, dan optioneel match starten
  // Bestaande modals/upload-handlers blijven actief; de chat opent ze.
  const GC_KEY = 'forta.guidedChat.dismissed';

  function gcBody() { return document.getElementById('guidedChatBody'); }

  function gcAgent(html, { delay = 350, scroll = true } = {}) {
    return new Promise(resolve => {
      const body = gcBody();
      if (!body) return resolve();
      // typing indicator
      const t = document.createElement('div');
      t.className = 'chat-msg agent';
      t.innerHTML = '<div class="avatar-mini">F</div><div class="chat-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div>';
      body.appendChild(t);
      if (scroll) body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
      setTimeout(() => {
        t.remove();
        const m = document.createElement('div');
        m.className = 'chat-msg agent';
        m.innerHTML = `<div class="avatar-mini">F</div><div class="chat-bubble">${html}</div>`;
        body.appendChild(m);
        if (scroll) body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
        resolve();
      }, delay);
    });
  }

  function gcUser(text) {
    const body = gcBody();
    if (!body) return;
    const m = document.createElement('div');
    m.className = 'chat-msg user';
    m.innerHTML = `<div class="chat-bubble">${escape(text)}</div><div class="avatar-mini">M</div>`;
    body.appendChild(m);
    body.scrollTop = body.scrollHeight;
  }

  function gcOptions(opts, { rich = false, container = null } = {}) {
    const body = gcBody();
    if (!body) return;
    const wrap = document.createElement('div');
    wrap.className = 'chat-options' + (rich ? ' cards' : '');
    opts.forEach(o => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'chat-option' + (o.primary ? ' primary' : '') + (rich ? ' chat-option-rich' : '');
      if (rich) {
        btn.innerHTML = `
          <span class="opt-icon">${o.icon || '→'}</span>
          <span class="opt-text"><strong>${escape(o.title)}</strong><span>${escape(o.subtitle || '')}</span></span>
          <span class="opt-arrow">→</span>`;
      } else {
        btn.innerHTML = (o.icon ? `<span class="opt-icon">${o.icon}</span>` : '') + escape(o.label);
      }
      btn.onclick = () => {
        gcUser(o.label || o.title);
        wrap.remove();
        try { o.onSelect && o.onSelect(); } catch (e) { console.error(e); }
      };
      wrap.appendChild(btn);
    });
    (container || body).appendChild(wrap);
    body.scrollTop = body.scrollHeight;
  }

  function gcClear() {
    const body = gcBody();
    if (body) body.innerHTML = '';
  }

  async function gcWelcome() {
    gcClear();
    await gcAgent('Goedemorgen Maria. Wat wil je doen — een nieuwe verwijzing erin krijgen, of eerst even kijken wat we als aanbod hebben?');
    gcOptions([
      {
        title: 'Verwijzing aanleveren',
        subtitle: 'PDF uploaden of casus typen / inspreken',
        icon: '↑',
        primary: true,
        label: 'Verwijzing aanleveren',
        onSelect: gcAskUploadMode
      },
      {
        title: 'Aanbod verkennen',
        subtitle: 'Bekijk welke labels & locaties actief zijn',
        icon: '◎',
        label: 'Aanbod verkennen',
        onSelect: gcExplore
      }
    ], { rich: true });
  }

  async function gcAskUploadMode() {
    await gcAgent('Top. Heb je een PDF (Zorgdomein / ZIVVER), of wil je de aanvraag zelf typen of inspreken?');
    gcOptions([
      {
        title: 'PDF kiezen',
        subtitle: 'Eén of meerdere verwijsbrieven — sleep of klik',
        icon: '⎙',
        primary: true,
        label: 'PDF kiezen',
        onSelect: () => gcAskCompleteCheck('pdf')
      },
      {
        title: 'Casus typen of inspreken',
        subtitle: 'Eigen woorden — Match transcribeert + tag-extractie',
        icon: '◉',
        label: 'Casus typen of inspreken',
        onSelect: () => gcAskCompleteCheck('intern')
      },
      {
        title: '← Terug',
        subtitle: 'Naar begin van het gesprek',
        icon: '↺',
        label: '← Terug',
        onSelect: gcWelcome
      }
    ], { rich: true });
  }

  // Bepaalt of we ná verwerking eerst de volledigheidscheck in de chat tonen
  // (waarna de gebruiker zelf bepaalt of we gaan matchen). Default: niet checken.
  let gcCompleteCheckPref = 'nee';

  async function gcAskCompleteCheck(mode) {
    await gcAgent('Volledigheidscheck eerst doen? Dan loop ik de brief langs alle verplichte velden voordat ik ga matchen.');
    const proceed = (pref) => {
      gcCompleteCheckPref = pref;
      if (mode === 'pdf') gcTriggerPdf();
      else gcTriggerIntern();
    };
    gcOptions([
      { label: 'Ja, eerst checken', icon: '✓', primary: true, onSelect: () => proceed('ja') },
      { label: 'Nee, direct matchen', icon: '☰', onSelect: () => proceed('nee') },
      { label: '← Terug', icon: '↺', onSelect: gcAskUploadMode }
    ]);
  }

  async function gcTriggerPdf() {
    await gcAgent('Kies een of meerdere PDF-bestanden. Bij één brief ga je direct door naar de volledigheidscheck; bij meerdere komen ze in de werklijst eronder.');
    const input = document.getElementById('bestandInput');
    if (input) input.click();
    gcOptions([
      { label: 'Toch zelf typen / inspreken', onSelect: gcTriggerIntern },
      { label: '← Terug', onSelect: gcAskUploadMode }
    ]);
  }

  async function gcTriggerIntern() {
    await gcAgent('Opent het scherm waarin je de aanvraag intypt of inspreekt. Zodra je <em>Start verwerking</em> kiest, draai ik extractie + check en breng ik je naar de volledigheidscheck.');
    if (typeof openInternModal === 'function') openInternModal();
    gcOptions([
      { label: 'Toch een PDF kiezen', onSelect: gcTriggerPdf },
      { label: '← Terug', onSelect: gcAskUploadMode }
    ]);
  }

  // ---- Verkennend gesprek: vrije vraag → live tag-extractie + match-suggesties ----
  // We bouwen een lopende tekst op die bij elke beurt opnieuw door /api/explore
  // gaat. Zo zien gebruikers direct hoe extra context (leeftijd, postcode,
  // comorbiditeit) de matches verschuift.
  let gcExploreText = '';
  let gcExploreLast = null;
  let gcPrevLive = null;

  async function gcExplore() {
    gcExploreText = '';
    gcExploreLast = null;
    gcPrevLive = null;
    await gcAgent('Vertel waar het over gaat — wie is de cliënt, wat is de hulpvraag? Je kunt typen óf je verhaal inspreken via het microfoon-icoon. Bij elke aanvulling laat ik zien hoeveel labels nog passen.');
    gcAskMore('Bijv. "Vrouw 34 jr uit Utrecht, ADHD-vermoeden, geen psychose"');
  }

  function gcAskMore(placeholder) {
    const body = gcBody();
    if (!body) return;
    const wrap = document.createElement('div');
    wrap.className = 'gc-input-area';
    wrap.innerHTML = `
      <textarea rows="2" placeholder="${escape(placeholder || 'Vul aan — bv. comorbiditeit, postcode, verzekeraar, voorkeur online…')}"></textarea>
      <button type="button" class="gc-mic" title="Opname starten">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <rect x="9" y="3" width="6" height="12" rx="3"/>
          <path d="M5 11a7 7 0 0 0 14 0"/>
          <path d="M12 18v3M9 21h6"/>
        </svg>
      </button>
      <button type="button" class="gc-send" title="Versturen">→</button>`;
    const ta = wrap.querySelector('textarea');
    const micBtn = wrap.querySelector('.gc-mic');
    const sendBtn = wrap.querySelector('.gc-send');
    const send = () => {
      const txt = ta.value.trim();
      if (txt.length < 3) return;
      wrap.remove();
      gcExploreSubmit(txt);
    };
    sendBtn.onclick = send;
    ta.addEventListener('keydown', e => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
    });
    ta.addEventListener('input', () => {
      ta.style.height = 'auto';
      ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
    });

    // Opname-flow met live transcriptie via Web Speech API. Voegt transcriptie
    // toe achter wat de gebruiker al getypt heeft, zodat opname en typen kunnen
    // worden gemixt binnen één bericht.
    let gcSession = null;
    let originalPlaceholder = ta.placeholder;
    let existingText = '';
    let timerId = null;
    let seconds = 0;
    const updateTimer = () => {
      const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');
      micBtn.title = `Opnemen ${mm}:${ss} — klik om te stoppen`;
      micBtn.setAttribute('data-timer', `${mm}:${ss}`);
    };
    micBtn.onclick = async () => {
      if (gcSession && gcSession.getState() === 'recording') {
        gcSession.stop();
        return;
      }

      existingText = ta.value.trim();

      gcSession = createRecordingSession({
        lang: 'nl-NL',
        onTranscript: (text) => {
          console.log('[Voice] onTranscript:', text);
          ta.value = existingText ? existingText + ' ' + text : text;
          ta.style.height = 'auto';
          ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
        },
        onInterim: (text) => {
          console.log('[Voice] onInterim:', text);
          ta.value = existingText ? existingText + ' ' + text : text;
          ta.style.height = 'auto';
          ta.style.height = Math.min(140, ta.scrollHeight) + 'px';
        },
        onError: (type, err) => {
          ta.placeholder = 'Microfoon niet beschikbaar — typ je vraag of geef toegang in de browser.';
          console.error('Recording error:', type, err);
        },
        onStart: () => {
          seconds = 0;
          updateTimer();
          timerId = setInterval(() => { seconds++; updateTimer(); }, 1000);
          micBtn.classList.add('recording');
          micBtn.title = speechSupported ? 'Live transcriptie — klik om te stoppen' : 'Opname loopt — klik om te stoppen';
          ta.placeholder = speechSupported ? 'Spreek nu…' : originalPlaceholder;
        },
        onStop: ({ transcript, speechSupported: supported }) => {
          console.log('[Voice] onStop called:', { transcript, supported, taValue: ta.value });
          if (timerId) { clearInterval(timerId); timerId = null; }
          micBtn.classList.remove('recording');
          micBtn.removeAttribute('data-timer');
          ta.placeholder = originalPlaceholder;

          // Auto-submit als er tekst in de textarea staat (ongeacht of transcript is gevuld)
          const txt = ta.value.trim();
          console.log('[Voice] textarea value:', txt, 'length:', txt.length);
          if (txt.length >= 3) {
            console.log('[Voice] Auto-submitting...');
            micBtn.title = 'Transcriptie verzonden';
            setTimeout(() => send(), 300);
          } else if (!supported) {
            micBtn.title = 'Geen live transcriptie — gebruik Chrome/Edge voor spraakherkenning';
            setTimeout(() => ta.focus(), 30);
          } else {
            micBtn.title = 'Geen spraak gedetecteerd';
            setTimeout(() => ta.focus(), 30);
          }
        }
      });

      const started = await gcSession.start();
      if (!started) {
        gcSession = null;
      }
    };

    body.appendChild(wrap);
    const hint = document.createElement('div');
    hint.className = 'gc-input-hint';
    hint.textContent = 'Enter verzendt · Shift+Enter voor nieuwe regel · klik op mic om te spreken';
    body.appendChild(hint);
    body.scrollTop = body.scrollHeight;
    setTimeout(() => ta.focus(), 50);
  }

  async function gcExploreSubmit(text) {
    gcUser(text);
    // Verwijder eerdere input-hint (de laatste hint hoort bij het input-veld dat we net verwijderden)
    const body = gcBody();
    const oldHints = body?.querySelectorAll('.gc-input-hint');
    if (oldHints && oldHints.length) oldHints[oldHints.length - 1].remove();

    gcExploreText = gcExploreText ? `${gcExploreText}\n\n${text}` : text;

    // typing
    const t = document.createElement('div');
    t.className = 'chat-msg agent';
    t.innerHTML = '<div class="avatar-mini">F</div><div class="chat-bubble"><div class="chat-typing"><span></span><span></span><span></span></div></div>';
    body.appendChild(t);
    body.scrollTop = body.scrollHeight;

    let data;
    try {
      data = await api('/api/explore', { method: 'POST', body: { text: gcExploreText } });
    } catch (e) {
      t.remove();
      await gcAgent(`Iets ging mis bij het zoeken naar matches: ${escape(e.message)}`);
      gcOptions([
        { label: 'Opnieuw proberen', primary: true, onSelect: () => gcAskMore() },
        { label: '← Terug', onSelect: gcWelcome }
      ]);
      return;
    }
    t.remove();
    gcExploreLast = data;
    await gcRenderMatchReply(data, false);
  }

  async function gcRenderMatchReply(data, isFullList) {
    const body = gcBody();
    const tags = data.tags || [];
    const all = data.all || [];
    const live = all.filter(o => !o.knockedOut);
    const ko = all.length - live.length;
    const prevLive = gcPrevLive;
    gcPrevLive = live.length;

    if (isFullList) {
      // Definitief resultaat: tags + ranked list + voorstel om aanvraag te maken
      let intro = `<strong>Resultaat tot nu toe</strong> — ${live.length} ${live.length === 1 ? 'label past' : 'labels passen'} bij wat je gedeeld hebt${ko ? ` (${ko} knock-outs).` : '.'}`;
      if (tags.length) {
        intro += `<div class="gc-tags">${tags.slice(0, 10).map(tg => `<span class="gc-tag${tg.category === 'exclusie' ? ' excl' : ''}">${escape(tg.name)}</span>`).join('')}${tags.length > 10 ? `<span class="gc-tag">+${tags.length - 10}</span>` : ''}</div>`;
      }
      await gcAgent(intro);

      if (live.length === 0) {
        await gcAgent('Geen enkele live optie. Voeg iets toe of laat een knock-out vallen — bijv. exclusiecriterium dat hier niet speelt.');
        gcOptions([
          { label: 'Iets toevoegen / aanpassen', primary: true, onSelect: () => gcAskMore() },
          { label: '← Terug naar begin', onSelect: gcWelcome }
        ]);
        return;
      }

      const list = document.createElement('div');
      list.className = 'gc-match-list';
      all.forEach((o, i) => {
        const card = document.createElement('div');
        card.className = 'gc-match-mini' + (o.kind === 'sociaal_domein' ? ' kind-sociaal-domein' : '') + (o.knockedOut ? ' knocked' : '');
        const loc = (o.location_name || '') + (o.is_online ? ' · online' : '') + (o.wachttijd_dagen != null ? ` · ${o.wachttijd_dagen} dgn wachttijd` : '');
        card.innerHTML = `
          <div>
            <div class="gc-mm-name">${i + 1}. ${escape(o.label_name)}</div>
            <div class="gc-mm-loc">${escape(loc)}</div>
          </div>
          <div class="gc-mm-score">${o.knockedOut ? 'knock-out' : (o.totalScore > 0 ? '+' : '') + o.totalScore}</div>`;
        list.appendChild(card);
      });
      body.appendChild(list);
      body.scrollTop = body.scrollHeight;

      await gcAgent('Wil je hier een echte aanvraag van maken — dan zet ik je verkennende tekst klaar in het invoerscherm, klaar om door te zetten naar de volledigheidscheck.');
      gcOptions([
        { title: 'Ja, zet aanvraag klaar', subtitle: 'Open het invoerscherm met deze tekst alvast ingevuld', icon: '↑', primary: true, label: 'Ja, zet aanvraag klaar', onSelect: gcExploreToIntern },
        { title: 'Verder verfijnen', subtitle: 'Voeg nog iets toe en herzie de lijst', icon: '◐', label: 'Verder verfijnen', onSelect: () => gcAskMore() },
        { title: '← Terug naar begin', subtitle: 'Naar het welkomstgesprek', icon: '↺', label: '← Terug naar begin', onSelect: gcWelcome }
      ], { rich: true });
      return;
    }

    // Trechter-feedback: aantal + tags + de top-resultaten inline (klikbaar).
    // Iedere beurt zien we nu de top-matches; klikken opent een matchoverzicht
    // direct onder die kaart waar je de info kunt nalopen en eventueel een
    // echte aanvraag van kunt maken. De dialoog loopt eronder gewoon door.
    let line;
    if (all.length === 0) {
      line = `Geen labels beoordeeld. Probeer iets concreters in je vraag.`;
    } else if (live.length === 0) {
      line = `Op dit moment <strong>0 labels in scope</strong> — er sluiten te veel knock-outs uit. Misschien is er ruimte als je een exclusie nuanceert.`;
    } else {
      const trend = prevLive == null
        ? ''
        : (live.length < prevLive
            ? ` <em style="color:var(--green);">↓ van ${prevLive} naar ${live.length}</em>`
            : live.length > prevLive
              ? ` <em style="color:var(--amber);">↑ van ${prevLive} naar ${live.length}</em>`
              : ` <em style="color:var(--ink-muted);">(onveranderd)</em>`);
      line = `<strong>${live.length} ${live.length === 1 ? 'label past' : 'labels passen'}</strong> nog bij wat je tot nu toe deelt${trend}.${ko ? ` <span style="color:var(--ink-muted);">${ko} viel af op een knock-out.</span>` : ''}`;
    }
    if (tags.length) {
      line += `<div class="gc-tags">${tags.slice(0, 8).map(tg => `<span class="gc-tag${tg.category === 'exclusie' ? ' excl' : ''}">${escape(tg.name)}</span>`).join('')}${tags.length > 8 ? `<span class="gc-tag">+${tags.length - 8}</span>` : ''}</div>`;
    }
    await gcAgent(line);

    // Volledige resultatenlijst (zelfde Forta / Alternatieven stack als bij
    // de echte matching-conversatie). Cards zijn klikbaar — opent inline detail
    // met "Maak hiervan een aanvraag" als expliciete vervolgactie.
    if ((data.all || []).length) {
      await gcRenderExploreResultsStack(data);
    }

    // Begeleidende vraag — kies een dimensie die nog mist
    const missing = gcSuggestDimension(tags, gcExploreText);
    const ask = live.length === 0
      ? 'Wil je iets aanpassen of weghalen?'
      : live.length <= 3
        ? `Je zit al heel gericht. Klik op een resultaat hierboven voor een matchoverzicht, of tik nog een detail om verder te verfijnen.`
        : `Klik op een resultaat hierboven voor het matchoverzicht, of verfijn verder. ${missing}`;
    await gcAgent(ask);

    // Inline input + actie-pills
    gcAskMore('Voeg iets toe — bijv. ' + (missing.includes('leeftijd') ? 'leeftijd of geboortejaar' : missing.includes('postcode') ? 'postcode, stad, gemeente of regio' : 'comorbiditeit of voorkeur'));
    gcOptions([
      { label: 'Toon volledige lijst', icon: '☰', onSelect: gcShowFullList },
      { label: 'Maak hiervan een aanvraag', icon: '↑', primary: true, onSelect: gcExploreToIntern },
      { label: '← Stop verkenning', onSelect: gcWelcome }
    ]);
  }

  // Volledige resultatenlijst in de verkenningsdialoog — zelfde DOM/structuur
  // als de reguliere matching-conversatie (Forta + Alternatieven expandables,
  // populateMatching-rendering), maar zonder Buiten behandelkader-acties en
  // met een expliciete "Maak hiervan een aanvraag"-knop in het inline detail.
  async function gcRenderExploreResultsStack(data) {
    const body = gcBody();
    if (!body) return;

    // Stub-case + result zodat we populateMatching kunnen hergebruiken zonder
    // dat er een echte case bestaat. De button-handlers overschrijven we
    // hieronder met explore-specifiek gedrag.
    const stubCase = { id: null };
    const stubResult = {
      advice: data.advice,
      modus: state.status.modus || 'snelste_hulp',
      options: data.all || []
    };

    const host = document.createElement('div');
    host.className = 'gc-match-host';
    const toolbar = document.createElement('div');
    toolbar.className = 'match-toolbar';
    const live = stubResult.options.filter(o => !o.knockedOut).length;
    toolbar.innerHTML = `<span><strong>${live} ${live === 1 ? 'optie' : 'opties'}</strong> in scope · advies: <strong>${escape(adviceLabel(stubResult.advice))}</strong></span><span style="font-size:11.5px;color:var(--ink-muted);">Modus: <strong style="color:var(--ink);">${escape({ snelste_hulp: 'Snelste hulp', labelbalans: 'Labelbalans', match_kwaliteit: 'Match-kwaliteit', custom: 'Custom' }[stubResult.modus] || stubResult.modus || '')}</strong></span>`;
    const matchesList = document.createElement('div');
    matchesList.className = 'matches-list';
    host.appendChild(toolbar);
    host.appendChild(matchesList);
    body.appendChild(host);

    populateMatching({ tagsPanel: null, toolbarText: null, toolbarModus: null, matchesList }, stubCase, stubResult, 'secretariaat');

    // Uniforme uitstraling
    matchesList.querySelectorAll('.match-card.recommended').forEach(c => c.classList.remove('recommended'));

    // Inline detail-toggle — explore-variant met "Maak hiervan een aanvraag"
    const findOption = (labelId, locId) => stubResult.options.find(o => o.label_id === labelId && o.location_id === locId);
    const toggleInline = (card, opt) => {
      if (!card || !opt) return;
      const next = card.nextElementSibling;
      if (next && next.classList && next.classList.contains('gc-detail-inline')) {
        next.remove();
        card.classList.remove('gc-card-expanded');
        return;
      }
      matchesList.querySelectorAll('.gc-detail-inline').forEach(el => el.remove());
      matchesList.querySelectorAll('.match-card.gc-card-expanded').forEach(el => el.classList.remove('gc-card-expanded'));
      const detail = buildExploreInlineDetail(opt);
      card.classList.add('gc-card-expanded');
      card.parentElement.insertBefore(detail, card.nextSibling);
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    matchesList.querySelectorAll('button[data-confirm]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const [labelId, locId] = btn.dataset.confirm.split('|').map(Number);
        const opt = findOption(labelId, locId);
        const card = btn.closest('.match-card');
        toggleInline(card, opt);
      };
    });
    matchesList.querySelectorAll('.match-card:not(.afwijkend):not(.afwijzen)').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button, a, .gc-detail-inline')) return;
        const btn = card.querySelector('button[data-confirm]');
        if (!btn) return;
        const [labelId, locId] = btn.dataset.confirm.split('|').map(Number);
        const opt = findOption(labelId, locId);
        toggleInline(card, opt);
      });
    });

    // Restructuur naar Forta + Alternatieven (zonder afwijkende routes /
    // Buiten behandelkader — in explore-modus is afwijzen niet aan de orde).
    matchesList.querySelectorAll('.section-divider').forEach(el => el.remove());
    matchesList.querySelectorAll('.match-card.afwijkend, .match-card.afwijzen').forEach(el => el.remove());

    const split = matchesList.querySelector('.matches-split');
    const fortaHead = matchesList.querySelector('.matches-column-head.offline');
    const altHead   = matchesList.querySelector('.matches-column-head.alternatieven');
    const fortaCol  = fortaHead ? fortaHead.parentElement : null;
    const altCol    = altHead   ? altHead.parentElement   : null;

    const cardScore = (card) => {
      const txt = (card.querySelector('.match-score')?.textContent || '0').trim();
      if (/^×/.test(txt)) return -9999;
      const n = parseInt(txt.replace(/[^\d-]/g, ''), 10);
      return isNaN(n) ? -9999 : n;
    };

    const fortaCards = [];
    const altCards = [];
    if (fortaCol) fortaCards.push(...Array.from(fortaCol.querySelectorAll(':scope > .match-card')));
    if (altCol) {
      Array.from(altCol.querySelectorAll(':scope > .match-card')).forEach(card => {
        if (card.classList.contains('afwijkend') || card.classList.contains('afwijzen')) return;
        if (card.classList.contains('kind-sociaal-domein')) altCards.push(card);
        else fortaCards.push(card);
      });
    }
    fortaCards.sort((a, b) => cardScore(b) - cardScore(a));
    altCards.sort((a, b) => cardScore(b) - cardScore(a));

    const buildSection = (title, cards, opts = {}) => {
      const det = document.createElement('details');
      det.className = 'gc-result-section';
      if (opts.open) det.open = true;
      const sum = document.createElement('summary');
      sum.innerHTML = `<span class="gc-section-title">${escape(title)}</span><span class="gc-section-count">${cards.length} ${cards.length === 1 ? 'resultaat' : 'resultaten'}</span>`;
      det.appendChild(sum);
      const inner = document.createElement('div');
      inner.className = 'gc-section-body';
      if (cards.length === 0) {
        inner.innerHTML = `<div class="gc-section-empty">Geen ${escape(title.toLowerCase())} voor deze verkenning.</div>`;
      } else {
        cards.forEach(c => inner.appendChild(c));
      }
      det.appendChild(inner);
      return det;
    };

    const stack = document.createElement('div');
    stack.className = 'gc-results-stack';
    stack.appendChild(buildSection('Forta locaties', fortaCards, { open: true }));
    stack.appendChild(buildSection('Alternatieven', altCards));
    if (split) split.replaceWith(stack); else matchesList.insertBefore(stack, matchesList.firstChild);

    // Soft fade-in
    stack.style.opacity = '0';
    stack.style.transform = 'translateY(8px)';
    stack.style.transition = 'opacity 0.4s ease-out, transform 0.4s ease-out';
    await new Promise(r => setTimeout(r, 80));
    stack.style.opacity = '1';
    stack.style.transform = 'translateY(0)';
    body.scrollTo({ top: host.offsetTop - 8, behavior: 'smooth' });
  }

  // Inline detail in explore-modus — zelfde structuur als buildInlineDetail
  // maar met "Maak hiervan een aanvraag" als commit-actie.
  function buildExploreInlineDetail(option) {
    const wrap = document.createElement('div');
    wrap.className = 'gc-detail-inline';
    const locParts = [];
    if (option.location_name) locParts.push(escape(option.location_name));
    if (option.is_online) locParts.push('Online');
    if (option.wachttijd_dagen != null) locParts.push(`${Math.round(option.wachttijd_dagen / 7)} wkn wachttijd`);
    if (option.reisMin != null && !option.is_online) locParts.push(`reistijd ±${option.reisMin} min`);
    const breakdown = option.breakdown || [];
    const tagHtml = (b) => {
      const cl = b.kind === 'pos' ? 'tag-positive' : b.kind === 'neg' ? 'tag-negative' : 'tag-neutral';
      return `<span class="tag ${cl}">${escape(b.tag)}</span>`;
    };
    wrap.innerHTML = `
      ${option.label_description ? `<div class="gc-detail-section"><h5>Beschrijving</h5><p class="gc-detail-desc">${escape(option.label_description)}</p></div>` : ''}
      <div class="gc-detail-section">
        <h5>Locatie & wachttijd</h5>
        <div class="gc-detail-grid">
          <div class="lbl">Locatie</div><div>${locParts.join(' · ') || '—'}</div>
          ${option.wachttijd_dagen != null ? `<div class="lbl">Wachttijd</div><div>${option.wachttijd_dagen} dagen (${Math.round(option.wachttijd_dagen/7)} wkn)</div>` : ''}
          ${option.reisMin != null && !option.is_online ? `<div class="lbl">Reistijd</div><div>±${option.reisMin} min</div>` : ''}
          <div class="lbl">Type</div><div>${option.is_online ? 'Online' : 'Fysieke locatie'}${option.kind === 'sociaal_domein' ? ' · sociaal domein' : ' · Forta'}</div>
          <div class="lbl">Label-code</div><div>${escape(option.label_code || '—')}</div>
        </div>
      </div>
      ${breakdown.length ? `<div class="gc-detail-section"><h5>Score-breakdown</h5><div class="gc-detail-tag-list">${breakdown.map(tagHtml).join('')}</div></div>` : ''}
      <div class="gc-detail-hint">Wil je verder verfijnen? Typ hieronder bijvoorbeeld een stad of voorkeur — de lijst past zich aan.</div>
      <div class="gc-detail-actions">
        <button class="btn btn-primary btn-sm" data-action="aanvraag">Maak hiervan een aanvraag →</button>
        <button class="btn btn-secondary btn-sm" data-action="close">Sluit overzicht</button>
      </div>`;
    wrap.querySelector('[data-action="aanvraag"]').onclick = () => gcExploreToIntern();
    wrap.querySelector('[data-action="close"]').onclick = () => {
      const prev = wrap.previousElementSibling;
      if (prev && prev.classList.contains('match-card')) prev.classList.remove('gc-card-expanded');
      wrap.remove();
    };
    return wrap;
  }

  // Klikbare mini-cards in de verkenningsdialoog — elke card opent inline een
  // matchoverzicht direct daaronder, met "Maak hiervan een aanvraag" als
  // expliciete vervolgactie. Geen pop-ups; de conversatie loopt eronder door.
  function gcRenderExploreCards(options) {
    const body = gcBody();
    if (!body || !options.length) return;

    const buildCard = (o, i) => {
      const card = document.createElement('div');
      card.className = 'gc-explore-card';
      const scoreText = (o.totalScore > 0 ? '+' : '') + o.totalScore;
      const locParts = [];
      if (o.location_name) locParts.push(escape(o.location_name));
      if (o.is_online) locParts.push('online');
      if (o.wachttijd_dagen != null) locParts.push(`${Math.round(o.wachttijd_dagen/7)} wkn wachttijd`);
      card.innerHTML = `
        <div class="gc-explore-card-body">
          <div>
            <div class="gc-explore-card-rank">${i + 1}.</div>
            <div class="gc-explore-card-title">${escape(o.label_name)}</div>
            <div class="gc-explore-card-loc">${locParts.join(' · ') || '—'}</div>
          </div>
          <div class="gc-explore-card-score">${scoreText}</div>
        </div>
        <div class="gc-explore-card-cta">Open matchoverzicht →</div>`;
      card.onclick = () => gcToggleExploreDetail(card, o);
      return card;
    };

    const wrap = document.createElement('div');
    wrap.className = 'gc-explore-cards';
    const first = options.slice(0, 3);
    const rest  = options.slice(3);
    first.forEach((o, i) => wrap.appendChild(buildCard(o, i)));

    if (rest.length) {
      const det = document.createElement('details');
      det.className = 'gc-explore-more';
      const sum = document.createElement('summary');
      sum.innerHTML = `<span>Meer resultaten</span><span class="gc-explore-more-count">${rest.length}</span>`;
      det.appendChild(sum);
      const inner = document.createElement('div');
      inner.className = 'gc-explore-more-body';
      rest.forEach((o, idx) => inner.appendChild(buildCard(o, idx + first.length)));
      det.appendChild(inner);
      wrap.appendChild(det);
    }

    body.appendChild(wrap);
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });
  }

  function gcToggleExploreDetail(card, option) {
    const next = card.nextElementSibling;
    if (next && next.classList && next.classList.contains('gc-explore-detail')) {
      next.remove();
      card.classList.remove('expanded');
      return;
    }
    // Sluit andere open details binnen dezelfde groep
    const group = card.parentElement;
    group.querySelectorAll('.gc-explore-detail').forEach(el => el.remove());
    group.querySelectorAll('.gc-explore-card.expanded').forEach(el => el.classList.remove('expanded'));

    const detail = document.createElement('div');
    detail.className = 'gc-explore-detail';
    const breakdown = option.breakdown || [];
    const tagHtml = (b) => {
      const cl = b.kind === 'pos' ? 'tag-positive' : b.kind === 'neg' ? 'tag-negative' : 'tag-neutral';
      return `<span class="tag ${cl}">${escape(b.tag)}</span>`;
    };
    detail.innerHTML = `
      ${option.label_description ? `<div class="gc-detail-section"><h5>Beschrijving</h5><p class="gc-detail-desc">${escape(option.label_description)}</p></div>` : ''}
      <div class="gc-detail-section">
        <h5>Locatie & wachttijd</h5>
        <div class="gc-detail-grid">
          <div class="lbl">Locatie</div><div>${escape(option.location_name || '—')}${option.is_online ? ' · online' : ''}</div>
          ${option.wachttijd_dagen != null ? `<div class="lbl">Wachttijd</div><div>${option.wachttijd_dagen} dagen (${Math.round(option.wachttijd_dagen/7)} wkn)</div>` : ''}
          <div class="lbl">Type</div><div>${option.is_online ? 'Online' : 'Fysieke locatie'}${option.kind === 'sociaal_domein' ? ' · sociaal domein' : ' · Forta'}</div>
          <div class="lbl">Label-code</div><div>${escape(option.label_code || '—')}</div>
        </div>
      </div>
      ${breakdown.length ? `<div class="gc-detail-section"><h5>Score-breakdown</h5><div class="gc-detail-tag-list">${breakdown.map(tagHtml).join('')}</div></div>` : ''}
      <div class="gc-detail-hint">Wil je verder verfijnen? Typ hieronder bijvoorbeeld een stad of voorkeur — de lijst past zich aan.</div>
      <div class="gc-detail-actions">
        <button class="btn btn-primary btn-sm" data-action="aanvraag">Maak hiervan een aanvraag →</button>
        <button class="btn btn-secondary btn-sm" data-action="close">Sluit overzicht</button>
      </div>`;
    detail.querySelector('[data-action="aanvraag"]').onclick = () => gcExploreToIntern();
    detail.querySelector('[data-action="close"]').onclick = () => {
      card.classList.remove('expanded');
      detail.remove();
    };
    card.classList.add('expanded');
    card.parentElement.insertBefore(detail, card.nextSibling);
    detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // Heuristiek: welke dimensie ontbreekt nog in wat de gebruiker tot nu toe deelde?
  function gcSuggestDimension(tags, text) {
    const t = (text || '').toLowerCase();
    const has = (re) => re.test(t);
    if (!tags.some(tg => tg.category === 'doelgroep') && !/(\d{1,2}\s?(jaar|jr|j\.))/.test(t)) return 'Bijvoorbeeld: hoe oud is de cliënt?';
    if (!/\b\d{4}\s?[a-z]{0,2}\b/.test(t) && !/(utrecht|amsterdam|den haag|rotterdam|eindhoven|hilversum|amersfoort|tilburg|groningen|nijmegen|haarlem|leiden|delft|breda|arnhem|zwolle|maastricht|enschede|apeldoorn|amersfoort|gemeente|stad|dorp|regio)/.test(t)) return 'Een postcode, stad, gemeente of regio kan helpen om reistijd mee te wegen.';
    if (!tags.some(tg => tg.category === 'comorbiditeit') && !has(/(angst|trauma|verslav|stemming|persoonlijk)/)) return 'Komt er comorbiditeit bij — bv. angst, trauma, of stemmingsklachten?';
    if (!tags.some(tg => tg.category === 'procedureel')) return 'Diagnostiek of behandeling — wat is de hoofdvraag?';
    if (!has(/(online|fysiek|locatie|reistijd|behandelvorm)/)) return 'Voorkeur voor online of fysieke zorg?';
    if (!has(/(zilveren kruis|vgz|cz|menzis|dsw|verzeker)/)) return 'Welke zorgverzekeraar — speelt soms mee in het plafond.';
    return 'Geef nog een detail mee dat de zoekruimte verkleint.';
  }

  async function gcShowFullList() {
    if (!gcExploreLast) { await gcAgent('Stel eerst een vraag, dan kan ik het resultaat tonen.'); gcAskMore(); return; }
    await gcRenderMatchReply(gcExploreLast, true);
  }

  // Zichtbaarheid van het paneel — gebruikt om upload-flows te laten weten of
  // ze in de chat moeten renderen of naar de matching-pagina mogen springen.
  function gcChatVisible() {
    const panel = document.getElementById('guidedChat');
    if (!panel) return false;
    if (panel.style.display === 'none') return false;
    let dismissed = false;
    try { dismissed = localStorage.getItem(GC_KEY) === '1'; } catch {}
    return !dismissed;
  }

  // Resultaten van een echte case in de chat tonen. Per match-card kan de
  // gebruiker doorklikken naar de detail-view (page-decision) of de aanvraag
  // bevestigen via de bestaande matching-pagina.
  async function gcShowCaseMatches(caseId) {
    const body = gcBody();
    if (!body) { window.goto('matching'); return; }
    // Reset: alle interactieve UI uit een vorige fase (verkennings-textarea,
    // chat-options, expandable explore-cards, detail-blokken) opruimen zodat
    // we schoon in de reguliere matching-conversatie starten.
    body.querySelectorAll('.gc-input-area, .gc-input-hint, .chat-options, .gc-explore-cards, .gc-explore-detail, .gc-detail-inline, .gc-form, .gc-match-host, .gc-check-host, .gc-results-stack').forEach(el => el.remove());

    await gcAgent('Brief verwerkt — bezig met scoren tegen de actieve labels…', { delay: 250 });

    let c, result;
    try {
      c = await api(`/api/cases/${caseId}`);
      result = c.last_match;
      if (!result) {
        result = await api(`/api/cases/${caseId}/match`, { method: 'POST', body: { modus: state.status.modus } });
      } else {
        result = { advice: result.advice, modus: result.modus, options: result.options };
      }
      state.activeCaseId = caseId;
      state.activeCase = c;
    } catch (e) {
      await gcAgent(`Iets ging mis bij het matchen: ${escape(e.message)}`);
      gcOptions([
        { label: 'Open de matching-pagina', primary: true, onSelect: () => window.goto('matching') },
        { label: '← Terug naar begin', onSelect: gcWelcome }
      ]);
      return;
    }

    // Korte client-recap zodat duidelijk is welke aanvraag we beoordelen
    const ext = c.extraction || {};
    const tags = ext.tags || [];
    const live = (result.options || []).filter(o => !o.knockedOut);
    const ko = (result.options || []).length - live.length;
    const adviceTone = { ja: 'sterke match', twijfel: 'twijfelgeval', nee: 'geen passende match' }[result.advice] || 'beoordeling onduidelijk';

    let recap = `<strong>${escape(c.ref_code || '')}</strong>${ext.patient_age ? ` · ${ext.patient_age} jr` : ''}${ext.postcode ? ` · ${escape(ext.postcode)}` : ''}${ext.insurer_name ? ` · ${escape(ext.insurer_name)}` : ''}<br>${escape(ext.hulpvraag || ext.fields?.hulpvraag || 'Hulpvraag uit brief gehaald.')}`;
    if (tags.length) {
      recap += `<div class="gc-tags">${tags.slice(0, 10).map(tg => `<span class="gc-tag${tg.category === 'exclusie' ? ' excl' : ''}">${escape(tg.name)}</span>`).join('')}${tags.length > 10 ? `<span class="gc-tag">+${tags.length - 10}</span>` : ''}</div>`;
    }
    await gcAgent(recap);

    // Indien de gebruiker eerder "Ja" koos voor de volledigheidscheck: eerst
    // de checklist tonen en wachten op bevestiging om door te gaan naar de matches.
    if (gcCompleteCheckPref === 'ja') {
      gcCompleteCheckPref = 'nee'; // niet herhalen voor volgende ronde
      await gcRenderCompletenessCheck(c);
      await new Promise(resolve => {
        gcOptions([
          { label: 'Doorgaan naar matching', icon: '→', primary: true, onSelect: resolve },
          { label: '← Markeer als incompleet', icon: '↺', onSelect: () => { window.goto('check'); } }
        ]);
      });
    }

    const summary = `Advies: <strong>${adviceTone}</strong>. ${live.length} ${live.length === 1 ? 'optie' : 'opties'} in scope${ko ? `, ${ko} viel${ko === 1 ? '' : 'en'} af op een knock-out` : ''}. Klik op een kaart om de match te bevestigen of door te zetten.`;
    await gcAgent(summary);

    // Render de exacte match-cards uit de matching-pagina (zelfde DOM + CSS via .match-card),
    // gewrapt in een scope-class zodat de twee kolommen netjes stackeren in het smalle chat-paneel.
    const host = document.createElement('div');
    host.className = 'gc-match-host';
    const toolbar = document.createElement('div');
    toolbar.className = 'match-toolbar';
    toolbar.innerHTML = `<span><strong>${(result.options || []).length} opties</strong> beoordeeld · advies: <strong>${escape(adviceLabel(result.advice))}</strong></span><span style="font-size:11.5px;color:var(--ink-muted);">Modus: <strong style="color:var(--ink);">${escape({ snelste_hulp: 'Snelste hulp', labelbalans: 'Labelbalans', match_kwaliteit: 'Match-kwaliteit', custom: 'Custom' }[result.modus] || result.modus || '')}</strong></span>`;
    const matchesList = document.createElement('div');
    matchesList.className = 'matches-list';
    host.appendChild(toolbar);
    host.appendChild(matchesList);
    body.appendChild(host);
    body.scrollTop = body.scrollHeight;

    // Hergebruik bestaande renderer — same DOM, same look as page-matching
    populateMatching(
      { tagsPanel: null, toolbarText: null, toolbarModus: null, matchesList },
      c, result, 'secretariaat'
    );

    // Recommended-accent strippen voor uniforme uitstraling — de Aanbevolen-badge
    // zelf blijft staan zodat de top-keuze herkenbaar is.
    matchesList.querySelectorAll('.match-card.recommended').forEach(c => c.classList.remove('recommended'));
    // Verwijder de "X labels afgevallen vanwege" meldingen — afgevallen opties
    // tonen we niet meer in de matching-resultaten.
    matchesList.querySelectorAll('.dropped-notice').forEach(el => el.remove());

    // Selecteer-knop én kaart-klik klappen de detail-info UIT direct onder
    // de aangeklikte kaart — geen vastleg, geen nieuwe chat-bubble. De
    // standaard commit-flow uit populateMatching wordt hierdoor overschreven.
    const findOption = (labelId, locId) => (result.options || []).find(o => o.label_id === labelId && o.location_id === locId);
    const toggleInline = (card, opt) => {
      if (!card || !opt) return;
      // Als er al een inline-detail onder deze kaart staat: inklappen.
      const next = card.nextElementSibling;
      if (next && next.classList && next.classList.contains('gc-detail-inline')) {
        next.remove();
        card.classList.remove('gc-card-expanded');
        return;
      }
      // Sluit andere open details — slechts één tegelijk.
      matchesList.querySelectorAll('.gc-detail-inline').forEach(el => el.remove());
      matchesList.querySelectorAll('.match-card.gc-card-expanded').forEach(el => el.classList.remove('gc-card-expanded'));
      const detail = buildInlineDetail(c, opt);
      card.classList.add('gc-card-expanded');
      card.parentElement.insertBefore(detail, card.nextSibling);
      detail.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    };
    matchesList.querySelectorAll('button[data-confirm]').forEach(btn => {
      btn.onclick = (e) => {
        e.stopPropagation();
        const [labelId, locId] = btn.dataset.confirm.split('|').map(Number);
        const opt = findOption(labelId, locId);
        const card = btn.closest('.match-card');
        toggleInline(card, opt);
      };
    });
    matchesList.querySelectorAll('.match-card:not(.afwijkend):not(.afwijzen)').forEach(card => {
      card.addEventListener('click', (e) => {
        if (e.target.closest('button, a, .gc-detail-inline')) return;
        const btn = card.querySelector('button[data-confirm]');
        if (!btn) return;
        const [labelId, locId] = btn.dataset.confirm.split('|').map(Number);
        const opt = findOption(labelId, locId);
        toggleInline(card, opt);
      });
    });

    // Herschikken naar twee gestapelde expandables: Forta locaties + Alternatieven.
    // Forta krijgt alle live Forta-opties (offline + online), gesorteerd op score.
    // Alternatieven bevat alleen sociaal-domein opties.
    // De "offline"/"alternatieven" class staat op .matches-column-head, niet
    // op de kolom zelf — vandaar de parentElement-truc.
    const split = matchesList.querySelector('.matches-split');
    const fortaHead = matchesList.querySelector('.matches-column-head.offline');
    const altHead   = matchesList.querySelector('.matches-column-head.alternatieven');
    const fortaCol  = fortaHead ? fortaHead.parentElement : null;
    const altCol    = altHead   ? altHead.parentElement   : null;

    const cardScore = (card) => {
      const txt = (card.querySelector('.match-score')?.textContent || '0').trim();
      if (/^×/.test(txt)) return -9999;
      const n = parseInt(txt.replace(/[^\d-]/g, ''), 10);
      return isNaN(n) ? -9999 : n;
    };

    const fortaCards = [];
    const altCards = [];
    if (fortaCol) {
      fortaCards.push(...Array.from(fortaCol.querySelectorAll(':scope > .match-card')));
    }
    if (altCol) {
      Array.from(altCol.querySelectorAll(':scope > .match-card')).forEach(card => {
        if (card.classList.contains('afwijkend') || card.classList.contains('afwijzen')) return;
        if (card.classList.contains('kind-sociaal-domein')) altCards.push(card);
        else fortaCards.push(card);
      });
    }
    fortaCards.sort((a, b) => cardScore(b) - cardScore(a));
    altCards.sort((a, b) => cardScore(b) - cardScore(a));

    const buildSection = (title, cards, opts = {}) => {
      const det = document.createElement('details');
      det.className = 'gc-result-section';
      if (opts.open) det.open = true;
      const sum = document.createElement('summary');
      sum.innerHTML = `<span class="gc-section-title">${escape(title)}</span><span class="gc-section-count">${cards.length} ${cards.length === 1 ? 'resultaat' : 'resultaten'}</span>`;
      det.appendChild(sum);
      const inner = document.createElement('div');
      inner.className = 'gc-section-body';
      if (cards.length === 0) {
        inner.innerHTML = `<div class="gc-section-empty">Geen ${escape(title.toLowerCase())} voor deze brief.</div>`;
      } else {
        cards.forEach(c => inner.appendChild(c));
      }
      det.appendChild(inner);
      return det;
    };

    // Afwijkende routes (Doorsturen + Afwijzen) zitten als actie-knoppen onder
    // de stack — niet als expandable in de resultatenlijst. Afgevallen opties
    // (knock-outs) worden niet meer getoond; afwijzen blijft beschikbaar via
    // de actie-balk onder de resultaten.
    matchesList.querySelectorAll('.section-divider').forEach(el => el.remove());
    matchesList.querySelectorAll('.match-card.afwijkend, .match-card.afwijzen').forEach(el => el.remove());

    const stack = document.createElement('div');
    stack.className = 'gc-results-stack';
    stack.appendChild(buildSection('Forta locaties', fortaCards, { open: true }));
    stack.appendChild(buildSection('Alternatieven', altCards));
    if (split) split.replaceWith(stack); else matchesList.insertBefore(stack, matchesList.firstChild);

    // Soft fade-in van de stack zodat het rustig binnenkomt, in plaats van de
    // kaarten één voor één in beeld te brengen — de expandables doen nu de
    // visuele "opbouw".
    stack.style.opacity = '0';
    stack.style.transform = 'translateY(8px)';
    stack.style.transition = 'opacity 0.45s ease-out, transform 0.45s ease-out';
    const anchorTop = Math.max(0, host.offsetTop - 8);
    body.scrollTo({ top: anchorTop, behavior: 'smooth' });
    await new Promise(r => setTimeout(r, 400));
    stack.style.opacity = '1';
    stack.style.transform = 'translateY(0)';
    await new Promise(r => setTimeout(r, 500));

    await gcAgent('Wat wil je hierna doen?', { scroll: false });
    gcOptions([
      { label: 'Nogmaals matchen', icon: '↻', primary: true, onSelect: () => gcRematchCase(c.id) },
      { label: 'Doorsturen naar screenteam', icon: '→', onSelect: () => gcForwardScreenteam(c.id) },
      { label: 'Afwijzen', icon: '×', onSelect: () => gcRejectCase(c.id) },
      { label: 'Bekijk check', icon: '✓', onSelect: () => window.goto('check') },
      { label: '← Terug', icon: '↺', onSelect: gcWelcome }
    ]);
  }

  async function gcForwardScreenteam(caseId) {
    const body = gcBody();
    if (!body) return;
    await gcAgent('Vul de details in voor het screenteam — hoe meer context, hoe gerichter ze het belgesprek kunnen voorbereiden.');

    const form = document.createElement('div');
    form.className = 'gc-form';
    form.innerHTML = `
      <div class="gc-form-head">
        <strong>Doorsturen naar screenteam</strong>
        <span class="gc-form-sub">Velden met * zijn verplicht</span>
      </div>

      <div class="gc-form-row">
        <label>Reden voor doorsturen <span class="req">*</span></label>
        <textarea name="reden" rows="2" placeholder="Bijv. ambigu klachtbeeld, complexe comorbiditeit, twijfel over knock-out…"></textarea>
      </div>

      <div class="gc-form-row">
        <label>Type onduidelijkheid</label>
        <div class="gc-form-chips" data-name="type">
          <button type="button" data-val="comorbiditeit">Comorbiditeit</button>
          <button type="button" data-val="onduidelijk_klachtbeeld">Onduidelijk klachtbeeld</button>
          <button type="button" data-val="knockout_twijfel">Twijfel knock-out</button>
          <button type="button" data-val="leeftijd">Leeftijdsgrens</button>
          <button type="button" data-val="anders">Anders</button>
        </div>
      </div>

      <div class="gc-form-row">
        <label>Urgentie</label>
        <div class="gc-form-chips" data-name="urgentie">
          <button type="button" data-val="hoog">Hoog</button>
          <button type="button" data-val="normaal" data-default="1">Normaal</button>
          <button type="button" data-val="laag">Kan wachten</button>
        </div>
      </div>

      <div class="gc-form-row">
        <label>Specifieke vraag voor screenteam</label>
        <textarea name="vraag" rows="2" placeholder="Wat moet het screenteam in het belgesprek uitvragen of verifiëren?"></textarea>
      </div>

      <div class="gc-form-row gc-form-row-inline">
        <label>Contactvoorkeur cliënt</label>
        <div class="gc-form-chips" data-name="contact">
          <button type="button" data-val="bellen" data-default="1">Bellen</button>
          <button type="button" data-val="mailen">Mailen</button>
          <button type="button" data-val="onbekend">Onbekend</button>
        </div>
      </div>

      <div class="gc-form-err" hidden></div>
      <div class="gc-form-actions">
        <button class="btn btn-secondary btn-sm" data-action="cancel">Annuleer</button>
        <button class="btn btn-primary btn-sm" data-action="submit">Doorsturen →</button>
      </div>`;
    body.appendChild(form);
    body.scrollTo({ top: body.scrollHeight, behavior: 'smooth' });

    // Defaults
    form.querySelectorAll('[data-default]').forEach(b => b.classList.add('active'));
    // Chip-toggling per groep — single-select
    form.querySelectorAll('.gc-form-chips').forEach(group => {
      group.querySelectorAll('button').forEach(btn => {
        btn.onclick = () => {
          group.querySelectorAll('button').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        };
      });
    });

    setTimeout(() => form.querySelector('textarea[name="reden"]').focus(), 50);

    form.querySelector('[data-action="cancel"]').onclick = () => form.remove();
    form.querySelector('[data-action="submit"]').onclick = async () => {
      const reden = form.querySelector('textarea[name="reden"]').value.trim();
      const vraag = form.querySelector('textarea[name="vraag"]').value.trim();
      const type  = form.querySelector('.gc-form-chips[data-name="type"] .active')?.dataset.val || null;
      const urg   = form.querySelector('.gc-form-chips[data-name="urgentie"] .active')?.dataset.val || 'normaal';
      const cont  = form.querySelector('.gc-form-chips[data-name="contact"] .active')?.dataset.val || 'bellen';
      const errEl = form.querySelector('.gc-form-err');
      if (!reden) {
        errEl.textContent = 'Reden voor doorsturen is verplicht.';
        errEl.hidden = false;
        return;
      }
      errEl.hidden = true;

      const parts = [`Reden: ${reden}`];
      if (type) parts.push(`Type: ${type.replace(/_/g, ' ')}`);
      parts.push(`Urgentie: ${urg}`);
      parts.push(`Contact: ${cont}`);
      if (vraag) parts.push(`Vraag voor screenteam: ${vraag}`);
      const motivation = parts.join(' · ');

      const submitBtn = form.querySelector('[data-action="submit"]');
      submitBtn.disabled = true;
      submitBtn.textContent = 'Bezig…';
      try {
        await api(`/api/cases/${caseId}/decision`, {
          method: 'POST',
          body: { outcome: 'doorzetten_screenteam', motivation, actor_role: 'secretariaat', actor_name: 'Maria Boom' }
        });
        form.remove();
        await gcAgent('Doorgestuurd naar screenteam — de aanvraag staat in hun werkstroom.');
        window.goto('werklijst');
      } catch (e) {
        errEl.textContent = 'Doorsturen mislukt: ' + e.message;
        errEl.hidden = false;
        submitBtn.disabled = false;
        submitBtn.textContent = 'Doorsturen →';
      }
    };
  }

  async function gcRejectCase(caseId) {
    const motivation = prompt('Motivering voor afwijzing:');
    if (!motivation) return;
    try {
      await api(`/api/cases/${caseId}/decision`, {
        method: 'POST',
        body: { outcome: 'afwijzen', motivation, actor_role: 'secretariaat', actor_name: 'Maria Boom' }
      });
      await gcAgent('Aanvraag afgewezen — terugstuurbrief gegenereerd.');
      window.goto('werklijst');
    } catch (e) {
      await gcAgent(`Afwijzen mislukt: ${escape(e.message)}`);
    }
  }

  // Run de matching opnieuw en hertoon de resultaten in de chat.
  async function gcRematchCase(caseId) {
    await gcAgent('Goed, ik draai de match opnieuw…', { delay: 250 });
    try {
      await api(`/api/cases/${caseId}/match`, { method: 'POST', body: { modus: state.status.modus } });
    } catch (e) {
      await gcAgent(`Iets ging mis bij het opnieuw matchen: ${escape(e.message)}`);
      return;
    }
    await gcShowCaseMatches(caseId);
  }

  // Beschrijvende zinnen per veld, in taal voor een verwijzend arts, voor
  // gebruik in het concept-bericht onder de aandachtspunten. Voor onbekende
  // velden valt de functie terug op een neutrale beschrijving.
  const CHECK_FIELD_COPY = {
    patient_initials: {
      missing: 'In de verwijsbrief hebben wij de volledige initialen en het BSN van de cliënt niet kunnen terugvinden. Wij ontvangen deze graag, zodat wij de cliënt op de juiste manier in onze administratie kunnen registreren.',
      warn: 'De initialen of het BSN van de cliënt zijn aanwezig maar onvolledig. Wilt u deze nog aanvullen of verifiëren?'
    },
    agb_referrer: {
      missing: 'Uw AGB-code hebben wij niet in de verwijzing kunnen vinden. Kunt u deze toevoegen zodat wij de verwijzing administratief correct kunnen registreren?',
      warn: 'De AGB-code in de verwijzing heeft een ongebruikelijk formaat. Wilt u deze nog controleren en zo nodig corrigeren?'
    },
    letter_date: {
      missing: 'De dagtekening van de verwijsbrief ontbreekt of de brief is ouder dan zes maanden. Wij ontvangen graag een actuele verwijzing — een nieuwe datering binnen zes maanden is voldoende.',
      warn: 'De datering van de verwijsbrief vraagt om verificatie — kunt u deze nog nakijken?'
    },
    signature_present: {
      missing: 'Een ondertekening door u als verwijzend arts hebben wij niet kunnen vaststellen. Wilt u de brief alsnog voorzien van uw (digitale) handtekening?',
      warn: 'De handtekening is aanwezig maar moeilijk te verifiëren. Een korte bevestiging of een opnieuw ondertekende brief is voldoende.'
    },
    dsm_suspicion: {
      missing: 'Een werkdiagnose of differentiële diagnose volgens de DSM-5 ontbreekt in de brief. Een richting (bijvoorbeeld ADHD, angst- of stemmingsklachten) is voldoende om de cliënt aan een passend behandelaanbod te koppelen.',
      warn: 'De diagnostische vermoedens zijn benoemd maar nog niet specifiek genoeg. Een nadere indicatie helpt ons bij de keuze voor het passende behandelaanbod.'
    },
    postcode: {
      missing: 'De postcode of woonplaats van de cliënt staat niet in de brief vermeld. Met deze informatie kunnen wij de dichtstbijzijnde locatie selecteren en de reistijd meewegen in het advies.',
      warn: 'De postcode van de cliënt is onvolledig. Wilt u de volledige postcode (4 cijfers + 2 letters) doorgeven?'
    },
    hulpvraag: {
      missing: 'De hulpvraag van de cliënt is niet in de brief opgenomen. Een korte schets in een of twee zinnen — wat speelt er, en wat zoekt de cliënt — geeft ons voldoende richting om gericht te kunnen matchen.',
      warn: 'De hulpvraag is benoemd maar erg beknopt. Een korte aanvulling met de huidige klachten en de concrete vraag van de cliënt helpt ons om beter te kunnen matchen aan een passend behandelaanbod.'
    },
    contact_phone: {
      missing: 'De contactgegevens van de cliënt (telefoonnummer en/of e-mailadres) hebben wij niet aangetroffen. Deze hebben wij nodig om contact op te nemen voor het plannen van het intakegesprek.',
      warn: 'De contactgegevens van de cliënt zijn onvolledig. Een aanvullend telefoonnummer of e-mailadres is voldoende.'
    }
  };

  function describeCheckItem(it) {
    const copy = CHECK_FIELD_COPY[it.field];
    if (copy && copy[it.status]) return copy[it.status];
    // Fallback voor onbekende velden — natuurlijke zin op basis van label/boodschap.
    if (it.status === 'missing') {
      return `Voor "${it.label}" hebben wij in de brief geen gegevens kunnen vaststellen. Wij ontvangen deze graag voor het verwerken van de aanmelding.`;
    }
    return `Bij "${it.label}" zien wij een aandachtspunt${it.message ? `: ${it.message.toLowerCase()}` : ''}. Wilt u dit nog verifiëren of toelichten?`;
  }

  // Volledigheidscheck als chat-stap. Toont per veld ok/warn/missing met de
  // bijbehorende boodschap. Missende en aandachtspunten staan direct in beeld;
  // de complete velden zitten onder een uitklapbare sectie zodat de chat niet
  // overspoeld wordt door groene vinkjes.
  async function gcRenderCompletenessCheck(c) {
    const comp = c.completeness;
    const body = gcBody();
    if (!comp) {
      await gcAgent('Geen volledigheidscheck beschikbaar voor deze brief — sla deze stap over.');
      return;
    }
    const items = comp.items || [];
    const missing = items.filter(i => i.status === 'missing');
    const warn    = items.filter(i => i.status === 'warn');
    const ok      = items.filter(i => i.status === 'ok');

    let head;
    if (missing.length === 0 && warn.length === 0) {
      head = `<strong>Volledigheidscheck</strong> — alle ${items.length} verplichte velden zijn aanwezig en valide.`;
    } else if (missing.length === 0) {
      head = `<strong>Volledigheidscheck</strong> — ${ok.length} van ${items.length} velden compleet, ${warn.length} aandachtspunt${warn.length === 1 ? '' : 'en'} — geen blokkades.`;
    } else {
      head = `<strong>Volledigheidscheck</strong> — ${missing.length} verplicht veld${missing.length === 1 ? '' : 'en'} ontbreekt${warn.length ? `, ${warn.length} aandachtspunt${warn.length === 1 ? '' : 'en'}` : ''}. ${ok.length} van ${items.length} velden zijn al compleet.`;
    }
    await gcAgent(head);

    // Knock-out banner indien getriggerd
    const ko = c.knockout;
    if (ko && ko.triggered) {
      await gcAgent(`<span style="color:var(--red);font-weight:500;">Knock-out gedetecteerd:</span> ${escape(ko.criterion || '—')}.<br><span style="color:var(--ink-soft);">${escape(ko.reasoning || '')}</span>`);
    }

    // Hergebruik de styling van de check-page (.check-item / .check-icon)
    // zodat de lijst er identiek uitziet aan de volledigheidspagina.
    const renderRow = (it) => {
      const cls = it.status === 'ok' ? 'ok' : it.status === 'warn' ? 'warn' : 'miss';
      const sym = it.status === 'ok' ? '✓' : it.status === 'warn' ? '!' : '×';
      return `<div class="check-item">
        <span class="check-icon ${cls}">${sym}</span>
        <div>
          <div class="check-label">${escape(it.label || it.field || '')}</div>
          <div class="check-value ${it.status === 'warn' ? 'warn-text' : ''}">${escape(it.message || '')}</div>
        </div>
      </div>`;
    };

    const ext = c.extraction || {};

    // Eén unified host — geen geneste banners of meerdere achtergrondkleuren.
    // De status (✓/!) zit verwerkt in een korte regel bovenin; de brief en de
    // afgevinkte items vormen samen het lichaam. Mail-concept en aandacht
    // zitten tussen de regel en het lichaam als directe vervolgactie.
    const host = document.createElement('div');
    host.className = 'gc-check-v3';

    // 1. Beknopte status-regel (icoon + zin) — vervangt de hele banner.
    const isComplete = missing.length === 0;
    const statusLine = document.createElement('div');
    statusLine.className = 'gc-checkv3-status ' + (isComplete ? 'is-ok' : 'is-warn');
    const statusSub = isComplete
      ? (warn.length ? `${warn.length} aandachtspunt${warn.length === 1 ? '' : 'en'} om door te lopen — verder geen blokkades.` : `Alle ${items.length} verplichte velden zijn aanwezig en valide.`)
      : `${missing.length} verplicht veld${missing.length === 1 ? '' : 'en'} ontbreekt nog. ${ok.length} van ${items.length} bevestigd uit de brief.`;
    statusLine.innerHTML = `
      <span class="gc-checkv3-status-dot">${isComplete ? '✓' : '!'}</span>
      <span class="gc-checkv3-status-text">
        <strong>${isComplete ? 'Brief is compleet' : 'Brief is niet compleet'}</strong>
        <span>${escape(statusSub)}</span>
      </span>`;
    host.appendChild(statusLine);

    // 2. Wat nog mist (alleen bij incompleet) — inline, geen aparte kaart.
    if (missing.length || warn.length) {
      const att = document.createElement('div');
      att.className = 'gc-checkv3-attention';
      att.innerHTML = `
        <h5 class="gc-checkv3-h">Wat nog mist</h5>
        <ul class="gc-checkv3-att-list">
          ${[...missing, ...warn].map(it => `
            <li class="gc-checkv3-att-item is-${it.status === 'missing' ? 'miss' : 'warn'}">
              <span class="gc-checkv3-att-icon">${it.status === 'missing' ? '×' : '!'}</span>
              <div>
                <div class="gc-checkv3-att-label">${escape(it.label || it.field || '')}</div>
                <div class="gc-checkv3-att-msg">${escape(it.message || '')}</div>
              </div>
            </li>`).join('')}
        </ul>`;
      host.appendChild(att);

      // Beschrijvende mailtekst — als collapse zodat de check niet domineert.
      const lines = [
        'Geachte verwijzer,', '',
        'Dank voor uw verwijzing. Bij het verwerken van de aanmelding lopen wij tegen onderstaande punten aan. Wij verzoeken u deze aan te vullen of toe te lichten, zodat wij de cliënt zo snel mogelijk kunnen koppelen aan een passend behandelaanbod.', ''
      ];
      [...missing, ...warn].forEach((it, i) => { lines.push(`${i + 1}. ${describeCheckItem(it)}`); });
      lines.push('', 'Zodra wij uw aanvulling ontvangen, pakken wij de aanmelding direct verder op. Mocht u vragen hebben, dan vernemen wij dat uiteraard graag.', '', 'Met vriendelijke groet,', 'Secretariaat Forta');
      const mailText = lines.join('\n');

      const mail = document.createElement('details');
      mail.className = 'gc-checkv3-mail';
      mail.innerHTML = `
        <summary>
          <span>Concept-bericht aan verwijzer</span>
          <span class="gc-checkv3-mail-pill">Kopieer en mail</span>
        </summary>
        <div class="gc-checkv3-mail-body">
          <textarea readonly></textarea>
          <button type="button" class="btn btn-secondary btn-sm gc-checkv3-mail-copy">Kopieer tekst</button>
        </div>`;
      mail.querySelector('textarea').value = mailText;
      const copyBtn = mail.querySelector('.gc-checkv3-mail-copy');
      copyBtn.onclick = async () => {
        try {
          await navigator.clipboard.writeText(mailText);
          const orig = copyBtn.textContent;
          copyBtn.textContent = '✓ Gekopieerd';
          copyBtn.classList.add('copied');
          setTimeout(() => { copyBtn.textContent = orig; copyBtn.classList.remove('copied'); }, 2000);
        } catch {
          const ta = mail.querySelector('textarea');
          ta.focus(); ta.select();
        }
      };
      host.appendChild(mail);
    }

    // 3. Body — brief links met highlights, afgevinkt rechts.
    const briefBodyHtml = c.raw_text
      ? gcHighlightBrief(c.raw_text, ext, items)
      : '<em style="color:var(--ink-muted);">Geen brieftekst beschikbaar.</em>';
    const okListHtml = ok.length
      ? `<ul class="gc-checkv3-ok-list">${ok.map(it => `
          <li class="gc-checkv3-ok-item">
            <span class="gc-checkv3-ok-icon">✓</span>
            <div>
              <div class="gc-checkv3-ok-label">${escape(it.label || it.field || '')}</div>
              <div class="gc-checkv3-ok-msg">${escape(it.message || '')}</div>
            </div>
          </li>`).join('')}</ul>`
      : '<div class="gc-checkv3-empty">Nog niets bevestigd uit de brief.</div>';

    const split = document.createElement('div');
    split.className = 'gc-checkv3-split';
    split.innerHTML = `
      <div class="gc-checkv3-brief">
        <h5 class="gc-checkv3-h">Verwijsbrief${c.ref_code ? ' · ' + escape(c.ref_code) : ''}</h5>
        <div class="gc-checkv3-brief-body">${briefBodyHtml}</div>
      </div>
      <div class="gc-checkv3-ok">
        <h5 class="gc-checkv3-h">Afgevinkt uit de brief</h5>
        ${okListHtml}
      </div>`;
    host.appendChild(split);

    body.appendChild(host);
    body.scrollTop = body.scrollHeight;
  }

  // Markeert in de brieftekst de stukjes die de extractie heeft gebruikt:
  // postcode, AGB, BSN-achtige initialen, DSM-vermoeden, verzekeraar, contact
  // en tag-evidentie. Werkt non-overlappend (langste matches eerst) zodat
  // genest HTML wordt voorkomen.
  function gcHighlightBrief(rawText, ext, checkItems) {
    const fields = ext.fields || {};
    const okFields = new Set((checkItems || []).filter(i => i.status === 'ok').map(i => i.field));
    const items = [];
    const push = (pattern, cls = '') => {
      if (!pattern) return;
      const s = String(pattern).trim();
      if (s.length < 2) return;
      items.push({ pattern: s, cls });
    };
    push(fields.postcode, okFields.has('postcode') ? 'green' : '');
    push(fields.agb_referrer, okFields.has('agb_referrer') ? 'green' : '');
    push(fields.patient_initials, okFields.has('patient_initials') ? 'green' : '');
    push(fields.dsm_suspicion, okFields.has('dsm_suspicion') ? 'green' : '');
    push(fields.insurer_name, okFields.has('insurer_name') ? 'green' : '');
    push(fields.contact_phone, okFields.has('contact_phone') ? 'green' : '');
    push(fields.contact_email);
    push(fields.letter_date);
    (ext.tags || []).forEach(t => {
      const cls = t.category === 'exclusie' ? 'red' : '';
      if (t.evidence && t.evidence.length >= 4 && t.evidence.length <= 80) {
        push(t.evidence, cls);
      }
      if (t.name && t.name.length > 2 && t.category !== 'doelgroep') push(t.name, cls);
    });

    // Sorteer langste patronen eerst en dedupliceer
    items.sort((a, b) => b.pattern.length - a.pattern.length);
    const seen = new Set();
    const unique = [];
    items.forEach(it => {
      const key = it.pattern.toLowerCase();
      if (!seen.has(key)) { unique.push(it); seen.add(key); }
    });

    const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matches = [];
    unique.forEach(it => {
      let re;
      try { re = new RegExp(escapeRegex(it.pattern), 'gi'); } catch { return; }
      let m;
      while ((m = re.exec(rawText)) !== null) {
        matches.push({ start: m.index, end: m.index + m[0].length, cls: it.cls });
        if (m.index === re.lastIndex) re.lastIndex++; // safety
      }
    });
    matches.sort((a, b) => a.start - b.start || (b.end - b.start) - (a.end - a.start));
    const final = [];
    matches.forEach(m => {
      if (final.length === 0 || m.start >= final[final.length - 1].end) final.push(m);
    });

    let html = '';
    let pos = 0;
    for (const m of final) {
      if (m.start > pos) html += escape(rawText.slice(pos, m.start));
      html += `<span class="highlight ${m.cls}">${escape(rawText.slice(m.start, m.end))}</span>`;
      pos = m.end;
    }
    if (pos < rawText.length) html += escape(rawText.slice(pos));
    // CSS gebruikt white-space: pre-wrap, dus natuurlijke regelovergangen
    // hoeven niet als <br> gerendered te worden — anders ontstaan dubbele breaks.
    return html;
  }

  // Inline detail-block — verschijnt direct onder een aangeklikte match-card.
  // Toont alleen informatie; geen automatisch vastleg-proces. De gebruiker
  // kan de match alsnog vastleggen via de expliciete "Bevestig deze match" knop
  // onderin het detail-block.
  function buildInlineDetail(c, option) {
    const wrap = document.createElement('div');
    wrap.className = 'gc-detail-inline';
    const locParts = [];
    if (option.location_name) locParts.push(escape(option.location_name));
    if (option.is_online) locParts.push('Online');
    if (option.wachttijd_dagen != null) locParts.push(`${Math.round(option.wachttijd_dagen / 7)} wkn wachttijd`);
    if (option.reisMin != null && !option.is_online) locParts.push(`reistijd ±${option.reisMin} min`);
    const tagHtml = (b) => {
      const cl = b.kind === 'pos' ? 'tag-positive' : b.kind === 'neg' ? 'tag-negative' : 'tag-neutral';
      return `<span class="tag ${cl}">${escape(b.tag)}</span>`;
    };
    const breakdown = option.breakdown || [];
    wrap.innerHTML = `
      ${option.label_description ? `<div class="gc-detail-section"><h5>Beschrijving</h5><p class="gc-detail-desc">${escape(option.label_description)}</p></div>` : ''}
      <div class="gc-detail-section">
        <h5>Locatie & wachttijd</h5>
        <div class="gc-detail-grid">
          <div class="lbl">Locatie</div><div>${locParts.join(' · ') || '—'}</div>
          ${option.wachttijd_dagen != null ? `<div class="lbl">Wachttijd</div><div>${option.wachttijd_dagen} dagen (${Math.round(option.wachttijd_dagen/7)} wkn)</div>` : ''}
          ${option.reisMin != null && !option.is_online ? `<div class="lbl">Reistijd</div><div>±${option.reisMin} min</div>` : ''}
          <div class="lbl">Type</div><div>${option.is_online ? 'Online' : 'Fysieke locatie'}${option.kind === 'sociaal_domein' ? ' · sociaal domein' : ' · Forta'}</div>
          <div class="lbl">Label-code</div><div>${escape(option.label_code || '—')}</div>
        </div>
      </div>
      ${breakdown.length ? `<div class="gc-detail-section"><h5>Score-breakdown</h5><div class="gc-detail-tag-list">${breakdown.map(tagHtml).join('')}</div></div>` : ''}
      <div class="gc-detail-actions">
        <button class="btn btn-primary btn-sm" data-action="commit">Bevestig deze match →</button>
        <button class="btn btn-secondary btn-sm" data-action="close">Sluit detail</button>
      </div>`;
    wrap.querySelector('button[data-action="commit"]').onclick = () => gcCommitMatch(c, option);
    wrap.querySelector('button[data-action="close"]').onclick = () => {
      const prev = wrap.previousElementSibling;
      if (prev && prev.classList.contains('match-card')) prev.classList.remove('gc-card-expanded');
      wrap.remove();
    };
    return wrap;
  }

  async function gcCommitMatch(c, option) {
    try {
      await api(`/api/cases/${c.id}/decision`, {
        method: 'POST',
        body: {
          outcome: 'match',
          label_id: option.label_id,
          location_id: option.location_id,
          motivation: 'Bevestigd op basis van AI-advies',
          actor_role: 'secretariaat',
          actor_name: 'Maria Boom'
        }
      });
      window.goto('decision');
    } catch (e) {
      await gcAgent(`Iets ging mis bij het vastleggen: ${escape(e.message)}`);
    }
  }

  // Klik op een match-card in de chat → direct naar de detail-view
  function gcSelectMatch(c, option) {
    if (option.knockedOut) {
      gcAgent(`<strong>${escape(option.label_name)}</strong> viel af op een knock-out: <em>${escape(option.knockoutReason || 'criterium geraakt')}</em>. Open de matching-pagina voor de volledige redenering.`);
      gcOptions([
        { label: 'Open matching-pagina', primary: true, onSelect: () => window.goto('matching') },
        { label: '← Terug', onSelect: () => {} }
      ]);
      return;
    }
    state.activeCaseId = c.id;
    state.activeCase = c;
    localStorage.setItem('forta.activeCase', c.id);
    // Sla de keuze op in localStorage zodat de detail-pagina hem kan lezen.
    try { localStorage.setItem('forta.selectedMatch', JSON.stringify({ case_id: c.id, label_id: option.label_id, location_id: option.location_id })); } catch {}
    window.goto('decision');
  }

  function gcExploreToIntern() {
    if (typeof openInternModal === 'function') {
      openInternModal();
      const ta = document.getElementById('internText');
      if (ta && gcExploreText) {
        ta.value = gcExploreText;
        const status = document.getElementById('internStatus');
        if (status) status.textContent = 'Tekst overgenomen uit verkennend gesprek — bewerk of vul aan voor verwerking.';
      }
    }
    gcOptions([
      { label: 'Terug naar verkennen', onSelect: () => gcRenderMatchReply(gcExploreLast || { tags: [], top: [], advice: 'nee' }, false) },
      { label: '← Terug naar begin', onSelect: gcWelcome }
    ]);
  }

  function gcSkip() {
    const panel = document.getElementById('guidedChat');
    if (panel) panel.style.display = 'none';
    const grid = document.querySelector('#page-werklijst .upload-grid');
    if (grid) grid.style.display = 'grid';
    try { localStorage.setItem(GC_KEY, '1'); } catch {}
  }

  function gcReset() {
    const panel = document.getElementById('guidedChat');
    const grid = document.querySelector('#page-werklijst .upload-grid');
    if (panel) panel.style.display = 'flex';
    if (grid) grid.style.display = 'none';
    try { localStorage.removeItem(GC_KEY); } catch {}
    gcWelcome();
  }
  window.gcReset = gcReset;

  function installGuidedChat() {
    const panel = document.getElementById('guidedChat');
    if (!panel) return;
    document.getElementById('guidedChatSkip')?.addEventListener('click', gcSkip);
    document.getElementById('guidedChatRestart')?.addEventListener('click', gcReset);
    let dismissed = false;
    try { dismissed = localStorage.getItem(GC_KEY) === '1'; } catch {}
    if (dismissed) {
      panel.style.display = 'none';
      const grid = document.querySelector('#page-werklijst .upload-grid');
      if (grid) grid.style.display = 'grid';
    } else {
      gcWelcome();
    }
  }

  // ====== Boot ======
  document.addEventListener('DOMContentLoaded', () => {
    loadStatus();
    // wire upload modal
    document.getElementById('modalSubmitBtn')?.addEventListener('click', submitUpload);
    document.getElementById('modalCancelBtn')?.addEventListener('click', closeUploadModal);
    document.getElementById('modalSampleBtn')?.addEventListener('click', () => {
      document.getElementById('modalText').value = SAMPLE_LETTER;
    });
    document.getElementById('modalFileInput')?.addEventListener('change', e => {
      const f = e.target.files[0];
      document.getElementById('modalFileName').textContent = f ? f.name : '';
    });
    // Interne aanvraag modal
    document.getElementById('internRecordBtn')?.addEventListener('click', toggleInternRecording);
    document.getElementById('internSubmitBtn')?.addEventListener('click', submitInternRequest);
    document.getElementById('internCancelBtn')?.addEventListener('click', closeInternModal);
    // PDF-upload optie binnen het intern-modal — hergebruikt de bestaande
    // handleBestandFiles flow zodat één PDF direct naar de match-resultaten leidt.
    const internPdfInput = document.getElementById('internPdfInput');
    const internPdfName  = document.getElementById('internPdfName');
    if (internPdfInput) {
      internPdfInput.addEventListener('change', (e) => {
        const files = Array.from(e.target.files || []);
        if (!files.length) return;
        if (internPdfName) internPdfName.textContent = files.length === 1 ? files[0].name : `${files.length} bestanden`;
        closeInternModal();
        handleBestandFiles(files);
        internPdfInput.value = '';
      });
    }
    // Wire question CRUD handlers up-front (idempotent) so edit/delete/add
    // work even if the user never navigates through screen-list first.
    installQuestionHandlers();
    // Wire alle filter-controls + bestand-kaart (drag-drop + click)
    installFilterHandlers();
    installBestandHandlers();
    // Guided chat (conversational secretariaat entry)
    installGuidedChat();
    // Load werklijst on first paint
    setTimeout(() => renderWerklijst(), 0);
  });

  // ====== Filter-bar (expandable) — gedeeld tussen werklijst + screen-list ======
  // Open-state per bar is in localStorage zodat power-users hun voorkeur behouden,
  // default open zodat beginners de filters direct zien.
  const FB_KEY = name => `forta.filterBar.${name}.open`;

  function setFilterBarOpen(name, open) {
    const bar = document.querySelector(`.filter-bar[data-bar="${name}"]`);
    if (!bar) return;
    bar.classList.toggle('collapsed', !open);
    const toggle = bar.querySelector('.filter-bar-toggle');
    if (toggle) toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    localStorage.setItem(FB_KEY(name), open ? '1' : '0');
  }

  function initFilterBar(name) {
    const bar = document.querySelector(`.filter-bar[data-bar="${name}"]`);
    if (!bar) return;
    const stored = localStorage.getItem(FB_KEY(name));
    // Default: dichtgeklapt. Power user die 'opent' krijgt dat de volgende keer terug.
    const open = stored === '1';
    setFilterBarOpen(name, open);
    bar.querySelector('.filter-bar-toggle')?.addEventListener('click', () => {
      const isOpen = !bar.classList.contains('collapsed');
      setFilterBarOpen(name, !isOpen);
    });
  }

  // Per-lijst "toon meer" state: standaard tonen we de eerste paar rijen.
  const LIST_PREVIEW_COUNT = 3;
  state.werklijstExpanded = false;
  state.screenExpanded = false;

  function appendMoreButton(container, hiddenCount, onClick) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'list-more-btn';
    btn.setAttribute('aria-expanded', 'false');
    btn.innerHTML = `<span>Meer aanvragen</span> <span class="list-more-count">(+${hiddenCount})</span> <span class="list-more-chev" aria-hidden="true">▸</span>`;
    btn.addEventListener('click', onClick);
    container.appendChild(btn);
  }

  function renderFilterBarSummary(name, pills, resultCount, totalCount) {
    const summary = document.getElementById(`${name === 'werklijst' ? 'werklijst' : 'screen'}Summary`);
    const reset   = document.getElementById(`${name === 'werklijst' ? 'werklijst' : 'screen'}Reset`);
    const bar     = document.querySelector(`.filter-bar[data-bar="${name}"]`);
    if (!summary) return;
    const hasFilters = pills.length > 0;
    if (bar) bar.classList.toggle('has-filters', hasFilters);
    if (!hasFilters) {
      summary.innerHTML = `<span class="fb-count">${totalCount} aanvragen</span>`;
    } else {
      const pillHtml = pills.map(p => `<span class="fb-pill">${escape(p)}</span>`).join('');
      summary.innerHTML = `${pillHtml}<span class="fb-count">${resultCount} van ${totalCount}</span>`;
    }
    if (reset) reset.hidden = !hasFilters;
  }

  // ====== Filter handlers — bind eenmalig, gebruik cache zodat klikken niet opnieuw fetched ======
  function installFilterHandlers() {
    // Werklijst: status-chips
    document.querySelectorAll('#werklijstFilters .filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        state.werklijstFilter = chip.dataset.wlFilter;
        renderWerklijst({ refetch: false });
      });
    });

    // Screen-list: kleur (heeft "Alles"), urgentie/type/belstatus (toggle) en search
    function bindScreenGroup(groupName, dimension, hasAll) {
      document.querySelectorAll(`#screenToolbar .filter-group[data-group="${groupName}"] .filter-chip`).forEach(chip => {
        chip.addEventListener('click', () => {
          const val = chip.dataset[dimension];
          if (hasAll) {
            state.screenFilter[dimension] = val;
          } else {
            state.screenFilter[dimension] = state.screenFilter[dimension] === val ? null : val;
          }
          renderScreenList({ refetch: false });
        });
      });
    }
    bindScreenGroup('kleur',     'kleur',     true);
    bindScreenGroup('urgentie',  'urgentie',  false);
    bindScreenGroup('type',      'type',      false);
    bindScreenGroup('belstatus', 'belstatus', false);
    const screenSearch = document.getElementById('screenSearch');
    if (screenSearch) screenSearch.addEventListener('input', e => {
      state.screenFilter.search = e.target.value;
      renderScreenList({ refetch: false });
    });

    // Labels: status-cycle button + zoekveld
    const labelBtn = document.getElementById('labelStatusFilter');
    if (labelBtn) {
      const cycle = ['all', 'actief', 'inactief', 'archief'];
      labelBtn.addEventListener('click', () => {
        const i = cycle.indexOf(state.labelsFilter.status);
        state.labelsFilter.status = cycle[(i + 1) % cycle.length];
        renderLabels({ refetch: false });
      });
    }
    const labelSearch = document.getElementById('labelSearch');
    if (labelSearch) labelSearch.addEventListener('input', e => {
      state.labelsFilter.search = e.target.value;
      renderLabels({ refetch: false });
    });

    // Tags: zoekveld
    const tagSearch = document.getElementById('tagSearch');
    if (tagSearch) tagSearch.addEventListener('input', e => {
      state.tagsFilter.search = e.target.value;
      renderTags({ refetch: false });
    });

    // Expandable filter-bars + reset
    initFilterBar('werklijst');
    initFilterBar('screen');

    document.getElementById('werklijstReset')?.addEventListener('click', () => {
      state.werklijstFilter = 'all';
      renderWerklijst({ refetch: false });
    });
    document.getElementById('screenReset')?.addEventListener('click', () => {
      state.screenFilter = { kleur: 'all', urgentie: null, type: null, belstatus: null, search: '' };
      const searchInput = document.getElementById('screenSearch');
      if (searchInput) searchInput.value = '';
      renderScreenList({ refetch: false });
    });
  }

  // Override the old chat/fb step functions so legacy onclicks don't break
  window.chatStep = () => {};
  window.fbStep = () => {};
  window.simulateUpload = openUploadModal;
})();
