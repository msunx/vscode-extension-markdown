<p align="center">
  <img src="./media/icon.png" width="64" height="64" alt="Folio 书页图标">
</p>

<h1 align="center">Folio</h1>

<p align="center">在 Markdown 预览里，直接写。</p>

<p align="center">
  <a href="#安装与打开">安装</a> · <a href="#在预览里写作">写作</a> · <a href="#用列表整理思路">多级列表</a> · <a href="./examples/preview.md">语法样本</a>
</p>

Folio 是面向 **Cursor** 的 Markdown 编辑预览扩展。暮色背景、彩色标题和清楚的列表层级，让文档更容易读；点击内容即可继续写，修改仍保存在原来的 Markdown 文件中。

<p align="center">
  <img src="./assets/readme/preview.png" width="100%" alt="Folio 预览：仓耳今楷正文、居中的紫色标题、菱形分隔线、彩色小节、任务与代码块">
</p>

## 安装与打开

使用 **Node.js 22**，在本地生成安装包：

```sh
git clone https://github.com/msunx/vscode-extension-markdown.git
cd vscode-extension-markdown
npm ci
npm run check
npm run package
```

1. 在 Cursor 命令面板执行 **Extensions: Install from VSIX**，选择 `folio-markdown-0.4.7.vsix`。
2. 执行 **Developer: Reload Window**，打开任意 Markdown 文件。
3. 点击右上角的**书本按钮**「Folio 编辑预览」。点击**铅笔按钮**返回源码，也可用 `⌘⌥V` 切换。

首次启用时，Folio 会固定这两个标题栏按钮。如果曾手动隐藏，可在命令面板搜索 `Folio`。

## 在预览里写作

点击标题、正文、列表或引用即可编辑。在空行输入 `/` 或 `、`，选择标题、列表、任务、代码、引用、分隔线、链接、图片或表格；继续输入 `/h2`、`、任务` 等关键词筛选。

<p align="center">
  <img src="./assets/readme/editing.png" width="100%" alt="Folio 就地编辑：输入斜杠后出现模块菜单，支持关键词筛选和键盘选择">
</p>

| 操作 | macOS 快捷键 |
| --- | --- |
| 切换视图 | `⌘⌥V` |
| 模块菜单 | `⌘/` |
| 选择 / 插入 | `↑`、`↓` / `Enter` |
| 结束编辑 | `Esc` |
| 缩进 / 退级 | `Tab` / `Shift+Tab` |
| 撤销 / 重做 | `⌘Z` / `⌘⇧Z` |
| 保存 | `⌘S` |
| 定位源码 | `Option` + 双击内容 |

Windows / Linux 对应使用 `Ctrl+Alt+V` 切换、`Ctrl+/` 打开菜单、`Ctrl+S` 保存、`Alt` + 双击定位源码；撤销和重做使用编辑器默认快捷键。其他按键相同。

普通编辑直接同步到文档，保存沿用编辑器的自动保存设置；撤销和重做在预览中直接执行。代码块右上角还可一键复制代码。

## 用列表整理思路

列表项之间留有空行、包含多个段落或嵌套任务时，点击文字仍保持可视化编辑，不会因为空行切换成整段 Markdown 源码。

**在列表文字中按 `Tab`，当前项连同子项成为前一项的子列表；`Shift+Tab` 退一级。** 无序、有序、混合列表和 Todo 都适用，选中连续同级项可以一起调整。

<p align="center">
  <img src="./assets/readme/lists.png" width="720" alt="多级列表：蓝、青绿、桃色的标记和圆角连接线区分父子关系，有序列表与嵌套 Todo 使用相同层级规则">
</p>

列表项末尾按 `Enter` 新建同级项；在空项上再按 `Enter`，退出整个列表并开始普通正文。已有内容和子项层级保持不变，新建 Todo 默认未完成。

同级第一项没有可归属的前项，顶层也不能再退级，这两种情况保持原位。按 `Esc` 结束编辑后，`Tab` 恢复焦点导航。

点击 Todo 复选框，`[ ]` / `[x]` 会同步写回原文；点击任务文字可以继续编辑。复选框支持键盘聚焦和空格切换，保存、撤销、重做与普通编辑一致。

## 让颜色和字体帮助阅读

- **标题有层次。** H1–H6 分别使用淡紫、蓝、青绿、桃、浅金和粉色。一级标题居中，配有细线与菱形；其他层级用短条、圆点、圆环等标记区分。
- **列表有线索。** 前六级以蓝、青绿、桃、紫、粉、金色标记和圆角连接线呈现，更深层级沿用金色，正文保持统一颜色。
- **字体只作用于预览。** 标题、正文与模块菜单优先使用本机安装的仓耳今楷，兼容仓耳今楷05的中英文名称。没有安装时回退到当前 `editor.fontFamily`；代码和原始 Markdown 编辑框始终沿用编辑器字体。扩展不附带、下载或安装字体。

背景为 `#24273A`，强调、链接、行内代码各有语义色；引用、表格和提示块使用轻染色背景。仅作用于 Markdown 预览，不修改编辑器字体或整体颜色主题。

## 支持的内容

| 内容 | 范围 |
| --- | --- |
| 基础 Markdown | 标题、强调、删除线、链接、图片、列表、引用、表格、分隔线 |
| 代码与任务 | 语法高亮、代码复制、嵌套 Todo、任务回写 |
| 扩展排版 | 脚注、定义列表、缩写、高亮、上下标 |
| 提示块 | `NOTE`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION` |
| HTML 与公式 | `details`、`kbd` 等；公式依赖内置 Markdown Math |

完整示例见 [语法样本](./examples/preview.md)。支持高对比度、减少动态效果偏好；宽表格和长代码在区块内横向滚动。

## 兼容与边界

- 已在 **macOS / Cursor** 验证，扩展声明支持 VS Code API `^1.90.0`；其他平台尚未实测。
- 代码、表格、HTML、公式等复杂区块在原位置展开 Markdown 编辑框，保留原始语法；列表 `Tab` 层级操作用于可视化编辑状态。
- 原生 Markdown 预览使用 Folio 样式，但保持只读。点击 **Folio 书本按钮**进入可编辑预览。
- 源文件被其他编辑同时修改时，保留草稿并提示处理；只读或过期请求不会覆盖原文，保存失败会保留未保存内容。
- 文档内脚本不会执行；Mermaid 当前按代码块展示。

## 开发

样式位于 `media/preview.css`，就地编辑逻辑位于 `media/editor.js`，编辑器集成位于 `src/`。`scripts/` 包含 Cursor 宿主与界面回归脚本，覆盖切换、任务、编辑和多级列表。最近的列表与编辑回归均连续三轮通过，包含 CRLF、撤销 / 重做及保存读回。

[报告问题](https://github.com/msunx/vscode-extension-markdown/issues)时，请附上最小 Markdown、Cursor 版本和复现步骤，并先移除私密内容。

[MIT License](./LICENSE) · [更新记录](./CHANGELOG.md)
