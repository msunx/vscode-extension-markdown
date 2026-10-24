'use strict';

const { randomUUID } = require('node:crypto');
const key = 'folio.templates.v1';
const diary = { id: 'diary', name: '日记', builtin: true, content: '# {{date}}\n\n{{weekday}} · 日记\n\n## 今日记录\n\n写下今天发生的事。\n\n## 心情与感想\n\n此刻，想记住什么？\n\n## 明日计划\n\n- [ ] 一件想做的事\n' };

class TemplateStore {
  constructor(storage) { this.storage = storage; this.queue = Promise.resolve(); }

  read() {
    const saved = this.storage.get(key, { revision: '', items: [] });
    return { revision: saved.revision, items: [diary, ...saved.items] };
  }

  update(message) {
    const result = this.queue.then(async () => {
      const current = this.read();
      if (message.revision !== current.revision) throw new Error('模板库已更新，请返回模板库刷新后重试。当前输入已保留。');
      const items = current.items.filter(item => !item.builtin);
      if (message.action === 'delete') {
        const index = items.findIndex(item => item.id === message.templateId);
        if (index < 0) throw new Error('此模板已不存在，请刷新模板库。');
        items.splice(index, 1);
      } else if (message.action === 'save') {
        const name = typeof message.name === 'string' ? message.name.trim() : '';
        const content = typeof message.content === 'string' ? message.content.replace(/\r\n?/g, '\n') : '';
        if (!name || name.length > 60) throw new Error('请输入 1–60 个字符的模板名称。');
        if (!content.trim() || content.length > 50000) throw new Error('请填写模板内容，最多 50,000 个字符。');
        if (items.some(item => item.name === name && item.id !== message.templateId)) throw new Error('已有同名模板，请换一个名称。');
        const index = items.findIndex(item => item.id === message.templateId);
        if (message.templateId && index < 0) throw new Error('此模板已不存在，请返回模板库后另存为新模板。当前输入已保留。');
        if (index < 0 && items.length >= 100) throw new Error('最多保存 100 个模板，请先删除不再使用的模板。');
        const item = { id: message.templateId || randomUUID(), name, content };
        if (index < 0) items.push(item); else items[index] = item;
        await this.storage.update(key, { revision: randomUUID(), items });
        return { ...this.read(), selected: item.id };
      } else throw new Error('无法识别此模板操作。');
      await this.storage.update(key, { revision: randomUUID(), items });
      return this.read();
    });
    this.queue = result.catch(() => {});
    return result;
  }
}

module.exports = { TemplateStore };
