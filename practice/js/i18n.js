/** UI strings for 14 L1s (target speech stays English). */
export const LANGS = [
  { code: 'en', name: 'English' },
  { code: 'ko', name: '한국어' },
  { code: 'zh-Hans', name: '中文' },
  { code: 'ja', name: '日本語' },
  { code: 'es', name: 'Español' },
  { code: 'hi', name: 'हिन्दी' },
  { code: 'de', name: 'Deutsch' },
  { code: 'vi', name: 'Tiếng Việt' },
  { code: 'pt-BR', name: 'Português' },
  { code: 'id', name: 'Bahasa Indonesia' },
  { code: 'fr', name: 'Français' },
  { code: 'ar', name: 'العربية' },
  { code: 'tr', name: 'Türkçe' },
  { code: 'it', name: 'Italiano' },
  { code: 'pl', name: 'Polski' },
];

const S = {
  appTitle: {
    en: 'Pronunciation practice',
    ko: '발음 연습',
    'zh-Hans': '发音练习',
    ja: '発音練習',
    es: 'Práctica de pronunciación',
    hi: 'उच्चारण अभ्यास',
    de: 'Aussprache üben',
    vi: 'Luyện phát âm',
    'pt-BR': 'Prática de pronúncia',
    id: 'Latihan pelafalan',
    fr: 'Pratique de prononciation',
    ar: 'تمرين النطق',
    tr: 'Telaffuz alıştırması',
    it: 'Pratica di pronuncia',
    pl: 'Ćwiczenie wymowy',
  },
  tabPractice: { en: 'Practice', ko: '연습', 'zh-Hans': '练习', ja: '練習', es: 'Practicar', hi: 'अभ्यास', de: 'Üben', vi: 'Luyện', 'pt-BR': 'Praticar', id: 'Latihan', fr: 'Pratique', ar: 'تمرين', tr: 'Alıştırma', it: 'Pratica', pl: 'Ćwicz' },
  tabBooks: { en: 'Books', ko: '책', 'zh-Hans': '书', ja: 'ブック', es: 'Libros', hi: 'पुस्तकें', de: 'Bücher', vi: 'Sách', 'pt-BR': 'Livros', id: 'Buku', fr: 'Livres', ar: 'كتب', tr: 'Kitaplar', it: 'Libri', pl: 'Książki' },
  tabGuides: { en: 'My Guides', ko: '내 가이드', 'zh-Hans': '我的指南', ja: 'マイガイド', es: 'Mis guías', hi: 'मेरे गाइड', de: 'Meine Guides', vi: 'Hướng dẫn', 'pt-BR': 'Meus guias', id: 'Panduan saya', fr: 'Mes guides', ar: 'أدلتي', tr: 'Rehberlerim', it: 'Le mie guide', pl: 'Moje przewodniki' },
  tabHistory: { en: 'History', ko: '기록', 'zh-Hans': '历史', ja: '履歴', es: 'Historial', hi: 'इतिहास', de: 'Verlauf', vi: 'Lịch sử', 'pt-BR': 'Histórico', id: 'Riwayat', fr: 'Historique', ar: 'السجل', tr: 'Geçmiş', it: 'Cronologia', pl: 'Historia' },
  uiLanguage: { en: 'UI language', ko: '화면 언어', 'zh-Hans': '界面语言', ja: '表示言語', es: 'Idioma', hi: 'भाषा', de: 'Sprache', vi: 'Ngôn ngữ', 'pt-BR': 'Idioma', id: 'Bahasa', fr: 'Langue', ar: 'اللغة', tr: 'Dil', it: 'Lingua', pl: 'Język' },
  typeEnglish: { en: 'Type English to practice', ko: '연습할 영어를 입력하세요', 'zh-Hans': '输入要练习的英文', ja: '練習する英文を入力', es: 'Escribe inglés para practicar', hi: 'अभ्यास के लिए अंग्रेज़ी लिखें', de: 'Englisch zum Üben eingeben', vi: 'Nhập tiếng Anh để luyện', 'pt-BR': 'Digite inglês para praticar', id: 'Ketik bahasa Inggris', fr: 'Saisissez l’anglais à pratiquer', ar: 'اكتب الإنجليزية للتمرين', tr: 'İngilizce yazın', it: 'Scrivi l’inglese da praticare', pl: 'Wpisz angielski do ćwiczenia' },
  listen: { en: 'Listen', ko: '듣기', 'zh-Hans': '听', ja: '聞く', es: 'Escuchar', hi: 'सुनें', de: 'Anhören', vi: 'Nghe', 'pt-BR': 'Ouvir', id: 'Dengar', fr: 'Écouter', ar: 'استمع', tr: 'Dinle', it: 'Ascolta', pl: 'Posłuchaj' },
  tapMic: { en: 'Tap mic · say it', ko: '마이크 · 말하기', 'zh-Hans': '点麦克风 · 说出来', ja: 'マイク · 話す', es: 'Mic · dilo', hi: 'माइक · बोलें', de: 'Mikro · sprechen', vi: 'Mic · nói', 'pt-BR': 'Mic · fale', id: 'Mic · ucapkan', fr: 'Micro · parlez', ar: 'الميك · قل', tr: 'Mik · söyle', it: 'Mic · parla', pl: 'Mik · powiedz' },
  recording: { en: 'Recording… stop when quiet', ko: '녹음 중… 조용하면 멈춤', 'zh-Hans': '录音中… 安静后停止', ja: '録音中…', es: 'Grabando…', hi: 'रिकॉर्ड…', de: 'Aufnahme…', vi: 'Đang ghi…', 'pt-BR': 'Gravando…', id: 'Merekam…', fr: 'Enregistrement…', ar: 'جاري التسجيل…', tr: 'Kayıt…', it: 'Registrazione…', pl: 'Nagrywanie…' },
  grading: { en: 'Checking pronunciation…', ko: '발음 확인 중…', 'zh-Hans': '检查发音…', ja: '発音を確認…', es: 'Comprobando…', hi: 'जाँच…', de: 'Prüfe…', vi: 'Đang chấm…', 'pt-BR': 'Verificando…', id: 'Memeriksa…', fr: 'Vérification…', ar: 'جاري التحقق…', tr: 'Kontrol…', it: 'Controllo…', pl: 'Sprawdzam…' },
  practiceHint: {
    en: 'Listen with Bella or Puck, then tap the mic and say the whole line.',
    ko: 'Bella 또는 Puck으로 듣고, 마이크를 눌러 한 줄 전체를 말하세요.',
    'zh-Hans': '用 Bella 或 Puck 听，然后点麦克风说整句。',
    ja: 'Bella/Puckで聞いてから、マイクで一文話してください。',
    es: 'Escucha con Bella o Puck y di toda la frase.',
    hi: 'Bella/Puck से सुनें, फिर पूरी पंक्ति बोलें।',
    de: 'Mit Bella oder Puck anhören, dann die ganze Zeile sprechen.',
    vi: 'Nghe Bella/Puck rồi nói cả câu.',
    'pt-BR': 'Ouça com Bella ou Puck e fale a frase inteira.',
    id: 'Dengar Bella/Puck lalu ucapkan seluruh kalimat.',
    fr: 'Écoutez avec Bella ou Puck puis dites toute la phrase.',
    ar: 'استمع ثم قل الجملة كاملة.',
    tr: 'Dinleyin ve tüm cümleyi söyleyin.',
    it: 'Ascolta con Bella o Puck e pronuncia tutta la frase.',
    pl: 'Posłuchaj i wypowiedz całe zdanie.',
  },
  booksHint: { en: 'Pick a phrase pack. Say the English line.', ko: '문장 팩을 고르세요. 영어로 말합니다.', 'zh-Hans': '选择短语包，说英文。', ja: 'フレーズを選び、英文を話します。', es: 'Elige un pack y di el inglés.', hi: 'पैक चुनें, अंग्रेज़ी बोलें।', de: 'Pack wählen, Englisch sprechen.', vi: 'Chọn bộ cụm, nói tiếng Anh.', 'pt-BR': 'Escolha um pack e fale em inglês.', id: 'Pilih paket, ucapkan bahasa Inggris.', fr: 'Choisissez un pack et dites l’anglais.', ar: 'اختر حزمة وقل الإنجليزية.', tr: 'Paket seçin, İngilizce söyleyin.', it: 'Scegli un pack e parla in inglese.', pl: 'Wybierz pakiet i mów po angielsku.' },
  guidesHint: { en: 'Up to 200 guides × 20 sentences (saved on this device).', ko: '가이드 200개 × 20문장 (기기에 저장)', 'zh-Hans': '最多200个指南×20句', ja: '200ガイド×20文', es: 'Hasta 200 guías × 20 frases', hi: '200×20 वाक्य', de: 'Bis 200 Guides × 20 Sätze', vi: '200 hướng dẫn × 20 câu', 'pt-BR': 'Até 200 guias × 20 frases', id: '200 panduan × 20 kalimat', fr: '200 guides × 20 phrases', ar: '200 دليل × 20 جملة', tr: '200 rehber × 20 cümle', it: '200 guide × 20 frasi', pl: '200 przewodników × 20 zdań' },
  newGuide: { en: 'New guide', ko: '새 가이드', 'zh-Hans': '新指南', ja: '新規', es: 'Nueva guía', hi: 'नया', de: 'Neu', vi: 'Mới', 'pt-BR': 'Novo', id: 'Baru', fr: 'Nouveau', ar: 'جديد', tr: 'Yeni', it: 'Nuova', pl: 'Nowy' },
  saveGuide: { en: 'Save guide', ko: '저장', 'zh-Hans': '保存', ja: '保存', es: 'Guardar', hi: 'सहेजें', de: 'Speichern', vi: 'Lưu', 'pt-BR': 'Salvar', id: 'Simpan', fr: 'Enregistrer', ar: 'حفظ', tr: 'Kaydet', it: 'Salva', pl: 'Zapisz' },
  historySearch: { en: 'Search history', ko: '기록 검색', 'zh-Hans': '搜索', ja: '検索', es: 'Buscar', hi: 'खोज', de: 'Suchen', vi: 'Tìm', 'pt-BR': 'Buscar', id: 'Cari', fr: 'Rechercher', ar: 'بحث', tr: 'Ara', it: 'Cerca', pl: 'Szukaj' },
  exportJson: { en: 'Export JSON', ko: 'JSON 내보내기', 'zh-Hans': '导出 JSON', ja: 'JSON', es: 'JSON', hi: 'JSON', de: 'JSON', vi: 'JSON', 'pt-BR': 'JSON', id: 'JSON', fr: 'JSON', ar: 'JSON', tr: 'JSON', it: 'JSON', pl: 'JSON' },
  exportCsv: { en: 'Export CSV', ko: 'CSV 내보내기', 'zh-Hans': '导出 CSV', ja: 'CSV', es: 'CSV', hi: 'CSV', de: 'CSV', vi: 'CSV', 'pt-BR': 'CSV', id: 'CSV', fr: 'CSV', ar: 'CSV', tr: 'CSV', it: 'CSV', pl: 'CSV' },
  backDay4: { en: '← Day 4 sheets', ko: '← Day 4 시트', 'zh-Hans': '← Day 4', ja: '← Day 4', es: '← Day 4', hi: '← Day 4', de: '← Day 4', vi: '← Day 4', 'pt-BR': '← Day 4', id: '← Day 4', fr: '← Day 4', ar: '← Day 4', tr: '← Day 4', it: '← Day 4', pl: '← Day 4' },
  passLine: { en: 'PASS · average {pct}%', ko: '통과 · 평균 {pct}%', 'zh-Hans': '通过 · 平均 {pct}%', ja: '合格 · 平均 {pct}%', es: 'APROBADO · {pct}%', hi: 'पास · {pct}%', de: 'BESTANDEN · {pct}%', vi: 'ĐẠT · {pct}%', 'pt-BR': 'APROVADO · {pct}%', id: 'LULUS · {pct}%', fr: 'RÉUSSI · {pct}%', ar: 'نجاح · {pct}%', tr: 'GEÇTİ · {pct}%', it: 'OK · {pct}%', pl: 'ZALICZONE · {pct}%' },
  failLine: { en: 'Try again · average {pct}%', ko: '다시 · 평균 {pct}%', 'zh-Hans': '再试 · 平均 {pct}%', ja: '再試行 · 平均 {pct}%', es: 'Otra vez · {pct}%', hi: 'फिर · {pct}%', de: 'Nochmal · {pct}%', vi: 'Thử lại · {pct}%', 'pt-BR': 'De novo · {pct}%', id: 'Lagi · {pct}%', fr: 'Encore · {pct}%', ar: 'مرة أخرى · {pct}%', tr: 'Tekrar · {pct}%', it: 'Riprova · {pct}%', pl: 'Jeszcze · {pct}%' },
  micDenied: { en: 'Microphone blocked. Allow mic in browser settings.', ko: '마이크가 차단됨. 브라우저에서 허용하세요.', 'zh-Hans': '麦克风被阻止', ja: 'マイクがブロック', es: 'Micrófono bloqueado', hi: 'माइक ब्लॉक', de: 'Mikro blockiert', vi: 'Mic bị chặn', 'pt-BR': 'Microfone bloqueado', id: 'Mik diblokir', fr: 'Micro bloqué', ar: 'الميكروفون محظور', tr: 'Mik kapalı', it: 'Microfono bloccato', pl: 'Mik zablokowany' },
  emptyText: { en: 'Type or pick a sentence first.', ko: '먼저 문장을 입력하거나 고르세요.', 'zh-Hans': '先输入或选择句子', ja: '文を入力または選択', es: 'Escribe o elige una frase', hi: 'पहले वाक्य लिखें', de: 'Zuerst Satz wählen', vi: 'Nhập hoặc chọn câu', 'pt-BR': 'Digite ou escolha', id: 'Ketik atau pilih', fr: 'Saisissez une phrase', ar: 'اكتب جملة', tr: 'Cümle seçin', it: 'Scrivi una frase', pl: 'Wpisz zdanie' },
  basicListen: {
    en: 'Listen now with the voices above. The sound checker is still loading — mic scoring starts when it is ready.',
    ko: '위 목소리로 먼저 들으세요. 발음 확인기가 아직 로딩 중입니다 — 준비되면 마이크 채점이 시작됩니다.',
  },
  checkerReady: { en: 'Ready — tap the mic and say the line.', ko: '준비됨 — 마이크를 눌러 말하세요.' },
  checkerFailed: {
    en: 'Sound checker did not load. You can still listen. Tap Retry below or refresh the page.',
    ko: '발음 확인기를 불러오지 못했습니다. 듣기는 가능합니다. 아래 재시도 또는 새로고침.',
  },
  retryChecker: { en: 'Retry sound checker', ko: '발음 확인기 다시 시도' },
  gradingWait: { en: 'Sound checker still loading… try Listen, or wait a moment.', ko: '발음 확인기 로딩 중… 듣기를 사용하거나 잠시 기다리세요.' },
  historyStats: { en: '{n} attempts · {pass} passed', ko: '시도 {n} · 통과 {pass}', 'zh-Hans': '{n} 次 · 通过 {pass}', ja: '{n} 回 · 合格 {pass}', es: '{n} intentos · {pass} ok', hi: '{n} · {pass}', de: '{n} · {pass} bestanden', vi: '{n} · {pass} đạt', 'pt-BR': '{n} · {pass}', id: '{n} · {pass}', fr: '{n} · {pass}', ar: '{n} · {pass}', tr: '{n} · {pass}', it: '{n} · {pass}', pl: '{n} · {pass}' },
};

const STORAGE_KEY = 'pronounce-practice-ui-lang';

export function getUiLang() {
  try {
    return localStorage.getItem(STORAGE_KEY) || 'en';
  } catch (_) {
    return 'en';
  }
}

export function setUiLang(code) {
  try {
    localStorage.setItem(STORAGE_KEY, code);
  } catch (_) {}
}

export function t(key, lang, vars = {}) {
  const map = S[key] || {};
  let s = map[lang] || map.en || key;
  Object.keys(vars).forEach((k) => {
    s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k]));
  });
  return s;
}

export function applyI18n(lang) {
  document.documentElement.lang = lang === 'zh-Hans' ? 'zh' : lang.split('-')[0];
  document.querySelectorAll('[data-i18n]').forEach((el) => {
    const key = el.getAttribute('data-i18n');
    if (key) el.textContent = t(key, lang);
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const key = el.getAttribute('data-i18n-placeholder');
    if (key) el.placeholder = t(key, lang);
  });
}

export function fillLangSelect(select, lang) {
  select.innerHTML = '';
  LANGS.forEach((L) => {
    const o = document.createElement('option');
    o.value = L.code;
    o.textContent = L.name;
    if (L.code === lang) o.selected = true;
    select.appendChild(o);
  });
}
