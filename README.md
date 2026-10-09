<p align="center">
  <img src="./media/icon.png" width="72" height="72" alt="Folio 书页图标">
</p>

<h1 align="center">Folio</h1>

<p align="center">给 Markdown 一份多彩、清晰、可勾选的预览。</p>

<p align="center">
  <a href="#安装">安装</a> · <a href="#预览与编辑">使用</a> · <a href="./examples/preview.md">语法样本</a> · <a href="./CHANGELOG.md">更新记录</a>
</p>

Folio 是一款面向 Cursor 的 Markdown 预览扩展：在 `#24273A` 暮色背景上，用颜色区分标题、重点和组件，并支持直接勾选 Todo。仅作用于 Markdown，保留编辑器原有主题。

<p align="center">
  <img src="./assets/readme/preview.png" width="100%" alt="Folio 实际预览：紫色一级标题、蓝色二级标题、青绿色三级标题，以及引用、行内代码和带复制按钮的代码块">
</p>

## 安装

使用 Node.js 22，在本地生成 VSIX：

```sh
git clone https://github.com/msunx/vscode-extension-markdown.git
cd vscode-extension-markdown
npm ci
npm run check
npm run package
```

在 Cursor 的命令面板执行 **Extensions: Install from VSIX**，选择生成的 `folio-markdown-0.3.0.vsix`。安装或更新后，执行一次 **Developer: Reload Window**。

## 预览与编辑

打开 `.md` 文件，点击右上角的**书本按钮**「Folio 预览（可勾选 Todo）」；在预览中点击**铅笔按钮**返回源码。

| 操作 | 方式 |
| --- | --- |
| 切换编辑与预览 | macOS `⌘⌥V`；Windows / Linux `Ctrl+Alt+V` |
| 定位源码 | 双击预览正文 |
| 复制代码 | 代码块右上角「复制」 |
| 并排阅读 | 使用编辑器的「拆分编辑器」 |

Cursor 默认隐藏第三方标题栏操作，Folio 首次启用时会固定这两个按钮。若曾手动隐藏，可在命令面板搜索 `Folio` 打开预览。

### 直接勾选 Todo

```markdown
- [x] 整理文档结构
- [ ] 检查链接和图片
  - [ ] 补充变更说明
```

点击复选框或任务文字，状态会写回源文档中的 `[ ]` / `[x]`；也可用 Tab 聚焦、空格切换。支持嵌套、有序、引用及同名任务，保存、撤销和重做沿用编辑器行为。

只读文档或过期预览会拒绝写入并显示原因。已经打开的原生 Markdown 预览仍为只读，点击其中的 **Folio 书本按钮**即可切换。

## 让颜色帮助阅读

**H1–H6 分别使用淡紫、蓝、青绿、桃、浅金和粉色。** 正文中的粗体、斜体、链接、行内代码各有语义色；引用、表格、提示块和折叠面板使用轻染色背景。宽表格和长代码在区块内横向滚动。

| 内容 | 支持范围 |
| --- | --- |
| 基础排版 | 标题、强调、删除线、链接、图片、列表、引用、表格、分隔线 |
| 代码与任务 | 语法高亮、复制代码、交互式 Todo |
| 扩展语法 | 脚注、定义列表、缩写、高亮、上下标 |
| 提示块 | `NOTE`、`TIP`、`IMPORTANT`、`WARNING`、`CAUTION` |
| HTML 与公式 | `details`、`kbd` 等排版；公式依赖宿主 Markdown Math |

完整内容见 [语法样本](./examples/preview.md)。支持键盘焦点、高对比度模式和减少动态效果偏好。

## 兼容与边界

- 扩展声明支持 VS Code API `^1.90.0`，已在 **macOS / Cursor 3.23.23** 验证；其他平台尚未实测。
- 使用宿主 Markdown 渲染器。公式需要启用内置 Markdown Math；Mermaid 当前按代码块展示。
- Todo 修改遵循编辑器保存设置，不会强制保存文档里的其他修改。
- 文档内脚本不会执行。Folio 不会改变非 Markdown 文件的编辑体验。

## 开发

预览样式位于 `media/preview.css`，编辑器集成位于 `src/`。修改后运行 `npm run check` 检查语法，使用 `npm run package` 打包。`scripts/` 保留了预览渲染和 Cursor 宿主回归工具。

发现问题时，可在 [Issues](https://github.com/msunx/vscode-extension-markdown/issues) 附上最小 Markdown、Cursor 版本和复现步骤，请先移除私密内容。

[MIT License](./LICENSE) · [更新记录](./CHANGELOG.md)
