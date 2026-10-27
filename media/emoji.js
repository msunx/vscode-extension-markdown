(() => {
  'use strict';
  // Plain Unicode stays portable when the Markdown is opened outside Folio.
  const groups = [
    ['faces', '表情', `😀|开心|grin happy smile 开心 笑脸
😃|大笑|smiley happy
😄|灿烂笑容|smile joy
😁|露齿笑|grin teeth
😆|眯眼笑|laugh
😅|笑出汗|sweat relief
😂|笑哭|joy tears laugh
🤣|笑到打滚|rofl laugh
😊|微笑|blush smile happy
🙂|浅笑|slight smile
😉|眨眼|wink
😍|爱慕|heart eyes love
🥰|幸福|love hearts
😘|飞吻|kiss love
😋|美味|yum delicious
😎|酷|cool sunglasses
🤩|星星眼|star struck excited
🥳|庆祝|party celebrate
🤔|思考|thinking question
🧐|仔细观察|monocle curious
🤗|拥抱|hug
🤭|捂嘴笑|giggle
🤫|安静|quiet shush
😴|睡觉|sleep tired
🥱|打哈欠|yawn tired
😮|惊讶|surprise wow
😬|尴尬|grimace awkward
😐|无语|neutral speechless
🙃|倒脸|upside down
🥺|恳求|pleading please
😢|难过|sad cry
😭|大哭|sob cry
😤|生气|angry huff
😡|愤怒|rage angry
🤯|震惊|mind blown
🥹|感动|moved tears
🤠|牛仔|cowboy
🤖|机器人|robot ai
👻|幽灵|ghost
💩|便便|poop`],
    ['gestures', '手势', `👍|点赞|thumbs up good yes 赞
👎|不赞同|thumbs down no
👏|鼓掌|clap applause
🙌|举手欢呼|raise hands celebrate
🙏|感谢|thanks pray please
🤝|握手|handshake agree
💪|加油|muscle strong strength
👌|好的|ok okay
✌️|胜利|victory peace
🤞|祝好运|crossed fingers luck
🤟|爱你|love you
🤘|摇滚|rock
👋|挥手|wave hello goodbye
🫶|比心|heart hands love
🫰|手指爱心|finger heart
✍️|书写|write writing
👀|关注|eyes look watch
🧠|大脑|brain idea
🧑‍💻|程序员|coder developer technology
🧑‍🎨|艺术家|artist design`],
    ['nature', '自然', `🌱|幼苗|seedling grow plant
🌿|绿叶|herb leaf green
🍀|四叶草|clover luck
🌳|大树|tree
🌵|仙人掌|cactus
🌸|樱花|cherry blossom flower
🌻|向日葵|sunflower
🌹|玫瑰|rose love
🌈|彩虹|rainbow
☀️|太阳|sun sunny
🌙|月亮|moon night
⭐|星星|star
🌟|闪亮星星|glowing star
✨|闪光|sparkles magic
🔥|火焰|fire hot
💧|水滴|drop water
🌊|海浪|wave ocean
❄️|雪花|snow winter
🐱|猫咪|cat kitten
🐶|小狗|dog puppy
🐼|熊猫|panda
🦊|狐狸|fox
🦋|蝴蝶|butterfly
🐝|蜜蜂|bee`],
    ['food', '美食', `☕|咖啡|coffee cafe
🍵|茶|tea
🧋|奶茶|bubble tea boba
🥤|饮料|drink soda
🍎|苹果|apple fruit
🍊|橘子|orange fruit
🍋|柠檬|lemon
🍓|草莓|strawberry
🍉|西瓜|watermelon
🍇|葡萄|grapes
🍒|樱桃|cherry
🍑|桃子|peach
🥑|牛油果|avocado
🍞|面包|bread
🥐|可颂|croissant
🍔|汉堡|burger
🍕|披萨|pizza
🍜|面条|noodles ramen
🍣|寿司|sushi
🥟|饺子|dumpling
🍰|蛋糕|cake dessert
🎂|生日蛋糕|birthday cake
🍪|饼干|cookie
🍫|巧克力|chocolate`],
    ['objects', '物品', `🚀|火箭|rocket launch
✈️|飞机|plane travel
🚲|自行车|bike bicycle
🚗|汽车|car
🏠|房子|house home
🏖️|海滩|beach vacation
⛺|露营|camp tent
🎯|目标|target goal
🏆|奖杯|trophy win
🏅|奖牌|medal
🎨|调色盘|art design palette
🎵|音乐|music note
🎧|耳机|headphone music
🎬|电影|movie film
📷|相机|camera photo
💡|灵感|idea bulb
💻|电脑|computer laptop
📱|手机|phone
📚|书籍|books read study
📖|阅读|book read
📝|笔记|memo note write
📌|图钉|pin important
📎|回形针|paperclip attachment
📅|日历|calendar date
⏰|闹钟|alarm time
⏳|沙漏|hourglass wait
🔍|搜索|search magnify
🔑|钥匙|key
🔒|锁|lock secure
🛠️|工具|tools fix
📦|包裹|package box
🎁|礼物|gift present
🎉|礼花|party celebrate
🎈|气球|balloon`],
    ['symbols', '符号', `❤️|红心|red heart love
🧡|橙心|orange heart
💛|黄心|yellow heart
💚|绿心|green heart
💙|蓝心|blue heart
💜|紫心|purple heart
🖤|黑心|black heart
🤍|白心|white heart
💕|双心|two hearts love
💖|闪亮爱心|sparkling heart
💯|满分|hundred perfect
✅|完成|check done yes
☑️|勾选|checkbox task todo
❌|叉号|cross no cancel
⚠️|注意|warning caution
❗|感叹号|exclamation important
❓|问号|question help
💬|对话|speech comment chat
💭|想法|thought idea
🔔|提醒|bell notification
🔗|链接|link
♻️|循环|recycle
🟢|绿圆|green circle
🔵|蓝圆|blue circle
🟡|黄圆|yellow circle
🔴|红圆|red circle`]
  ];
  const emojis = groups.flatMap(([group, label, rows]) => rows.split('\n').map(row => {
    const [value, name, keywords] = row.split('|'); return { value, name, group, search: `${value} ${name} ${keywords} ${label}`.toLowerCase() };
  }));

  window.FolioEmojiPicker = function ({ onSelect, onClose }) {
    const picker = document.createElement('div'); picker.className = 'folio-emoji-picker'; picker.hidden = true;
    picker.setAttribute('role', 'dialog'); picker.setAttribute('aria-label', '插入 Emoji 表情');
    const header = document.createElement('div'); header.className = 'folio-emoji-header';
    const title = document.createElement('strong'); title.textContent = 'Emoji 表情';
    const close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', '关闭表情选择框'); header.append(title, close);
    const search = document.createElement('input'); search.type = 'search'; search.placeholder = '搜索表情，如：开心、咖啡、rocket'; search.setAttribute('aria-label', '搜索表情');
    const tabs = document.createElement('div'); tabs.className = 'folio-emoji-categories'; tabs.setAttribute('role', 'group'); tabs.setAttribute('aria-label', '表情分类');
    const grid = document.createElement('div'); grid.className = 'folio-emoji-grid'; grid.setAttribute('role', 'group'); grid.setAttribute('aria-label', '可选表情');
    const empty = document.createElement('p'); empty.className = 'folio-emoji-empty'; empty.textContent = '没有找到表情，换个关键词试试'; empty.setAttribute('role', 'status');
    const footer = document.createElement('div'); footer.className = 'folio-emoji-footer';
    const label = document.createElement('span'), hint = document.createElement('span'); hint.textContent = '↵ 插入 · Esc 关闭'; footer.append(label, hint);
    picker.append(header, search, tabs, grid, empty, footer); document.body.append(picker);
    let anchor, category = 'all', results = [], selected = 0, action = '插入';
    function highlight(index, focus = false) {
      selected = Math.max(0, Math.min(index, results.length - 1));
      Array.from(grid.children).forEach((button, i) => { button.tabIndex = i === selected ? 0 : -1; button.classList.toggle('is-selected', i === selected); });
      label.textContent = results[selected]?.name || '';
      hint.textContent = results.length ? `↵ ${action} · Esc 关闭` : 'Esc 关闭';
      if (focus) grid.children[selected]?.focus({ preventScroll: true });
      if (focus) grid.children[selected]?.scrollIntoView({ block: 'nearest' });
    }
    function render() {
      const query = search.value.trim().toLowerCase();
      results = emojis.filter(item => (query || category === 'all' || item.group === category) && query.split(/\s+/).every(term => item.search.includes(term)));
      tabs.querySelectorAll('button').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.category === category && !query)));
      grid.replaceChildren();
      for (const item of results) {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = item.value; button.dataset.emoji = item.value;
        button.setAttribute('aria-label', item.name); button.title = item.name; grid.append(button);
      }
      empty.hidden = Boolean(results.length); grid.hidden = !results.length; grid.scrollTop = 0; highlight(0); position();
    }
    function position() {
      if (picker.hidden || !anchor) return;
      const rect = anchor.getBoundingClientRect();
      const element = anchor.startContainer.nodeType === Node.ELEMENT_NODE ? anchor.startContainer : anchor.startContainer.parentElement;
      const point = rect.height ? rect : element.getBoundingClientRect(), safe = 12, gap = 8;
      picker.style.width = `${Math.max(0, Math.min(348, innerWidth - safe * 2))}px`;
      picker.style.maxHeight = `${Math.max(0, innerHeight - safe * 2)}px`;
      const height = picker.offsetHeight, below = innerHeight - point.bottom - gap;
      const top = below >= height || point.top < height + gap ? point.bottom + gap : point.top - gap - height;
      picker.style.left = `${Math.max(safe, Math.min(point.left, innerWidth - picker.offsetWidth - safe))}px`;
      picker.style.top = `${Math.max(safe, Math.min(top, innerHeight - height - safe))}px`;
    }
    for (const [id, name] of [['all', '全部'], ...groups.map(([id, name]) => [id, name])]) {
      const button = document.createElement('button'); button.type = 'button'; button.textContent = name; button.dataset.category = id;
      button.onclick = () => { category = id; search.value = ''; render(); }; tabs.append(button);
    }
    close.onclick = () => onClose(true);
    search.oninput = render;
    grid.addEventListener('click', event => { const button = event.target.closest('[data-emoji]'); if (button) onSelect(button.dataset.emoji); });
    grid.addEventListener('focusin', event => { const index = Array.from(grid.children).indexOf(event.target); if (index >= 0) highlight(index); });
    grid.addEventListener('pointermove', event => { const index = Array.from(grid.children).indexOf(event.target); if (index >= 0) label.textContent = results[index].name; });
    grid.addEventListener('pointerleave', () => highlight(selected));
    picker.addEventListener('keydown', event => {
      // Keep editing shortcuts in the search field; the host otherwise forwards them back asynchronously to the Markdown editor.
      if (event.target === search && (event.metaKey || event.ctrlKey) && ['a', 'z', 'y'].includes(event.key.toLowerCase())) { event.stopPropagation(); return; }
      if (event.isComposing) return;
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(true); return; }
      if (event.target !== search && event.target.parentElement !== grid) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); if (results.length) onSelect(results[selected].value); return; }
      if (!results.length) return;
      const columns = getComputedStyle(grid).gridTemplateColumns.split(' ').length;
      const delta = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
      if (delta === undefined || (event.target === search && !['ArrowDown', 'ArrowUp'].includes(event.key))) return;
      event.preventDefault(); event.stopPropagation(); highlight(event.target === search ? event.key === 'ArrowDown' ? 0 : results.length - 1 : selected + delta, true);
    });
    window.addEventListener('resize', position); window.addEventListener('scroll', position, { passive: true });
    return {
      element: picker,
      open(range, options = {}) {
        action = options.action || '插入'; title.textContent = options.title || 'Emoji 表情'; picker.setAttribute('aria-label', options.title || '插入 Emoji 表情');
        anchor = range.cloneRange(); category = 'all'; search.value = ''; picker.hidden = false; render(); search.focus({ preventScroll: true });
      },
      close() { picker.hidden = true; anchor = null; }
    };
  };
})();
