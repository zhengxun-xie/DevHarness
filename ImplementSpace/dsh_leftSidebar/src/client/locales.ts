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
  | 'node.preview'
  | 'node.collapse'
  | 'node.edit'
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
  'node.preview': 'Preview',
  'node.collapse': 'Collapse',
  'node.edit': 'Edit',
  'node.save': 'Save',
  'node.saved': 'Saved',
  'node.discard': 'Discard',
  'node.unsaved': 'Unsaved changes — preview shows the current draft',
  'node.notFound': 'File not created yet',
  'node.updated': 'Updated',
  'node.empty': 'Empty file — click Edit to start.',
  'node.reviewBadgeTitle': 'Review {number} ({id}) — click to open',
  'node.reviewBadgeDrifted': 'anchor drifted',
  'node.addReview': '💬 Add comment',
  'node.closeReview': 'Close',
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
  'node.preview': '预览',
  'node.collapse': '收起',
  'node.edit': '编辑',
  'node.save': '保存',
  'node.saved': '已保存',
  'node.discard': '放弃',
  'node.unsaved': '有未保存的修改 —— 预览展示的是当前草稿',
  'node.notFound': '文件尚未创建',
  'node.updated': '已更新',
  'node.empty': '文件为空 —— 点击「编辑」开始填写。',
  'node.reviewBadgeTitle': '评审 {number}（{id}）—— 点击打开',
  'node.reviewBadgeDrifted': '锚点已漂移',
  'node.addReview': '💬 添加评论',
  'node.closeReview': '关闭',
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
