// MYM 스케줄 위젯 - Scriptable (iOS)
// 설치법: Scriptable 앱 설치 → 이 코드 복사 → 홈화면 위젯 추가

const API_URL = 'https://script.google.com/macros/s/AKfycbynNDWxLMSXZVxO7xscWw-h4R7mpougxeP8tBH5wzSRDBDq0fpO4KOsocfvuz20U1MV/exec';
const API_KEY = 'MYM_K9xpR7vL2024';
const APP_URL = 'https://encorebear.github.io/mym-schedule/';

const ACTORS = {
  'LMH': new Color('#60a5fa'), 'LSJ': new Color('#f472b6'),
  'KM': new Color('#a78bfa'),  'KMJ': new Color('#fbbf24'),
  'LSH': new Color('#34d399'), 'PJS': new Color('#f87171')
};
const TYPES = {'촬영':'🎬','미팅':'📋','행사':'🎪','인터뷰':'🎤','이동':'✈️','홍보':'📸','광고':'📢','기타':'📌','비공개':'🔒'};

const BG = new Color('#0f1117');
const BG2 = new Color('#161b27');
const TEXT = new Color('#e2e8f0');
const TEXT2 = new Color('#94a3b8');
const TEXT3 = new Color('#64748b');
const ACCENT = new Color('#3b82f6');

function pad(n) { return String(n).padStart(2, '0'); }
function dateKey(d) { return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; }

async function fetchEvents() {
  try {
    const req = new Request(API_URL + '?action=load&key=' + API_KEY + '&t=' + Date.now());
    const data = await req.loadJSON();
    return data.events || [];
  } catch(e) { return []; }
}

async function createWidget() {
  const events = await fetchEvents();
  const now = new Date();
  const todayKey = dateKey(now);
  const DOW = ['일','월','화','수','목','금','토'];

  const todayEvents = events
    .filter(e => e.date === todayKey)
    .sort((a, b) => (a.startTime || '').localeCompare(b.startTime || ''));

  // Tomorrow
  const tmr = new Date(now); tmr.setDate(tmr.getDate() + 1);
  const tmrKey = dateKey(tmr);
  const tmrEvents = events.filter(e => e.date === tmrKey);

  const w = new ListWidget();
  w.backgroundColor = BG;
  w.url = APP_URL;
  w.setPadding(12, 14, 12, 14);

  // Header
  const header = w.addStack();
  header.centerAlignContent();
  const title = header.addText('MYM 스케줄');
  title.font = Font.boldSystemFont(13);
  title.textColor = ACCENT;
  header.addSpacer();
  const dateText = header.addText(`${now.getMonth()+1}/${now.getDate()} (${DOW[now.getDay()]})`);
  dateText.font = Font.mediumSystemFont(11);
  dateText.textColor = TEXT3;

  w.addSpacer(8);

  // Today label
  const todayLabel = w.addText('오늘');
  todayLabel.font = Font.boldSystemFont(10);
  todayLabel.textColor = TEXT3;

  w.addSpacer(4);

  if (todayEvents.length === 0) {
    const none = w.addText('일정 없음');
    none.font = Font.systemFont(12);
    none.textColor = TEXT3;
  } else {
    const maxShow = config.widgetFamily === 'small' ? 3 : 5;
    todayEvents.slice(0, maxShow).forEach(ev => {
      const row = w.addStack();
      row.centerAlignContent();
      row.spacing = 6;

      // Color bar
      const bar = row.addStack();
      bar.backgroundColor = ACTORS[ev.actor] || ACCENT;
      bar.size = new Size(3, 16);
      bar.cornerRadius = 2;

      // Content
      const info = row.addStack();
      info.layoutVertically();

      const emoji = TYPES[ev.type] || '';
      const titleText = info.addText(`${emoji} ${ev.title}`);
      titleText.font = Font.semiboldSystemFont(12);
      titleText.textColor = TEXT;
      titleText.lineLimit = 1;

      const time = ev.startTime || '';
      const meta = `${ev.actor}${time ? ' · ' + time : ''}`;
      const metaText = info.addText(meta);
      metaText.font = Font.systemFont(9);
      metaText.textColor = TEXT3;

      w.addSpacer(3);
    });
    if (todayEvents.length > maxShow) {
      const more = w.addText(`+${todayEvents.length - maxShow}개 더`);
      more.font = Font.systemFont(9);
      more.textColor = TEXT3;
    }
  }

  // Tomorrow preview (medium/large only)
  if (config.widgetFamily !== 'small' && tmrEvents.length > 0) {
    w.addSpacer(6);
    const tmrLabel = w.addText(`내일 (${tmrEvents.length}개)`);
    tmrLabel.font = Font.boldSystemFont(9);
    tmrLabel.textColor = TEXT3;
    w.addSpacer(2);
    tmrEvents.slice(0, 2).forEach(ev => {
      const emoji = TYPES[ev.type] || '';
      const t = w.addText(`${emoji} ${ev.actor} · ${ev.title}`);
      t.font = Font.systemFont(10);
      t.textColor = TEXT2;
      t.lineLimit = 1;
    });
  }

  return w;
}

const widget = await createWidget();
if (config.runsInWidget) {
  Script.setWidget(widget);
} else {
  widget.presentMedium();
}
Script.complete();
