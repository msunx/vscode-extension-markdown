'use strict';

function addVideos(md) {
  md.core.ruler.push('folio_videos', state => {
    for (let i = 0; i < state.tokens.length - 2; i++) {
      const paragraph = state.tokens[i], inline = state.tokens[i + 1], close = state.tokens[i + 2];
      if (paragraph.type !== 'paragraph_open' || paragraph.level !== 0 || inline.type !== 'inline' || close.type !== 'paragraph_close') continue;
      const children = inline.children?.filter(child => child.type !== 'text' || child.content.trim()) || [];
      if (children[0]?.type !== 'link_open' || children.at(-1)?.type !== 'link_close' || children.filter(child => child.type === 'link_open').length !== 1) continue;
      if (children.some(child => ['image', 'softbreak', 'hardbreak'].includes(child.type))) continue;
      const href = children[0].attrGet('href');
      try {
        const url = new URL(href);
        if (url.protocol !== 'https:' || url.username || url.password || !/\.(mp4|m4v|webm|ogv)$/i.test(url.pathname)) continue;
      } catch { continue; }
      const title = children.filter(child => ['text', 'code_inline'].includes(child.type)).map(child => child.content).join('').trim();
      const video = new state.Token('folio_video', 'figure', 0);
      video.block = true; video.map = paragraph.map; video.meta = { href, title: !title || title === href || /^视频[：:]?\s*打开链接$/.test(title) ? '视频' : title };
      state.tokens.splice(i, 3, video);
    }
  });
  md.renderer.rules.folio_video = (tokens, index) => {
    const { href, title } = tokens[index].meta, escape = md.utils.escapeHtml;
    return '<figure class="folio-video" contenteditable="false">'
      + `<div class="folio-video-stage"><video preload="none" playsinline data-src="${escape(href)}" aria-label="${escape(title)}"></video>`
      + '<button type="button" class="folio-video-play" aria-label="播放视频"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 11 7-11 7Z"/></svg></button>'
      + '<span class="folio-video-status" role="status" aria-live="polite"></span><span class="folio-video-duration" hidden></span>'
      + `<a class="folio-video-external" href="${escape(href)}" target="_blank" rel="noopener noreferrer" aria-label="打开原视频" title="打开原视频">`
      + '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'
      + '<path d="M14 4h6v6M20 4l-9 9M10 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/></svg></a></div></figure>\n';
  };
}

module.exports = { addVideos };
