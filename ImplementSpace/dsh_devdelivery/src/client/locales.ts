export type DeliveryKey =
  | 'tab.title' | 'tab.guide' | 'panel.empty' | 'panel.createRun' | 'panel.refresh'
  | 'run.version' | 'run.branch' | 'run.commit' | 'run.create' | 'run.cancel'
  | 'stage.ai_self_test' | 'stage.cicd' | 'stage.test' | 'stage.merge_request' | 'stage.artifact' | 'stage.deployment' | 'stage.acceptance'
  | 'status.not_started' | 'status.running' | 'status.passed' | 'status.failed' | 'status.blocked' | 'status.skipped'
  | 'status.draft' | 'status.ready_for_validation' | 'status.validating' | 'status.ready_for_acceptance' | 'status.accepted' | 'status.rejected'
  | 'action.evidence' | 'action.addEvidence' | 'action.openDevBuddy' | 'action.openDevTask' | 'evidence.title' | 'evidence.url' | 'evidence.note' | 'error.load'

export const dictionaries = {
  zh: {
    'tab.title': 'DevDelivery', 'tab.guide': '项目交付与验证状态', 'panel.empty': '还没有交付批次。创建一个批次以开始记录自测、验证与验收。', 'panel.createRun': '新建交付批次', 'panel.refresh': '刷新',
    'run.version': '版本 / 交付批次名称', 'run.branch': '分支（可选）', 'run.commit': '提交 SHA（可选）', 'run.create': '创建批次', 'run.cancel': '取消',
    'stage.ai_self_test': 'AI 自测', 'stage.cicd': 'CI/CD', 'stage.test': '测试', 'stage.merge_request': 'MR', 'stage.artifact': '制品', 'stage.deployment': '部署', 'stage.acceptance': '验收',
    'status.not_started': '未开始', 'status.running': '进行中', 'status.passed': '已通过', 'status.failed': '失败', 'status.blocked': '已阻塞', 'status.skipped': '已跳过',
    'status.draft': '草稿', 'status.ready_for_validation': '待验证', 'status.validating': '验证中', 'status.ready_for_acceptance': '待验收', 'status.accepted': '已验收', 'status.rejected': '已驳回',
    'action.evidence': '证据', 'action.addEvidence': '添加证据', 'action.openDevBuddy': '返回开发', 'action.openDevTask': '打开任务', 'evidence.title': '证据标题', 'evidence.url': '链接（可选）', 'evidence.note': '说明（可选）', 'error.load': '加载交付状态失败',
  },
  en: {
    'tab.title': 'DevDelivery', 'tab.guide': 'Project delivery and verification status', 'panel.empty': 'No delivery runs yet. Create one to record self-tests, validation and acceptance.', 'panel.createRun': 'New delivery run', 'panel.refresh': 'Refresh',
    'run.version': 'Version / delivery run name', 'run.branch': 'Branch (optional)', 'run.commit': 'Commit SHA (optional)', 'run.create': 'Create run', 'run.cancel': 'Cancel',
    'stage.ai_self_test': 'AI self-test', 'stage.cicd': 'CI/CD', 'stage.test': 'Tests', 'stage.merge_request': 'MR', 'stage.artifact': 'Artifact', 'stage.deployment': 'Deployment', 'stage.acceptance': 'Acceptance',
    'status.not_started': 'Not started', 'status.running': 'Running', 'status.passed': 'Passed', 'status.failed': 'Failed', 'status.blocked': 'Blocked', 'status.skipped': 'Skipped',
    'status.draft': 'Draft', 'status.ready_for_validation': 'Ready for validation', 'status.validating': 'Validating', 'status.ready_for_acceptance': 'Ready for acceptance', 'status.accepted': 'Accepted', 'status.rejected': 'Rejected',
    'action.evidence': 'Evidence', 'action.addEvidence': 'Add evidence', 'action.openDevBuddy': 'Back to development', 'action.openDevTask': 'Open tasks', 'evidence.title': 'Evidence title', 'evidence.url': 'URL (optional)', 'evidence.note': 'Note (optional)', 'error.load': 'Failed to load delivery status',
  },
} as const
