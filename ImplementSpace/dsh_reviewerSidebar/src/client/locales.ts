/**
 * DevBuddy Reviewer right-panel copy. Bilingual dictionary under the
 * `devBuddyReviewer` namespace (same shape as the left panel's locales).
 */

export type ReviewerKey =
  // tab registration
  | 'tab.title'
  | 'tab.guideDescription'
  // chrome
  | 'panel.title'
  | 'panel.loading'
  | 'panel.errorReload'
  | 'panel.noProjects'
  | 'panel.noProjectsHint'
  | 'panel.criticalWarning'
  | 'panel.refresh'
  | 'project.active'
  | 'project.openCount'
  | 'project.workspaceLinked'
  | 'project.workspaceUnlinked'
  // quick actions module (design/05 §2.2)
  | 'actions.title'
  | 'actions.addComment'
  | 'actions.addCommentHint'
  // list
  | 'list.view.open'
  | 'list.view.inProgress'
  | 'list.view.verify'
  | 'list.view.closed'
  | 'list.view.all'
  | 'list.empty'
  | 'list.emptyHint'
  | 'list.viewDocument'
  | 'list.untitled'
  | 'list.groupCollapse'
  | 'list.groupExpand'
  // severities / types / statuses
  | 'severity.info'
  | 'severity.minor'
  | 'severity.major'
  | 'severity.critical'
  | 'type.question'
  | 'type.suggestion'
  | 'type.bug'
  | 'type.design_issue'
  | 'type.requirement_issue'
  | 'type.implementation_issue'
  | 'type.test_issue'
  | 'type.exploration'
  | 'status.open'
  | 'status.needs_review'
  | 'status.accepted'
  | 'status.implementing'
  | 'status.verifying'
  | 'status.resolved'
  | 'status.rejected'
  | 'status.duplicated'
  // anchor states
  | 'anchor.valid'
  | 'anchor.moved'
  | 'anchor.modified'
  | 'anchor.outdated'
  | 'anchor.orphaned'
  | 'anchor.movedTo'
  | 'anchor.needsReview'
  | 'anchor.confirmNeedsReview'
  | 'anchor.docMissing'
  | 'anchor.snapshot'
  // selection bar
  | 'selectionBar.prompt'
  | 'selectionBar.add'
  | 'selectionBar.dismiss'
  // composer
  | 'composer.addReview'
  | 'composer.type'
  | 'composer.severity'
  | 'composer.title'
  | 'composer.titlePlaceholder'
  | 'composer.comment'
  | 'composer.commentPlaceholder'
  | 'composer.proposal'
  | 'composer.proposalPlaceholder'
  | 'composer.tags'
  | 'composer.tagsHint'
  | 'composer.selection'
  | 'composer.pointAnchor'
  | 'composer.submit'
  | 'composer.cancel'
  | 'composer.error.emptyComment'
  | 'composer.error.emptySelection'
  | 'composer.error.whitespace'
  | 'composer.error.tooLong'
  // detail
  | 'detail.back'
  | 'detail.comment'
  | 'detail.proposal'
  | 'detail.thread'
  | 'detail.decision'
  | 'detail.duplicatedOf'
  | 'detail.author'
  | 'detail.assignee'
  | 'detail.agentSession'
  | 'detail.replyPlaceholder'
  | 'detail.reply'
  | 'detail.edit'
  | 'detail.saveEdit'
  | 'detail.cancelEdit'
  | 'detail.edited'
  | 'detail.terminalReadonly'
  | 'detail.remove'
  | 'detail.removeConfirm'
  | 'detail.error.conflict'
  // transitions
  | 'transition.accept'
  | 'transition.reject'
  | 'transition.duplicate'
  | 'transition.needsReview'
  | 'transition.backToOpen'
  | 'transition.startImplementing'
  | 'transition.declareDone'
  | 'transition.confirmAgentDone'
  | 'transition.implementationBlocked'
  | 'transition.submitVerification'
  | 'transition.resolve'
  | 'transition.failVerification'
  | 'transition.reason'
  | 'transition.reasonRequired'
  | 'transition.duplicatedOf'
  | 'transition.duplicatedOfRequired'
  | 'transition.decisionSummary'
  | 'transition.evidence'
  | 'transition.confirm'
  | 'transition.cancel'
  // document view
  | 'document.back'
  | 'document.notFound'
  | 'document.moreReviews'
  | 'document.addReview'
  // agent
  | 'agent.send'
  | 'agent.preview'
  | 'agent.confirmSend'
  | 'agent.activeSession'
  | 'agent.delivered'
  | 'agent.fallback'
  | 'agent.copyContext'
  | 'agent.copyPayload'
  | 'agent.copied'
  | 'agent.gitUnavailable'
  | 'agent.truncated'
  | 'agent.doneHint'
  | 'agent.close'

const en: Record<ReviewerKey, string> = {
  'tab.title': 'Reviews',
  'tab.guideDescription': 'Document-anchored review threads for this project.',
  'panel.title': 'Current project',
  'panel.loading': 'Loading…',
  'panel.errorReload': 'Something went wrong. Reload?',
  'panel.noProjects': 'No reviewable project',
  'panel.noProjectsHint': 'Create or open a project in the left panel first.',
  'panel.criticalWarning': '{count} P0 review(s) still open',
  'panel.refresh': 'Refresh',
  'project.active': 'Active in reviewer',
  'project.openCount': '{count} open',
  'project.workspaceLinked': 'Workspace linked',
  'project.workspaceUnlinked': 'No workspace',
  'actions.title': 'Quick actions',
  'actions.addComment': 'Add comment',
  'actions.addCommentHint': 'Place the editing cursor in a left-panel document editor first.',

  'list.view.open': 'Open',
  'list.view.inProgress': 'In progress',
  'list.view.verify': 'Verify',
  'list.view.closed': 'Closed',
  'list.view.all': 'All',
  'list.empty': 'No reviews yet',
  'list.emptyHint': 'Select text in a document to start a review.',
  'list.viewDocument': 'View in document',
  'list.untitled': 'Untitled review',
  'list.groupCollapse': 'Collapse document',
  'list.groupExpand': 'Expand document',

  'severity.info': 'P3',
  'severity.minor': 'P2',
  'severity.major': 'P1',
  'severity.critical': 'P0',
  'type.question': 'Question',
  'type.suggestion': 'Suggestion',
  'type.bug': 'Bug',
  'type.design_issue': 'Design issue',
  'type.requirement_issue': 'Requirement issue',
  'type.implementation_issue': 'Implementation issue',
  'type.test_issue': 'Test issue',
  'type.exploration': 'Exploration',
  'status.open': 'Open',
  'status.needs_review': 'Needs review',
  'status.accepted': 'Accepted',
  'status.implementing': 'Implementing',
  'status.verifying': 'Verifying',
  'status.resolved': 'Resolved',
  'status.rejected': 'Rejected',
  'status.duplicated': 'Duplicated',

  'anchor.valid': 'Anchor valid',
  'anchor.moved': 'Anchor moved',
  'anchor.modified': 'Anchor modified — confirm manually',
  'anchor.outdated': 'The target has substantially changed',
  'anchor.orphaned': 'The target text no longer exists',
  'anchor.movedTo': 'now at line {line}',
  'anchor.needsReview': 'NEEDS_REVIEW candidate',
  'anchor.confirmNeedsReview': 'Mark as needs review',
  'anchor.docMissing': 'Document missing',
  'anchor.snapshot': 'Original quote',

  'selectionBar.prompt': 'Text selected in {document} from the left panel',
  'selectionBar.add': 'Add review',
  'selectionBar.dismiss': 'Dismiss',

  'composer.addReview': '💬 Add Review',
  'composer.type': 'Type',
  'composer.severity': 'Priority',
  'composer.title': 'Title',
  'composer.titlePlaceholder': 'Short summary (optional)',
  'composer.comment': 'Comment',
  'composer.commentPlaceholder': 'Describe the issue or question…',
  'composer.proposal': 'Proposal',
  'composer.proposalPlaceholder': 'Suggested change (optional)',
  'composer.tags': 'Tags',
  'composer.tagsHint': 'Comma-separated',
  'composer.selection': 'Selection',
  'composer.pointAnchor': 'Point comment — no selected text, anchored at caret',
  'composer.submit': 'Submit Review',
  'composer.cancel': 'Cancel',
  'composer.error.emptyComment': 'Comment is required',
  'composer.error.emptySelection': 'Select document text first',
  'composer.error.whitespace': 'Whitespace-only selections are not allowed',
  'composer.error.tooLong': 'Selection is limited to 4000 characters',

  'detail.back': 'Back',
  'detail.comment': 'Comment',
  'detail.proposal': 'Proposal',
  'detail.thread': 'Discussion',
  'detail.decision': 'Decision',
  'detail.duplicatedOf': 'Duplicate of',
  'detail.author': 'Author',
  'detail.assignee': 'Assignee',
  'detail.agentSession': 'Agent session',
  'detail.replyPlaceholder': 'Write a reply…',
  'detail.reply': 'Reply',
  'detail.edit': 'Edit',
  'detail.saveEdit': 'Save',
  'detail.cancelEdit': 'Cancel',
  'detail.edited': 'edited',
  'detail.terminalReadonly': 'Closed — no more comments',
  'detail.remove': 'Delete',
  'detail.removeConfirm': 'Delete this review? Its record file will be removed.',
  'detail.error.conflict': 'Content changed, please refresh and retry.',

  'transition.accept': 'Accept',
  'transition.reject': 'Reject',
  'transition.duplicate': 'Duplicate',
  'transition.needsReview': 'Mark needs review',
  'transition.backToOpen': 'Back to open',
  'transition.startImplementing': 'Start implementing',
  'transition.declareDone': 'Declare done',
  'transition.confirmAgentDone': 'Confirm done',
  'transition.implementationBlocked': 'Implementation blocked',
  'transition.submitVerification': 'Submit for verification',
  'transition.resolve': 'Resolve',
  'transition.failVerification': 'Fail verification',
  'transition.reason': 'Reason',
  'transition.reasonRequired': 'Reason is required',
  'transition.duplicatedOf': 'Duplicate of',
  'transition.duplicatedOfRequired': 'Pick the original review',
  'transition.decisionSummary': 'Decision summary',
  'transition.evidence': 'Verification evidence (test paths / diff summary)',
  'transition.confirm': 'Confirm',
  'transition.cancel': 'Cancel',

  'document.back': 'Back',
  'document.notFound': 'Document missing',
  'document.moreReviews': '+{count} more',
  'document.addReview': '💬 Add Review',

  'agent.send': 'Send to Agent',
  'agent.preview': 'Preview context',
  'agent.confirmSend': 'Confirm & send',
  'agent.activeSession': 'Active session',
  'agent.delivered': 'Delivered to session {id} — review is now implementing.',
  'agent.fallback': 'Auto-delivery unavailable: {reason}. Copy the context and send it manually.',
  'agent.copyContext': 'Copy context',
  'agent.copyPayload': 'Copy payload',
  'agent.copied': 'Copied',
  'agent.gitUnavailable': 'Not a git repository',
  'agent.truncated': 'Context truncated due to size limit',
  'agent.doneHint': 'Agent reports completion · awaiting your verification:',
  'agent.close': 'Close',
}

const zh: Record<ReviewerKey, string> = {
  'tab.title': '评审',
  'tab.guideDescription': '针对本项目文档锚点的评审讨论。',
  'panel.title': '当前项目',
  'panel.loading': '加载中…',
  'panel.errorReload': '加载失败，是否重试？',
  'panel.noProjects': '暂无可评审项目',
  'panel.noProjectsHint': '请先在左栏创建或打开一个项目。',
  'panel.criticalWarning': '有 {count} 条 P0 评审尚未关闭',
  'panel.refresh': '刷新',
  'project.active': '右栏当前项目',
  'project.openCount': '{count} 未关闭',
  'project.workspaceLinked': '已关联工作区',
  'project.workspaceUnlinked': '未关联工作区',
  'actions.title': '快捷操作',
  'actions.addComment': '添加评论',
  'actions.addCommentHint': '请先在左栏文档的编辑状态中定位光标。',

  'list.view.open': '待处理',
  'list.view.inProgress': '进行中',
  'list.view.verify': '待验收',
  'list.view.closed': '已关闭',
  'list.view.all': '全部',
  'list.empty': '暂无评审',
  'list.emptyHint': '在文档中选中文字即可发起评审。',
  'list.viewDocument': '在文档中查看',
  'list.untitled': '未命名评审',
  'list.groupCollapse': '折叠文档',
  'list.groupExpand': '展开文档',

  'severity.info': 'P3',
  'severity.minor': 'P2',
  'severity.major': 'P1',
  'severity.critical': 'P0',
  'type.question': '疑问',
  'type.suggestion': '建议',
  'type.bug': '缺陷',
  'type.design_issue': '设计问题',
  'type.requirement_issue': '需求问题',
  'type.implementation_issue': '实现问题',
  'type.test_issue': '测试问题',
  'type.exploration': '探索',
  'status.open': '待处理',
  'status.needs_review': '待复核',
  'status.accepted': '已接受',
  'status.implementing': '实施中',
  'status.verifying': '待验收',
  'status.resolved': '已解决',
  'status.rejected': '已拒绝',
  'status.duplicated': '重复',

  'anchor.valid': '锚点有效',
  'anchor.moved': '锚点已移动',
  'anchor.modified': '锚点内容被修改，需人工确认',
  'anchor.outdated': '目标已实质变化',
  'anchor.orphaned': '目标文本已不存在',
  'anchor.movedTo': '新位置：第 {line} 行',
  'anchor.needsReview': 'NEEDS_REVIEW 候选',
  'anchor.confirmNeedsReview': '标记为待复核',
  'anchor.docMissing': '文档缺失',
  'anchor.snapshot': '原文快照',

  'selectionBar.prompt': '左栏在 {document} 中选中了一段文字',
  'selectionBar.add': '添加评审',
  'selectionBar.dismiss': '忽略',

  'composer.addReview': '💬 新建评审',
  'composer.type': '类型',
  'composer.severity': '优先级',
  'composer.title': '标题',
  'composer.titlePlaceholder': '一句话概述（可选）',
  'composer.comment': '评论',
  'composer.commentPlaceholder': '描述问题或疑问…',
  'composer.proposal': '修改建议',
  'composer.proposalPlaceholder': '建议的改法（可选）',
  'composer.tags': '标签',
  'composer.tagsHint': '用逗号分隔',
  'composer.selection': '选区',
  'composer.pointAnchor': '插入点评论（无选中文字，锚定在光标位置）',
  'composer.submit': '提交评审',
  'composer.cancel': '取消',
  'composer.error.emptyComment': '评论不能为空',
  'composer.error.emptySelection': '请先在文档中选中文字',
  'composer.error.whitespace': '不能只选择空白字符',
  'composer.error.tooLong': '选区不能超过 4000 字符',

  'detail.back': '返回',
  'detail.comment': '评论',
  'detail.proposal': '修改建议',
  'detail.thread': '讨论',
  'detail.decision': '裁决',
  'detail.duplicatedOf': '重复于',
  'detail.author': '提出人',
  'detail.assignee': '负责人',
  'detail.agentSession': 'Agent 会话',
  'detail.replyPlaceholder': '写下你的回复…',
  'detail.reply': '回复',
  'detail.edit': '编辑',
  'detail.saveEdit': '保存',
  'detail.cancelEdit': '取消',
  'detail.edited': '已编辑',
  'detail.terminalReadonly': '已终结，不可追加评论',
  'detail.remove': '删除',
  'detail.removeConfirm': '删除该评审？记录文件将被移除。',
  'detail.error.conflict': '内容已更新，请刷新后重试',

  'transition.accept': '接受',
  'transition.reject': '拒绝',
  'transition.duplicate': '标记重复',
  'transition.needsReview': '标记待复核',
  'transition.backToOpen': '撤回讨论',
  'transition.startImplementing': '开始实施',
  'transition.declareDone': '声明完成',
  'transition.confirmAgentDone': '确认完成',
  'transition.implementationBlocked': '实施受阻',
  'transition.submitVerification': '提交验证',
  'transition.resolve': '验收通过',
  'transition.failVerification': '验收不通过',
  'transition.reason': '原因',
  'transition.reasonRequired': '请填写原因',
  'transition.duplicatedOf': '重复于',
  'transition.duplicatedOfRequired': '请选择原评审',
  'transition.decisionSummary': '裁决摘要',
  'transition.evidence': '验证证据（测试路径 / Diff 摘要）',
  'transition.confirm': '确认',
  'transition.cancel': '取消',

  'document.back': '返回',
  'document.notFound': '文档缺失',
  'document.moreReviews': '+{count} 条评审',
  'document.addReview': '💬 添加评审',

  'agent.send': '发送给 Agent',
  'agent.preview': '预览 Context',
  'agent.confirmSend': '确认发送',
  'agent.activeSession': '活动会话',
  'agent.delivered': '已发送至会话 {id}，评审进入实施中。',
  'agent.fallback': '无法自动送达（{reason}），请复制 Context 后手动发送。',
  'agent.copyContext': '复制 Context',
  'agent.copyPayload': '复制 Payload',
  'agent.copied': '已复制',
  'agent.gitUnavailable': '非 Git 仓库',
  'agent.truncated': 'Context 超出上限已截断',
  'agent.doneHint': 'Agent 报告完成 · 待你验收：',
  'agent.close': '关闭',
}

export const dictionaries = { zh, en }
