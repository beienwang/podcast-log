/* ==================================================================
   app.js — 播客收听档案
   纯原生 JS，无依赖。数据保存在 localStorage。
   ================================================================== */

(function () {
  'use strict';

  /* ---------------- 常量 & 状态 ---------------- */
  var STORAGE_KEY = 'podcast-log.v1';
  var THEME_KEY = 'podcast-log.theme';
  var MAX_TAGS = 8;

  var state = {
    entries: [],
    isSample: false,
    q: '',
    show: null,
    tag: null,
    sort: 'recent',
    editingId: null,
    flashId: null
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };

  /* ---------------- 小工具 ---------------- */
  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function firstChar(str) {
    var chars = Array.from(String(str || '·'));
    return chars[0] || '·';
  }

  // 由节目名生成稳定色相，用于字母方块
  function hue(str) {
    var h = 0;
    var s = String(str || '');
    for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360;
    return h;
  }

  function uid() {
    return 'e-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function isoOf(d) {
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  function parseDate(iso) {
    var m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(String(iso || '').trim());
    if (!m) return null;
    var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return isNaN(d.getTime()) ? null : d;
  }

  function timeOf(iso) {
    var d = parseDate(iso);
    return d ? d.getTime() : 0;
  }

  function fmtDate(iso) {
    var d = parseDate(iso);
    if (!d) return '日期未填';
    var now = new Date();
    var prefix = d.getFullYear() === now.getFullYear() ? '' : d.getFullYear() + ' 年 ';
    return prefix + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日';
  }

  function fmtDuration(min) {
    var m = Math.round(Number(min) || 0);
    if (!m) return '未填时长';
    if (m < 60) return m + ' 分钟';
    var h = Math.floor(m / 60);
    var rest = m % 60;
    return rest ? h + ' 小时 ' + rest + ' 分' : h + ' 小时';
  }

  function fmtHours(min) {
    var h = (Number(min) || 0) / 60;
    var rounded = Math.round(h * 10) / 10;
    return (rounded % 1 === 0 ? rounded : rounded.toFixed(1)) + ' 小时';
  }

  function clampNumber(v, min, max, fallback) {
    var n = Number(v);
    if (!isFinite(n)) return fallback;
    return Math.min(max, Math.max(min, Math.round(n)));
  }

  function normRating(v) {
    var n = Number(v);
    if (!isFinite(n) || n <= 0) return 3;
    return Math.min(5, Math.max(0.5, Math.round(n * 2) / 2));
  }

  function safeUrl(u) {
    if (!u) return '';
    try {
      var url = new URL(String(u), window.location.href);
      return (url.protocol === 'http:' || url.protocol === 'https:') ? url.href : '';
    } catch (err) {
      return '';
    }
  }

  function starsHtml(rating) {
    var r = Number(rating) || 0;
    var pct = (r / 5) * 100;
    return '<span class="stars" role="img" aria-label="评分 ' + r + ' 分（满分 5 分）">' +
      '<span class="stars__bg" aria-hidden="true">★★★★★</span>' +
      '<span class="stars__fg" aria-hidden="true" style="width:' + pct + '%">★★★★★</span>' +
      '</span>';
  }

  function parseTags(value) {
    if (Array.isArray(value)) return value.map(String);
    return String(value || '').split(/[,，、;；\s]+/);
  }

  function parseList(value) {
    if (Array.isArray(value)) return value.map(String);
    return String(value || '').split(/\r?\n/);
  }

  /* ---------------- 数据归一化 ---------------- */
  function normalize(raw) {
    if (!raw || typeof raw !== 'object') return null;
    var show = String(raw.show == null ? '' : raw.show).trim();
    var episode = String(raw.episode == null ? '' : raw.episode).trim();
    if (!show && !episode) return null;

    var date = '';
    var direct = parseDate(raw.date);
    if (direct) {
      date = isoOf(direct);
    } else {
      var t = Date.parse(raw.date);
      if (!isNaN(t)) date = isoOf(new Date(t));
    }

    return {
      id: raw.id ? String(raw.id) : uid(),
      show: show || '未命名节目',
      host: String(raw.host == null ? '' : raw.host).trim(),
      episode: episode || '（未填标题）',
      date: date || isoOf(new Date()),
      duration: clampNumber(raw.duration, 0, 600, 0),
      rating: normRating(raw.rating),
      tags: parseTags(raw.tags).map(function (t) { return t.trim(); }).filter(Boolean).slice(0, MAX_TAGS),
      url: String(raw.url == null ? '' : raw.url).trim(),
      hostNotes: String(raw.hostNotes == null ? '' : raw.hostNotes).trim(),
      takeaways: parseList(raw.takeaways)
        .map(function (t) { return t.trim().replace(/^[-*•·]\s*/, ''); })
        .filter(Boolean)
        .slice(0, 10),
      quote: String(raw.quote == null ? '' : raw.quote).trim()
    };
  }

  /* ---------------- 存取 ---------------- */
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 1,
        isSample: state.isSample,
        savedAt: new Date().toISOString(),
        entries: state.entries
      }));
    } catch (err) {
      console.warn(err);
      toast('浏览器不允许本地存储，这次修改不会保留');
    }
  }

  function load() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var data = JSON.parse(raw);
        var arr = Array.isArray(data) ? data : (data && data.entries);
        if (Array.isArray(arr)) {
          var entries = arr.map(normalize).filter(Boolean);
          if (entries.length) {
            state.entries = entries;
            state.isSample = !!(data && data.isSample);
            return;
          }
        }
      }
    } catch (err) {
      console.warn('读取本地数据失败，改用示例数据', err);
    }
    state.entries = (window.SEED_EPISODES || []).map(normalize).filter(Boolean);
    state.isSample = true;
  }

  /* ---------------- 统计 ---------------- */
  function channelStats(list) {
    var map = new Map();
    list.forEach(function (e) {
      var key = e.show;
      var c = map.get(key);
      if (!c) {
        c = { show: key, host: '', entries: [], minutes: 0, ratingSum: 0, tags: new Map(), last: '' };
        map.set(key, c);
      }
      if (!c.host && e.host) c.host = e.host;
      c.entries.push(e);
      c.minutes += e.duration || 0;
      c.ratingSum += e.rating || 0;
      (e.tags || []).forEach(function (t) {
        c.tags.set(t, (c.tags.get(t) || 0) + 1);
      });
      if ((e.date || '') > c.last) c.last = e.date || '';
    });

    var arr = Array.from(map.values()).map(function (c) {
      var count = c.entries.length;
      var avg = count ? c.ratingSum / count : 0;
      var topTags = Array.from(c.tags.entries())
        .sort(function (a, b) { return b[1] - a[1] || a[0].localeCompare(b[0], 'zh'); })
        .slice(0, 3)
        .map(function (p) { return p[0]; });
      return {
        show: c.show,
        host: c.host,
        count: count,
        minutes: c.minutes,
        avg: avg,
        last: c.last,
        topTags: topTags,
        entries: c.entries
      };
    });

    var maxCount = Math.max.apply(null, [1].concat(arr.map(function (c) { return c.count; })));
    var maxMin = Math.max.apply(null, [1].concat(arr.map(function (c) { return c.minutes; })));

    arr.forEach(function (c) {
      // 偏好指数：集数 40% + 平均评分 35% + 时长 25%
      c.score = Math.round(40 * (c.count / maxCount) + 35 * (c.avg / 5) + 25 * (c.minutes / maxMin));
    });

    arr.sort(function (a, b) {
      return b.score - a.score || b.minutes - a.minutes || a.show.localeCompare(b.show, 'zh');
    });
    return arr;
  }

  function tagStats(list) {
    var map = new Map();
    list.forEach(function (e) {
      (e.tags || []).forEach(function (t) {
        map.set(t, (map.get(t) || 0) + 1);
      });
    });
    return Array.from(map.entries())
      .map(function (p) { return { tag: p[0], count: p[1] }; })
      .sort(function (a, b) { return b.count - a.count || a.tag.localeCompare(b.tag, 'zh'); });
  }

  function whyText(c) {
    var ratingLine =
      c.avg >= 4.6 ? '几乎每期都被你标成心头好' :
      c.avg >= 4.2 ? '整体很稳，偶尔会跳着听' :
      c.avg >= 3.8 ? '选题对你胃口，节奏需要挑' :
      '偶尔打开，还没完全对上电波';
    var tagLine = c.topTags.length
      ? '常出现的主题是 ' + c.topTags.map(function (t) { return '「' + t + '」'; }).join('、') + '。'
      : '还没有打标签，随手补几个会更准。';
    return '投入 ' + fmtHours(c.minutes) + '、平均 ' + c.avg.toFixed(1) + ' 分，' + ratingLine + '。' + tagLine;
  }

  /* ---------------- 渲染：首屏 ---------------- */
  function renderStats() {
    var list = state.entries;
    var totalMin = list.reduce(function (s, e) { return s + (e.duration || 0); }, 0);
    var avg = list.length ? list.reduce(function (s, e) { return s + (e.rating || 0); }, 0) / list.length : 0;
    var channels = channelStats(list);
    var tags = tagStats(list);
    var now = new Date();
    var thisMonth = list.filter(function (e) {
      var d = parseDate(e.date);
      return d && d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
    var fullMarks = list.filter(function (e) { return e.rating >= 5; }).length;

    var html = [
      statCard('记录', list.length, '期', thisMonth ? '本月 +' + thisMonth + ' 期' : '本月还没有新记录'),
      statCard('累计收听', (Math.round(totalMin / 60 * 10) / 10), '小时', list.length ? '平均每期 ' + Math.round(totalMin / list.length) + ' 分钟' : '—'),
      statCard('平均评分', list.length ? avg.toFixed(1) : '—', '/ 5', fullMarks ? '给过 ' + fullMarks + ' 次满分' : '还没有满分记录'),
      statCard('频道', channels.length, '个', tags.length ? tags.length + ' 个主题标签' : '还没有主题标签')
    ].join('');

    $('#stats').innerHTML = html;
    $('#tagMeta').textContent = tags.length ? tags.length + ' 个标签 · ' + tags.reduce(function (s, t) { return s + t.count; }, 0) + ' 次出现' : '还没有标签';

    // 首屏文案
    var sorted = list.slice().sort(function (a, b) { return timeOf(a.date) - timeOf(b.date); });
    if (sorted.length) {
      $('#heroRange').textContent = fmtDate(sorted[0].date) + ' — ' + fmtDate(sorted[sorted.length - 1].date);
    } else {
      $('#heroRange').textContent = '还没有记录';
    }

    if (list.length > 1) {
      var spanDays = Math.max(1, (timeOf(sorted[sorted.length - 1].date) - timeOf(sorted[0].date)) / 86400000);
      var perWeek = list.length / (spanDays / 7);
      $('#heroPace').textContent = '平均每周 ' + (perWeek >= 10 ? Math.round(perWeek) : perWeek.toFixed(1)) + ' 期';
    } else {
      $('#heroPace').textContent = '慢慢积累';
    }
  }

  function statCard(k, value, unit, sub) {
    return '<div class="stat"><span class="stat__k">' + esc(k) + '</span>' +
      '<span class="stat__v"><span class="stat__n">' + esc(value) + '</span>' +
      (unit ? '<span class="stat__u">' + esc(unit) + '</span>' : '') + '</span>' +
      '<span class="stat__sub">' + esc(sub) + '</span></div>';
  }

  function renderWave() {
    var bars = [];
    var n = 52;
    for (var i = 0; i < n; i++) {
      var v = Math.abs(Math.sin(i * 0.55) + 0.55 * Math.sin(i * 1.7 + 1.2)) / 1.5;
      var h = 18 + v * 78;
      bars.push('<span style="height:' + Math.round(h) + '%"></span>');
    }
    $('#wave').innerHTML = bars.join('');
  }

  /* ---------------- 渲染：频道 ---------------- */
  function renderChannels() {
    var list = channelStats(state.entries);
    var grid = $('#channelGrid');
    var summary = $('#channelSummary');

    if (!list.length) {
      summary.innerHTML = '还没有记录，先<strong>记一笔</strong>，偏好会自己浮出来。';
      grid.innerHTML = '';
      return;
    }

    var maxCount = list[0];
    list.forEach(function (c) { if (c.count > maxCount.count) maxCount = c; });
    var bestRated = list.slice().sort(function (a, b) { return b.avg - a.avg || b.count - a.count; })[0];
    var recent = state.entries.slice().sort(function (a, b) { return timeOf(b.date) - timeOf(a.date); }).slice(0, 90);
    var cutoff = Date.now() - 90 * 86400000;
    var recentCount = recent.filter(function (e) { return timeOf(e.date) >= cutoff; }).length;

    summary.innerHTML =
      '一共 <strong>' + state.entries.length + ' 期</strong>记录，分布在 <strong>' + list.length + ' 个频道</strong>。' +
      '打开最多的是 <strong>' + esc(maxCount.show) + '</strong>（' + maxCount.count + ' 期，' + fmtHours(maxCount.minutes) + '）；' +
      '平均评分最高的是 <strong>' + esc(bestRated.show) + '</strong>（' + bestRated.avg.toFixed(1) + ' 分）。' +
      '最近 90 天听了 ' + recentCount + ' 期。';

    grid.innerHTML = list.map(function (c, i) {
      return '<article class="channel' + (i === 0 ? ' channel--top' : '') + '">' +
        '<div class="channel__top">' +
          '<span class="monogram" style="--mh:' + hue(c.show) + '" aria-hidden="true">' + esc(firstChar(c.show)) + '</span>' +
          '<div class="channel__name"><h3 title="' + esc(c.show) + '">' + esc(c.show) + '</h3>' +
          '<p>' + esc(c.host || '主播未填') + ' · ' + c.count + ' 期</p></div>' +
          '<div class="channel__score"><b>' + c.score + '</b><i>/100</i></div>' +
        '</div>' +
        '<div class="meter" role="img" aria-label="偏好指数 ' + c.score + ' 分（满分 100）"><span style="--v:' + c.score + '%"></span></div>' +
        '<dl class="channel__stats">' +
          '<div><dt>累计</dt><dd>' + esc(fmtHours(c.minutes)) + '</dd></div>' +
          '<div><dt>均分</dt><dd>' + c.avg.toFixed(1) + '</dd></div>' +
          '<div><dt>最近</dt><dd>' + esc(fmtDate(c.last)) + '</dd></div>' +
        '</dl>' +
        '<div class="channel__tags">' +
          (c.topTags.length
            ? c.topTags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('')
            : '<span class="tag">未打标签</span>') +
        '</div>' +
        '<p class="channel__why">' + esc(whyText(c)) + '</p>' +
      '</article>';
    }).join('');
  }

  /* ---------------- 渲染：主题 & 节奏 ---------------- */
  function renderTopics() {
    var tags = tagStats(state.entries);
    var cloud = $('#tagCloud');

    if (!tags.length) {
      cloud.innerHTML = '<p class="hint">还没有主题标签。在新增记录时填上「历史、产品、投资」之类的词，这里就会长出来。</p>';
      return;
    }

    var top = tags.slice(0, 24);
    var min = Math.min.apply(null, top.map(function (t) { return t.count; }));
    var max = Math.max.apply(null, top.map(function (t) { return t.count; }));
    var span = Math.max(1, max - min);

    cloud.innerHTML = top.map(function (t) {
      var w = ((t.count - min) / span) * 6;
      var active = state.tag === t.tag;
      return '<button type="button" class="tag' + (active ? ' is-active' : '') + '" ' +
        'style="--w:' + w.toFixed(1) + '" data-tag="' + esc(t.tag) + '" ' +
        'aria-pressed="' + (active ? 'true' : 'false') + '" title="筛选包含「' + esc(t.tag) + '」的记录">' +
        esc(t.tag) + '<b>' + t.count + '</b></button>';
    }).join('');
  }

  function renderChart() {
    var now = new Date();
    var months = [];
    for (var i = 5; i >= 0; i--) {
      var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      months.push({
        key: d.getFullYear() + '-' + d.getMonth(),
        label: (d.getMonth() + 1) + ' 月',
        count: 0,
        minutes: 0,
        isNow: i === 0
      });
    }

    state.entries.forEach(function (e) {
      var d = parseDate(e.date);
      if (!d) return;
      var key = d.getFullYear() + '-' + d.getMonth();
      for (var j = 0; j < months.length; j++) {
        if (months[j].key === key) {
          months[j].count += 1;
          months[j].minutes += e.duration || 0;
          break;
        }
      }
    });

    var max = Math.max.apply(null, [1].concat(months.map(function (m) { return m.minutes; })));
    var totalCount = months.reduce(function (s, m) { return s + m.count; }, 0);

    $('#chartMeta').textContent = totalCount ? '半年 ' + totalCount + ' 期 · ' + fmtHours(months.reduce(function (s, m) { return s + m.minutes; }, 0)) : '暂无数据';

    $('#chart').innerHTML = months.map(function (m) {
      var h = m.minutes ? Math.max(8, Math.round((m.minutes / max) * 100)) : 2;
      return '<div class="chart__col">' +
        '<div class="chart__bar" data-empty="' + (m.minutes ? 'false' : 'true') + '" style="--h:' + h + '%" ' +
          'role="img" aria-label="' + esc(m.label + '：' + m.count + ' 期，' + fmtDuration(m.minutes)) + '" ' +
          'title="' + esc(m.label + '：' + m.count + ' 期，' + fmtDuration(m.minutes)) + '">' +
          (m.count ? '<span class="chart__val">' + m.count + ' 期</span>' : '') +
        '</div>' +
        '<span class="chart__label' + (m.isNow ? ' is-now' : '') + '">' + esc(m.label) + '</span>' +
      '</div>';
    }).join('');
  }

  /* ---------------- 渲染：筛选栏 & 记录 ---------------- */
  function renderChips() {
    var channels = channelStats(state.entries);

    // 频道被删空后，别让筛选条件停留在不存在的地方
    if (state.show && !channels.some(function (c) { return c.show === state.show; })) {
      state.show = null;
    }

    var html = '<button type="button" class="chip" data-show="" aria-pressed="' + (state.show ? 'false' : 'true') + '">全部 ' + state.entries.length + '</button>';

    if (state.tag) {
      html += '<button type="button" class="chip" data-tag-clear="1" aria-pressed="true" title="清除标签筛选">' +
        '标签：' + esc(state.tag) + ' ✕</button>';
    }

    html += channels.map(function (c) {
      var active = state.show === c.show;
      return '<button type="button" class="chip" data-show="' + esc(c.show) + '" aria-pressed="' + (active ? 'true' : 'false') + '">' +
        esc(c.show) + ' ' + c.count + '</button>';
    }).join('');

    $('#channelFilter').innerHTML = html;
  }

  function matches(e) {
    if (state.show && e.show !== state.show) return false;
    if (state.tag && (e.tags || []).indexOf(state.tag) === -1) return false;
    if (!state.q) return true;
    var hay = [
      e.show, e.host, e.episode, e.hostNotes, e.quote,
      (e.tags || []).join(' '),
      (e.takeaways || []).join(' ')
    ].join(' ').toLowerCase();
    return hay.indexOf(state.q) !== -1;
  }

  function renderLog() {
    var list = state.entries.filter(matches);

    if (state.sort === 'rating') {
      list.sort(function (a, b) { return b.rating - a.rating || timeOf(b.date) - timeOf(a.date); });
    } else if (state.sort === 'duration') {
      list.sort(function (a, b) { return (b.duration || 0) - (a.duration || 0); });
    } else if (state.sort === 'show') {
      list.sort(function (a, b) { return a.show.localeCompare(b.show, 'zh') || timeOf(b.date) - timeOf(a.date); });
    } else {
      list.sort(function (a, b) { return timeOf(b.date) - timeOf(a.date); });
    }

    var totalMin = list.reduce(function (s, e) { return s + (e.duration || 0); }, 0);
    var filtered = !!(state.q || state.show || state.tag);
    $('#logCount').textContent = list.length
      ? (filtered ? '筛选出 ' + list.length + ' 期 · ' : '共 ' + list.length + ' 期 · ') + fmtHours(totalMin)
      : '没有匹配的记录';

    var grid = $('#logGrid');

    if (!list.length) {
      grid.innerHTML = state.entries.length
        ? '<div class="empty"><span class="empty__icon" aria-hidden="true">◎</span>' +
          '<h3>没有匹配的记录</h3><p>换个关键词，或者清掉筛选条件再试试。</p>' +
          '<button class="btn btn--ghost" type="button" data-act="reset">清除筛选</button></div>'
        : '<div class="empty"><span class="empty__icon" aria-hidden="true">◍</span>' +
          '<h3>这里是空的</h3><p>从第一笔开始：听完一期播客，顺手记下主播说了什么、你带走了什么。</p>' +
          '<button class="btn btn--primary" type="button" data-act="new">＋ 记第一笔</button></div>';
      return;
    }

    grid.innerHTML = list.map(cardHtml).join('');
  }

  function cardHtml(e) {
    var url = safeUrl(e.url);
    var hasNotes = !!(e.hostNotes || (e.takeaways && e.takeaways.length) || e.quote);

    var tagHtml = (e.tags && e.tags.length)
      ? '<div class="tags">' + e.tags.map(function (t) { return '<span class="tag">' + esc(t) + '</span>'; }).join('') + '</div>'
      : '';

    var epTitle = url
      ? '<a href="' + esc(url) + '" target="_blank" rel="noopener noreferrer">' + esc(e.episode) + '</a>'
      : esc(e.episode);

    var notesHtml = '';
    if (hasNotes) {
      var body = '';
      // 短笔记在卡片摘要里已经露全了，展开时只在笔记较长时重复一次完整版
      if (e.hostNotes && e.hostNotes.length > 110) {
        body += '<div><span class="notes__label">主播笔记（完整）</span><p class="notes__host">' + esc(e.hostNotes) + '</p></div>';
      }
      if (e.takeaways && e.takeaways.length) {
        body += '<div><span class="notes__label">我的收获</span><ul class="notes__list">' +
          e.takeaways.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></div>';
      }
      if (e.quote) {
        body += '<blockquote class="quote">「' + esc(e.quote) + '」</blockquote>';
      }
      notesHtml = '<details class="notes">' +
        '<summary><svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>' +
        '主播笔记与收获</summary>' +
        '<div class="notes__body">' + body + '</div>' +
      '</details>';
    }

    return '<article class="card' + (state.flashId === e.id ? ' is-new' : '') + '" data-id="' + esc(e.id) + '">' +
      '<header class="card__head">' +
        '<div class="card__show">' +
          '<span class="monogram" style="--mh:' + hue(e.show) + '" aria-hidden="true">' + esc(firstChar(e.show)) + '</span>' +
          '<div><h3 title="' + esc(e.show) + '">' + esc(e.show) + '</h3><p>' + esc(e.host || '主播未填') + '</p></div>' +
        '</div>' +
        '<div class="card__meta">' + starsHtml(e.rating) + '<span class="dur">' + esc(fmtDuration(e.duration)) + '</span></div>' +
      '</header>' +
      '<h4 class="card__ep">' + epTitle + '</h4>' +
      tagHtml +
      (e.hostNotes ? '<p class="card__summary">' + esc(e.hostNotes) + '</p>' : '') +
      notesHtml +
      '<footer class="card__foot">' +
        '<span class="card__date">' + esc(fmtDate(e.date)) + '</span>' +
        '<div class="card__acts">' +
          '<button class="act" type="button" data-act="edit" aria-label="编辑《' + esc(e.episode) + '》">编辑</button>' +
          '<button class="act act--danger" type="button" data-act="del" aria-label="删除《' + esc(e.episode) + '》">删除</button>' +
        '</div>' +
      '</footer>' +
    '</article>';
  }

  function renderAll() {
    renderStats();
    renderChannels();
    renderTopics();
    renderChart();
    renderChips();
    renderLog();
    renderDatalist();
    $('#dataHint').hidden = !state.isSample;
  }

  function renderDatalist() {
    var shows = Array.from(new Set(state.entries.map(function (e) { return e.show; }))).sort(function (a, b) {
      return a.localeCompare(b, 'zh');
    });
    $('#showList').innerHTML = shows.map(function (s) { return '<option value="' + esc(s) + '"></option>'; }).join('');
  }

  /* ---------------- 弹窗表单 ---------------- */
  var dialog = $('#dialog');
  var form = $('#form');

  function openDialog(id) {
    state.editingId = id || null;
    var e = id ? state.entries.find(function (x) { return x.id === id; }) : null;

    form.reset();
    $('#dialogKicker').textContent = e ? '编辑记录' : '新增记录';
    $('#dialogTitle').textContent = e ? '修改这一期' : '记下这一期';
    $('#btnDeleteEntry').hidden = !e;

    $('#fShow').value = e ? e.show : (state.show || '');
    $('#fHost').value = e ? e.host : '';
    $('#fEpisode').value = e ? e.episode : '';
    $('#fDate').value = e ? e.date : isoOf(new Date());
    $('#fDuration').value = e && e.duration ? e.duration : '';
    $('#fRating').value = e ? e.rating : 4;
    $('#fTags').value = e ? (e.tags || []).join(', ') : (state.tag || '');
    $('#fUrl').value = e ? e.url : '';
    $('#fHostNotes').value = e ? e.hostNotes : '';
    $('#fTakeaways').value = e ? (e.takeaways || []).join('\n') : '';
    $('#fQuote').value = e ? e.quote : '';
    syncRating();

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', '');
    }
    setTimeout(function () { $('#fShow').focus(); }, 40);
  }

  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    state.editingId = null;
  }

  function syncRating() {
    var input = $('#fRating');
    var v = Number(input.value) || 0;
    var pct = ((v - 0.5) / 4.5) * 100;
    input.style.setProperty('--p', pct.toFixed(1) + '%');
    $('#ratingOut').textContent = v.toFixed(1) + ' / 5';
  }

  function reportInvalid(field, message) {
    field.focus();
    toast(message);
    field.style.borderColor = 'var(--danger)';
    setTimeout(function () { field.style.borderColor = ''; }, 1600);
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();

    var wasEdit = !!state.editingId;
    var showEl = $('#fShow');
    var epEl = $('#fEpisode');
    var dateEl = $('#fDate');

    if (!showEl.value.trim()) return reportInvalid(showEl, '节目名称还没填');
    if (!epEl.value.trim()) return reportInvalid(epEl, '剧集标题还没填');
    if (!parseDate(dateEl.value)) return reportInvalid(dateEl, '选一个收听日期');

    var candidate = normalize({
      id: state.editingId || undefined,
      show: showEl.value,
      host: $('#fHost').value,
      episode: epEl.value,
      date: dateEl.value,
      duration: $('#fDuration').value,
      rating: $('#fRating').value,
      tags: $('#fTags').value,
      url: $('#fUrl').value,
      hostNotes: $('#fHostNotes').value,
      takeaways: $('#fTakeaways').value,
      quote: $('#fQuote').value
    });

    if (!candidate) {
      toast('这条记录缺了必要信息');
      return;
    }

    if (state.editingId) {
      var idx = state.entries.findIndex(function (x) { return x.id === state.editingId; });
      if (idx > -1) state.entries[idx] = candidate;
    } else {
      state.entries.unshift(candidate);
    }

    // 第一次亲手记录后，就不再提示「这是示例数据」
    if (!wasEdit) state.isSample = false;

    state.flashId = candidate.id;
    save();
    closeDialog();
    renderAll();
    toast(wasEdit ? '已更新' : '已记下这一期');
    state.flashId = null;
    setTimeout(function () {
      var card = $('.card.is-new');
      if (card) card.classList.remove('is-new');
    }, 900);
  });

  function deleteEntry(id, opts) {
    var e = state.entries.find(function (x) { return x.id === id; });
    if (!e) return;
    var needConfirm = !opts || opts.confirm !== false;
    if (needConfirm && !window.confirm('删除《' + e.episode + '》？此操作不可撤销。')) return;
    state.entries = state.entries.filter(function (x) { return x.id !== id; });
    save();
    renderAll();
    toast('已删除');
  }

  /* ---------------- 交互绑定 ---------------- */
  function bind() {
    $('#btnNew').addEventListener('click', function () { openDialog(null); });
    $('#btnClose').addEventListener('click', closeDialog);
    $('#btnCancel').addEventListener('click', closeDialog);
    $('#btnStarter').addEventListener('click', function () { openDialog(null); });

    $('#fRating').addEventListener('input', syncRating);

    $('#btnDeleteEntry').addEventListener('click', function () {
      var id = state.editingId;
      if (!id) return;
      closeDialog();
      deleteEntry(id);
    });

    dialog.addEventListener('click', function (event) {
      if (event.target === dialog) closeDialog();
    });
    dialog.addEventListener('close', function () { state.editingId = null; });

    // 搜索
    var q = $('#q');
    var timer = null;
    q.addEventListener('input', function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        state.q = q.value.trim().toLowerCase();
        renderLog();
        renderChips();
      }, 90);
    });

    // 排序
    $('#sort').addEventListener('change', function (event) {
      state.sort = event.target.value;
      renderLog();
    });

    // 频道筛选
    $('#channelFilter').addEventListener('click', function (event) {
      var chip = event.target.closest('.chip');
      if (!chip) return;
      if (chip.dataset.tagClear) {
        state.tag = null;
      } else {
        state.show = chip.dataset.show || null;
      }
      renderChips();
      renderTopics();
      renderLog();
      if (state.show || state.tag) scrollToLog();
    });

    // 标签云
    $('#tagCloud').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-tag]');
      if (!btn) return;
      var tag = btn.dataset.tag;
      state.tag = state.tag === tag ? null : tag;
      renderTopics();
      renderChips();
      renderLog();
      scrollToLog();
    });

    // 记录卡片操作
    $('#logGrid').addEventListener('click', function (event) {
      var btn = event.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.dataset.act;
      if (act === 'reset') {
        resetFilters();
        return;
      }
      if (act === 'new') {
        openDialog(null);
        return;
      }
      var card = btn.closest('.card');
      if (!card) return;
      if (act === 'edit') openDialog(card.dataset.id);
      if (act === 'del') deleteEntry(card.dataset.id);
    });

    // 导入 / 导出（顶栏和页脚共用同一套 data-io 钩子）
    document.addEventListener('click', function (event) {
      var trigger = event.target.closest('[data-io]');
      if (!trigger) return;
      if (trigger.dataset.io === 'import') $('#fileInput').click();
      else exportJson();
    });
    $('#fileInput').addEventListener('change', importJson);

    // 示例 / 清空
    $('#btnSample').addEventListener('click', function () {
      if (!window.confirm('载入示例数据会覆盖当前的 ' + state.entries.length + ' 条记录，继续？')) return;
      state.entries = (window.SEED_EPISODES || []).map(normalize).filter(Boolean);
      state.isSample = true;
      resetFilters(true);
      save();
      renderAll();
      toast('已载入示例数据');
    });

    $('#btnClear').addEventListener('click', function () {
      if (!state.entries.length) {
        toast('现在就是空的');
        return;
      }
      if (!window.confirm('清空全部 ' + state.entries.length + ' 条记录？建议先导出备份。')) return;
      state.entries = [];
      state.isSample = false;
      resetFilters(true);
      save();
      renderAll();
      toast('已清空');
    });

    // 主题
    $('#btnTheme').addEventListener('click', function () {
      var next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
      setTheme(next);
    });

    // 快捷键
    document.addEventListener('keydown', function (event) {
      var target = event.target;
      var typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT' || target.isContentEditable);
      if (typing || dialog.open) return;
      if (event.key === '/') {
        event.preventDefault();
        q.focus();
      } else if (event.key.toLowerCase() === 'n' && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        openDialog(null);
      }
    });
  }

  function scrollToLog() {
    var el = $('#log');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function resetFilters(silent) {
    state.q = '';
    state.show = null;
    state.tag = null;
    var q = $('#q');
    if (q) q.value = '';
    renderChips();
    renderTopics();
    renderLog();
    if (!silent) toast('已清除筛选');
  }

  function toast(message) {
    var el = $('#toast');
    el.textContent = message;
    el.hidden = false;
    // 强制回流，保证重复调用也能触发动画
    void el.offsetWidth;
    el.classList.add('is-on');
    clearTimeout(toast._t);
    toast._t = setTimeout(function () {
      el.classList.remove('is-on');
      setTimeout(function () { el.hidden = true; }, 240);
    }, 2200);
  }

  /* ---------------- 导入 / 导出 ---------------- */
  function exportJson() {
    var payload = {
      app: 'podcast-log',
      version: 1,
      exportedAt: new Date().toISOString(),
      entries: state.entries
    };
    var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'podcast-log-' + isoOf(new Date()) + '.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('已导出 ' + state.entries.length + ' 条记录');
  }

  function importJson(event) {
    var file = event.target.files && event.target.files[0];
    var input = event.target;
    if (!file) return;

    file.text().then(function (text) {
      var data = JSON.parse(text);
      var arr = Array.isArray(data) ? data : (data && data.entries);
      if (!Array.isArray(arr)) throw new Error('看不清这个文件的结构：应该是记录数组，或包含 entries 数组的对象');

      var entries = arr.map(normalize).filter(Boolean);
      if (!entries.length) throw new Error('文件里没有能识别的记录');

      // 防止重复 id 导致编辑 / 删除串台
      var seen = Object.create(null);
      entries.forEach(function (e) {
        if (seen[e.id]) e.id = uid();
        seen[e.id] = true;
      });

      if (state.entries.length && !window.confirm('导入 ' + entries.length + ' 条记录，将覆盖当前的 ' + state.entries.length + ' 条。继续？')) {
        return;
      }
      state.entries = entries;
      state.isSample = false;
      resetFilters(true);
      save();
      renderAll();
      toast('已导入 ' + entries.length + ' 条记录');
    }).catch(function (err) {
      window.alert('导入失败：' + err.message);
    }).then(function () {
      input.value = '';
    });
  }

  /* ---------------- 主题 ---------------- */
  function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch (err) { /* ignore */ }
    $('#themeIcon').textContent = theme === 'light' ? '☀' : '☾';
    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f7f4ed' : '#0a0b0e');
  }

  function initTheme() {
    var saved = null;
    try { saved = localStorage.getItem(THEME_KEY); } catch (err) { /* ignore */ }
    setTheme(saved === 'light' ? 'light' : 'dark');
  }

  /* ---------------- 启动 ---------------- */
  initTheme();
  load();
  renderWave();
  bind();
  renderAll();
})();
