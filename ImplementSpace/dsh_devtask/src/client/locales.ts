/** DevTask panel copy. Bilingual dictionary under the `devTaskLeft` namespace. */

export type DevTaskKey =
  | 'panel.title'
  | 'panel.subtitle'
  | 'panel.loading'
  | 'panel.refreshing'
  | 'panel.rightbarOpen'
  | 'panel.rightbarClose'
  | 'modal.cancel'
  | 'modal.confirm'
  | 'error.prefix'
  | 'error.reload'
  | 'view.new'
  | 'view.name'
  | 'view.employeePlaceholder'
  | 'view.scope.individual'
  | 'view.scope.individualHint'
  | 'view.create'
  | 'view.cancel'
  | 'view.remove'
  | 'view.removeConfirm'
  | 'view.empty'
  | 'task.new'
  | 'task.title'
  | 'task.titlePlaceholder'
  | 'task.description'
  | 'task.descriptionPlaceholder'
  | 'task.status'
  | 'task.priority'
  | 'task.tags'
  | 'task.tagsPlaceholder'
  | 'task.create'
  | 'task.cancel'
  | 'task.edit'
  | 'task.save'
  | 'task.remove'
  | 'task.removeConfirm'
  | 'task.titleRequired'
  | 'task.empty'
  | 'task.emptyHint'
  | 'task.count'
  | 'status.backlog'
  | 'status.todo'
  | 'status.running'
  | 'status.done'
  | 'status.failed'
  | 'priority.low'
  | 'priority.medium'
  | 'priority.high'
  | 'priority.urgent'
  | 'period.all'
  | 'period.week'
  | 'period.month'
  | 'period.quarter'
  | 'period.custom'
  | 'period.customStart'
  | 'period.customEnd'
  | 'viewtype.board'
  | 'viewtype.project'
  | 'viewtype.gantt'
  | 'viewtype.activity'
  | 'viewtype.agent'
  | 'agent.count'
  | 'agent.create'
  | 'agent.namePh'
  | 'agent.descPh'
  | 'agent.empty'
  | 'agent.emptyHint'
  | 'agent.created'
  | 'agent.delete'
  | 'agent.deleteConfirm'
  | 'agent.status.provisioning'
  | 'agent.status.running'
  | 'agent.status.idle'
  | 'agent.status.inactive'
  | 'agent.status.failed'
  | 'gantt.task'
  | 'gantt.empty'
  | 'gantt.unscheduled'
  | 'gantt.today'
  | 'activity.loading'
  | 'activity.retry'
  | 'activity.empty'
  | 'activity.created'
  | 'activity.changedOne'
  | 'activity.changedMany'
  | 'activity.time.justNow'
  | 'activity.time.minutes'
  | 'activity.time.hours'
  | 'activity.time.today'
  | 'activity.time.yesterday'
  | 'activity.today'
  | 'activity.emptyValue'
  | 'activity.count'
  | 'activity.toggleDay'
  | 'activity.staleHint'
  | 'activity.refresh'
  | 'activity.loadMore'
  | 'activity.allLoaded'
  | 'okr.expand'
  | 'okr.collapse'
  | 'okr.progress'
  | 'okr.due'
  | 'okr.empty'
  | 'okr.noChildren'
  | 'okr.orphans'
  | 'okr.orphanKrs'
  | 'okr.selfReported'

/** Locale dictionary: the DSH locale runtime keys dictionaries as `zh` / `en`. */
export const dictionaries = {
  zh: {
    'panel.title': 'DevTask',
    'panel.subtitle': '团队任务看板',
    'panel.loading': '加载中…',
    'panel.refreshing': '刷新中…',
    'panel.rightbarOpen': '展开右侧栏',
    'panel.rightbarClose': '收起右侧栏',
    'modal.cancel': '取消',
    'modal.confirm': '确定',
    'error.prefix': '出错了',
    'error.reload': '重试',
    'view.new': '新增视图',
    'view.name': '视图名称',
    'view.employeePlaceholder': '请选择员工',
    'view.scope.individual': '个人视角',
    'view.scope.individualHint': '新增视图，归属到一位员工',
    'view.create': '创建',
    'view.cancel': '取消',
    'view.remove': '删除视图',
    'view.removeConfirm': '确定删除该视图？视图中的任务也会一并删除。',
    'view.empty': '暂无视图',
    'task.new': '新建任务',
    'task.title': '标题',
    'task.titlePlaceholder': '任务标题',
    'task.description': '描述',
    'task.descriptionPlaceholder': '补充说明（可选）',
    'task.status': '状态',
    'task.priority': '优先级',
    'task.tags': '标签',
    'task.tagsPlaceholder': '用逗号分隔',
    'task.create': '创建任务',
    'task.cancel': '取消',
    'task.edit': '编辑',
    'task.save': '保存',
    'task.remove': '删除任务',
    'task.removeConfirm': '确定删除该任务？',
    'task.titleRequired': '请输入任务标题',
    'task.empty': '该列暂无任务',
    'task.emptyHint': '点击右上角「新建任务」开始',
    'task.count': '个任务',
    'status.backlog': '待办池',
    'status.todo': '待开始',
    'status.running': '进行中',
    'status.done': '已完成',
    'status.failed': '失败',
    'priority.low': '低',
    'priority.medium': '中',
    'priority.high': '高',
    'priority.urgent': '紧急',
    'period.all': '全部',
    'period.week': '本周',
    'period.month': '本月',
    'period.quarter': '本季度',
    'period.custom': '自定义',
    'period.customStart': '开始',
    'period.customEnd': '结束',
    'viewtype.board': '看板',
    'viewtype.project': '项目',
    'viewtype.gantt': '甘特图',
    'viewtype.activity': '活动',
    'viewtype.agent': 'Agent',
    'agent.count': '{n} 个 Agent',
    'agent.create': '新建 Agent',
    'agent.namePh': 'Agent 名称',
    'agent.descPh': '职责 / 备注（可选）',
    'agent.empty': '暂无 Agent',
    'agent.emptyHint': '点击「新建 Agent」创建第一个',
    'agent.created': '创建于',
    'agent.delete': '删除',
    'agent.deleteConfirm': '确定删除 Agent「{name}」？',
    'agent.status.provisioning': '启动中',
    'agent.status.running': '运行中',
    'agent.status.idle': '空闲',
    'agent.status.inactive': '停用',
    'agent.status.failed': '失败',
    'gantt.task': '任务',
    'gantt.empty': '当前范围内暂无任务',
    'gantt.unscheduled': '未排期',
    'gantt.today': '今天',
    'activity.loading': '加载活动事件…',
    'activity.retry': '重试',
    'activity.empty': '暂无活动事件',
    'activity.created': '创建了',
    'activity.changedOne': '将 {field} 从 {before} 改为 {after}',
    'activity.changedMany': '更新了 {n} 个字段',
    'activity.time.justNow': '刚刚',
    'activity.time.minutes': '分钟前',
    'activity.time.hours': '小时前',
    'activity.time.today': '今天',
    'activity.time.yesterday': '昨天',
    'activity.today': '今天',
    'activity.emptyValue': '空',
    'activity.count': '共 {n} 条事件',
    'activity.toggleDay': '折叠 / 展开当天',
    'activity.staleHint': '显示本地缓存，正在刷新…',
    'activity.refresh': '刷新',
    'activity.loadMore': '加载更多',
    'activity.allLoaded': '已加载全部',
    'okr.expand': '展开',
    'okr.collapse': '收起',
    'okr.progress': '进度',
    'okr.due': '截止日期',
    'okr.empty': '当前范围内暂无 OKR',
    'okr.noChildren': '暂无任务拆解',
    'okr.orphans': '未关联 KR 的任务',
    'okr.orphanKrs': '未关联目标的 KR',
    'okr.selfReported': '自报进度',
  },
  en: {
    'panel.title': 'DevTask',
    'panel.subtitle': 'Team task board',
    'panel.loading': 'Loading…',
    'panel.refreshing': 'Refreshing…',
    'panel.rightbarOpen': 'Expand right sidebar',
    'panel.rightbarClose': 'Collapse right sidebar',
    'modal.cancel': 'Cancel',
    'modal.confirm': 'OK',
    'error.prefix': 'Error',
    'error.reload': 'Retry',
    'view.new': 'New view',
    'view.name': 'View name',
    'view.employeePlaceholder': 'Select an employee',
    'view.scope.individual': 'Individual view',
    'view.scope.individualHint': 'Added view owned by one employee',
    'view.create': 'Create',
    'view.cancel': 'Cancel',
    'view.remove': 'Delete view',
    'view.removeConfirm': 'Delete this view? Its tasks are deleted too.',
    'view.empty': 'No views',
    'task.new': 'New task',
    'task.title': 'Title',
    'task.titlePlaceholder': 'Task title',
    'task.description': 'Description',
    'task.descriptionPlaceholder': 'Optional details',
    'task.status': 'Status',
    'task.priority': 'Priority',
    'task.tags': 'Tags',
    'task.tagsPlaceholder': 'Comma separated',
    'task.create': 'Create task',
    'task.cancel': 'Cancel',
    'task.edit': 'Edit',
    'task.save': 'Save',
    'task.remove': 'Delete task',
    'task.removeConfirm': 'Delete this task?',
    'task.titleRequired': 'Enter a task title',
    'task.empty': 'No tasks in this column',
    'task.emptyHint': 'Click "New task" to start',
    'task.count': 'tasks',
    'status.backlog': 'Backlog',
    'status.todo': 'To do',
    'status.running': 'Running',
    'status.done': 'Done',
    'status.failed': 'Failed',
    'priority.low': 'Low',
    'priority.medium': 'Medium',
    'priority.high': 'High',
    'priority.urgent': 'Urgent',
    'period.all': 'All',
    'period.week': 'This week',
    'period.month': 'This month',
    'period.quarter': 'This quarter',
    'period.custom': 'Custom',
    'period.customStart': 'Start',
    'period.customEnd': 'End',
    'viewtype.board': 'Board',
    'viewtype.project': 'Project',
    'viewtype.gantt': 'Gantt',
    'viewtype.activity': 'Activity',
    'viewtype.agent': 'Agents',
    'agent.count': '{n} agents',
    'agent.create': 'New agent',
    'agent.namePh': 'Agent name',
    'agent.descPh': 'Role / notes (optional)',
    'agent.empty': 'No agents yet',
    'agent.emptyHint': 'Click "New agent" to create the first one',
    'agent.created': 'Created',
    'agent.delete': 'Delete',
    'agent.deleteConfirm': 'Delete agent "{name}"?',
    'agent.status.provisioning': 'Provisioning',
    'agent.status.running': 'Running',
    'agent.status.idle': 'Idle',
    'agent.status.inactive': 'Inactive',
    'agent.status.failed': 'Failed',
    'gantt.task': 'Task',
    'gantt.empty': 'No tasks in the current range',
    'gantt.unscheduled': 'Unscheduled',
    'gantt.today': 'Today',
    'activity.loading': 'Loading activity…',
    'activity.retry': 'Retry',
    'activity.empty': 'No activity yet',
    'activity.created': 'created',
    'activity.changedOne': 'changed {field} from {before} to {after}',
    'activity.changedMany': 'updated {n} fields',
    'activity.time.justNow': 'just now',
    'activity.time.minutes': 'min ago',
    'activity.time.hours': 'h ago',
    'activity.time.today': 'Today',
    'activity.time.yesterday': 'Yesterday',
    'activity.today': 'Today',
    'activity.emptyValue': 'empty',
    'activity.count': '{n} events',
    'activity.toggleDay': 'Collapse / expand day',
    'activity.staleHint': 'Showing local cache — refreshing…',
    'activity.refresh': 'Refresh',
    'activity.loadMore': 'Load more',
    'activity.allLoaded': 'All loaded',
    'okr.expand': 'Expand',
    'okr.collapse': 'Collapse',
    'okr.progress': 'Progress',
    'okr.due': 'Due date',
    'okr.empty': 'No OKRs in the current range',
    'okr.noChildren': 'No breakdown tasks',
    'okr.orphans': 'Tasks without a KR',
    'okr.orphanKrs': 'KRs without an objective',
    'okr.selfReported': 'Reported progress',
  },
} as const

export type DevTaskDictionary = typeof dictionaries['zh']