# AGENTS.md

项目开发规则，所有 AI 编码助手必须遵守。

## 强制规则

### Icons

所有 icon **必须**使用 `lucide-react` 图标库（`import { IconName } from 'lucide-react'`）。
禁止使用 HTML 实体（如 `&#9776;`）、Unicode 字符、emoji、纯文本字母、或内联 SVG 作为 icon 替代。
适用范围：工具栏、按钮、菜单、徽章、状态指示器，以及任何需要显示图标的 UI 元素。

## 发布说明

本项目通过 GitHub tag 触发 `.github/workflows/release.yml` 自动打包和发布。

### 发布前检查

1. 确认工作区干净，必要改动已经提交：

   ```bash
   git status
   ```

2. 确认本地基础校验通过：

   ```bash
   node --test tests/app-update-release.test.mjs
   npm run typecheck
   npm run build
   ```

### 发版步骤

1. 修改 `package.json` 里的 `version`，例如从 `0.1.9` 改成 `0.1.10`。

2. 提交版本号变更：

   ```bash
   git add package.json
   git commit -m "chore: release v0.1.10"
   ```

3. 创建和版本号一致的 tag。tag 必须以 `v` 开头：

   ```bash
   git tag v0.1.10
   ```

4. 推送主分支和 tag：

   ```bash
   git push origin main
   git push origin v0.1.10
   ```

推送 tag 后，GitHub Actions 会自动构建并发布 GitHub Release。

### 发布产物

成功发布后，GitHub Release 应包含：

- Windows 安装包：`NextureAI.Setup.<version>.exe`
- Windows 便携版：`NextureAI-<version>-portable.exe`
- macOS 安装包：`NextureAI-<version>-arm64.dmg`
- macOS zip：`NextureAI-<version>-arm64-mac.zip`
- Windows 热更新元数据：`latest.yml`
- macOS 热更新元数据：`latest-mac.yml`
- 对应 `.blockmap` 文件

### 注意事项

- 不要手动创建 draft release，交给 workflow 自动创建公开 release。
- `package.json` 的 `version` 必须和 tag 对齐，例如 `0.1.10` 对应 `v0.1.10`。
- 当前 macOS 产物是 Apple Silicon `arm64` 版本；如需 Intel Mac，需要额外增加 `x64` 或 universal 构建。
- 如果 GitHub Actions 成功但 Release 缺少 `latest.yml` 或 `latest-mac.yml`，热更新会不完整，必须修复后重新发一个新版本 tag。
