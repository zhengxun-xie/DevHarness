/** DevBuddy LEFT-panel copy. Bilingual dictionary under the `devBuddyLeft` namespace. */

export type DevBuddyKey =
  | 'panel.title'
  | 'panel.subtitle'
  | 'panel.empty'
  | 'panel.emptyHint'
  | 'panel.rightbarOpen'
  | 'panel.rightbarClose'
  | 'project.new'
  | 'project.name'
  | 'project.path'
  | 'project.create'
  | 'project.cancel'
  | 'project.remove'
  | 'project.removeConfirm'
  | 'node.richtext'
  | 'node.collapse'
  | 'node.source'
  | 'node.save'
  | 'node.saved'
  | 'node.discard'
  | 'node.unsaved'
  | 'node.notFound'
  | 'node.updated'
  | 'node.empty'
  | 'node.reviewBadgeTitle'
  | 'node.reviewBadgeDrifted'
  | 'node.addReview'
  | 'node.closeReview'
  | 'toolbar.paragraph'
  | 'toolbar.bold'
  | 'toolbar.italic'
  | 'toolbar.strike'
  | 'toolbar.code'
  | 'toolbar.bulletList'
  | 'toolbar.orderedList'
  | 'toolbar.taskList'
  | 'toolbar.blockquote'
  | 'toolbar.codeBlock'
  | 'toolbar.link'
  | 'toolbar.unlink'
  | 'toolbar.linkPrompt'
  | 'toolbar.table'
  | 'toolbar.drawing'
  | 'toolbar.undo'
  | 'toolbar.redo'
  | 'draw.title'
  | 'draw.close'
  | 'draw.saving'
  | 'draw.loadError'
  | 'draw.saveError'
  | 'draw.edit'
  | 'draw.empty'
  | 'draw.missing'
  | 'draw.error'
  | 'workspace.label'
  | 'workspace.unlinked'
  | 'workspace.sessions'
  | 'workspace.auto'
  | 'workspace.newSession'
  | 'workspace.rebind'
  | 'workspace.choose'
  | 'workspace.autoMatch'
  | 'workspace.starting'
  | 'workspace.empty'
  | 'error.prefix'
  | 'error.reload'
  | 'loading'

const en: Record<DevBuddyKey, string> = {
  'panel.title': 'DevBuddy',
  'panel.subtitle': 'Multi-project development workflow',
  'panel.empty': 'No project yet',
  'panel.emptyHint': 'Create your first project to start the development workflow.',
  'panel.rightbarOpen': 'Open right sidebar',
  'panel.rightbarClose': 'Collapse right sidebar',
  'project.new': 'New project',
  'project.name': 'Project name',
  'project.path': 'Working directory (absolute path)',
  'project.create': 'Create',
  'project.cancel': 'Cancel',
  'project.remove': 'Remove',
  'project.removeConfirm': 'Remove this project from DevBuddy? Files on disk are kept.',
  'node.richtext': 'Rich text',
  'node.collapse': 'Collapse',
  'node.source': 'Source',
  'node.save': 'Save',
  'node.saved': 'Saved',
  'node.discard': 'Discard',
  'node.unsaved': 'Unsaved changes — the current draft is not saved yet',
  'node.notFound': 'File not created yet',
  'node.updated': 'Updated',
  'node.empty': 'Empty file — click Rich text to start.',
  'node.reviewBadgeTitle': 'Review {number} ({id}) — click to open',
  'node.reviewBadgeDrifted': 'anchor drifted',
  'node.addReview': '💬 Add comment',
  'node.closeReview': 'Close',
  'toolbar.paragraph': 'Text',
  'toolbar.bold': 'Bold',
  'toolbar.italic': 'Italic',
  'toolbar.strike': 'Strikethrough',
  'toolbar.code': 'Inline code',
  'toolbar.bulletList': 'Bullet list',
  'toolbar.orderedList': 'Ordered list',
  'toolbar.taskList': 'Task list',
  'toolbar.blockquote': 'Quote',
  'toolbar.codeBlock': 'Code block',
  'toolbar.link': 'Add link',
  'toolbar.unlink': 'Remove link',
  'toolbar.linkPrompt': 'Link URL',
  'toolbar.table': 'Insert table',
  'toolbar.drawing': 'Insert drawing',
  'toolbar.undo': 'Undo',
  'toolbar.redo': 'Redo',
  'draw.title': 'Drawing',
  'draw.close': 'Done',
  'draw.saving': 'Saving…',
  'draw.loadError': 'Could not load the drawing file',
  'draw.saveError': 'Could not save the drawing',
  'draw.edit': 'Click to edit the drawing',
  'draw.empty': 'Empty drawing — click to draw',
  'draw.missing': 'Drawing file missing — click to recreate',
  'draw.error': 'Drawing unavailable',
  'workspace.label': 'Workspace',
  'workspace.unlinked': 'No linked workspace — no DSH session has run in this directory yet',
  'workspace.sessions': 'sessions',
  'workspace.auto': 'Auto',
  'workspace.newSession': 'New session here',
  'workspace.rebind': 'Rebind',
  'workspace.choose': 'Link workspace',
  'workspace.autoMatch': 'Auto-match by directory path',
  'workspace.starting': 'Starting session…',
  'workspace.empty': 'No DSH workspaces yet — open a session in a directory first',
  'error.prefix': 'DevBuddy error',
  'error.reload': 'Reload',
  'loading': 'Loading…',
}

const zh: Record<DevBuddyKey, string> = {
  'panel.title': 'DevBuddy',
  'panel.subtitle': '多项目开发工作流',
  'panel.empty': '还没有项目',
  'panel.emptyHint': '创建第一个项目，开始开发工作流。',
  'panel.rightbarOpen': '展开右侧栏',
  'panel.rightbarClose': '收起右侧栏',
  'project.new': '新建项目',
  'project.name': '项目名称',
  'project.path': '工作目录（绝对路径）',
  'project.create': '创建',
  'project.cancel': '取消',
  'project.remove': '移除',
  'project.removeConfirm': '从 DevBuddy 移除该项目？磁盘上的文件不会被删除。',
  'node.richtext': '富文本',
  'node.collapse': '收起',
  'node.source': '源码',
  'node.save': '保存',
  'node.saved': '已保存',
  'node.discard': '放弃',
  'node.unsaved': '有未保存的修改 —— 当前草稿尚未保存',
  'node.notFound': '文件尚未创建',
  'node.updated': '已更新',
  'node.empty': '文件为空 —— 点击「富文本」开始填写。',
  'node.reviewBadgeTitle': '评审 {number}（{id}）—— 点击打开',
  'node.reviewBadgeDrifted': '锚点已漂移',
  'node.addReview': '💬 添加评论',
  'node.closeReview': '关闭',
  'toolbar.paragraph': '正文',
  'toolbar.bold': '加粗',
  'toolbar.italic': '斜体',
  'toolbar.strike': '删除线',
  'toolbar.code': '行内代码',
  'toolbar.bulletList': '无序列表',
  'toolbar.orderedList': '有序列表',
  'toolbar.taskList': '任务列表',
  'toolbar.blockquote': '引用',
  'toolbar.codeBlock': '代码块',
  'toolbar.link': '添加链接',
  'toolbar.unlink': '移除链接',
  'toolbar.linkPrompt': '链接地址',
  'toolbar.table': '插入表格',
  'toolbar.drawing': '插入画板',
  'toolbar.undo': '撤销',
  'toolbar.redo': '重做',
  'draw.title': '画板',
  'draw.close': '完成',
  'draw.saving': '正在保存…',
  'draw.loadError': '无法加载画板文件',
  'draw.saveError': '画板保存失败',
  'draw.edit': '点击编辑画板',
  'draw.empty': '画板为空 —— 点击开始绘制',
  'draw.missing': '画板文件缺失 —— 点击重建',
  'draw.error': '画板不可用',
  'workspace.label': '工作区',
  'workspace.unlinked': '未关联工作区 —— 该目录还没有运行过 DSH 会话',
  'workspace.sessions': '个会话',
  'workspace.auto': '自动',
  'workspace.newSession': '在此项目新建会话',
  'workspace.rebind': '改绑',
  'workspace.choose': '选择工作区',
  'workspace.autoMatch': '自动匹配（按目录路径）',
  'workspace.starting': '正在创建会话…',
  'workspace.empty': '还没有任何 DSH 工作区 —— 先在某个目录里打开会话',
  'error.prefix': 'DevBuddy 出错',
  'error.reload': '重新加载',
  'loading': '加载中…',
}

export const dictionaries = { zh, en }
