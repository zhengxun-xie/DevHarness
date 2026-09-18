# ProjectInfo

> 本文件是 `ProjectInfo.md` 的补全草案（proposal），供人工评审通过后合入 `ProjectInfo.md` 本体；评审前请勿将其当作正式文档引用。

## 项目名称

DevBuddy

## 项目信息

DevBuddy 是一个用于项目开发自动化工作流的软件，目前以一组基于 **dsh**（DeepSeek Harness）的插件形式实现。它是一个以工程文档为核心、以 Review 为驱动、以 AI Agent 为执行者、以 Git 为最终变更记录的 **Agent Engineering Workspace**，由左侧栏的 **DevBuddy 主插件**（多项目管理与工作流区域）和右侧栏的 **Reviewer 插件**（Review Driven、Inline Review 等评审能力）两部分组成。项目的整体设计目标、背景与工作流定义详见 [CoreRequirements.md](CoreRequirements.md)。

## 工作目录

`/home/l-xiezhenxun/workspace/DevBuddy`

## git 地址

TODO：当前尚未配置远程仓库地址（本地已初始化 git 仓库，但 `git remote` 为空），待远程仓库确定后补充，形如 `git@example.com:team/DevBuddy.git` 或 `https://example.com/team/DevBuddy.git`。

---

## 依据说明

本文档的字段构成（项目名称、项目信息、工作目录、git 地址）依据 [CoreRequirements.md](CoreRequirements.md) 中「第一部分：项目属性」的定义编写。该部分要求：项目属性区域需指定项目的名称、项目信息、工作目录、git 地址等信息，并将这些信息保存在 `ProjectInfo.md` 文件中。
